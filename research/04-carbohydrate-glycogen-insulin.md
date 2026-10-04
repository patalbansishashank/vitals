# 04 — Carbohydrate handling, glycogen kinetics, glucose/insulin dynamics, DNL, fibre vs net carbs, sugars

> Dossier for the Vitals mechanistic engine. Written 2026-09-30 following `research/RESEARCH_PROTOCOL.md`.
> Conventions: glycogen is expressed in grams of anhydro-glucosyl units (1 mmol glucosyl unit = 0.162 g glycogen = 0.180 g glucose).
> Muscle concentrations are mmol glucosyl units per kg **wet weight (ww)** unless stated; dry weight (dw) ≈ 4.3 × ww (Murray & Rosenbloom 2018 use 4.325) [19].
> 1 µU/mL insulin ≈ 6 pmol/L. `PROPOSED FIT` = equation proposed by this dossier and fitted to the listed data points. `UNVERIFIED` = number not confirmed against a primary source during this research session.
> Reference numbers in square brackets point to Section 11.

---

## 1. Scope

What physically happens to eaten carbohydrate (digestible starch and sugars incl. glucose, fructose, galactose; fibre handled separately) from absorption to oxidation, glycogen storage (liver and muscle, with bound water and potassium) or de novo lipogenesis (DNL). The dossier also covers how carbohydrate availability sets substrate oxidation (RQ), how insulin controls lipolysis, and why that does not decide fat balance. It gives parametric glucose and insulin response curves, an insulin-sensitivity state with update rules, fructose specifics, fibre energy, minimum carbohydrate needs, and brief notes on performance and hormones.
Deliverables for the engine: (i) a two-compartment **glycogen sub-model** with hourly fluxes (§4.2–4.10), (ii) a **carbohydrate-disposal rule set** (§4.10–4.13), (iii) a daily **reduced-form model** for the planner (§4.11), (iv) an **insulin-sensitivity state** with an update rule (§4.18–4.19).

---

## 2. State variables

| Symbol | Name | Unit | Typical range | What it represents | Initial-value rule |
|---|---|---|---|---|---|
| `G_L` | Liver glycogen | g | 5–130 (normal fed 60–90; after overnight fast 35–60; after 24 h fast 15–25) | Hepatic glycogen pool; buffers blood glucose | `G_L0 = C_L0 · V_liv · 0.162`; `C_L0` = 280 mmol/L (4 h after a mixed meal) or 210 mmol/L (overnight-fasted), `V_liv` = 1.45 L default (range 1.2–1.8 L; scale ∝ FFM — UNVERIFIED scaling) [7][8][15] |
| `c_M,j` | Muscle glycogen concentration in muscle group j | mmol/kg ww | 30–210 (normal 80–130; depleted 30–60; loaded 170–210; max reported ≈290) | Local store; determines exercise capacity and local oxidation | `c_M0 = (462 + 6.7·(VO2max − 53) + ΔCHO)/4.3`; ΔCHO = +102 if habitual CHO ≥6 g/kg/d, −253 if depleted + low-CHO, 0 otherwise [20] (Areta meta-regression, dw → ww) |
| `G_M` | Whole-body muscle glycogen | g | 250–1100 | Sum over muscle groups | `G_M = Σ_j 0.162 · c_M,j · SMM_j`; default SMM = 0.384·BM (men), 0.306·BM (women) [30] (dossier 14 may override) |
| `G_tot` | Total glycogen | g | 300–1200 | `G_L + G_M` | derived |
| `G_cap` | Total glycogen capacity | g | ≈15 g/kg BM (≈1.0–1.2 kg) | Point above which extra carbohydrate must be oxidised or converted to fat | `G_cap = L_max + Σ 0.162·c_M,max·SMM_j`, `c_M,max` = 200 mmol/kg ww; cross-check 15 g/kg BM [42] |
| `W_G` | Glycogen-bound water | kg | 0.8–4.5 | Intracellular water that moves with glycogen (scale-weight transient) | `W_G = h·G_tot/1000`, h = 3.0 g/g (range 2–4) [1][2][3] |
| `K_G` | Glycogen-associated potassium | mmol | 150–550 | K⁺ released/retained with glycogen | `K_G = 0.45·G_tot` [5] |
| `E_ex,j` | Post-exercise glycogen-synthesis enhancement | dimensionless | 0–1.3 | Contraction-induced GLUT4/glycogen-synthase activation | 0 |
| `T_C` | Carbohydrate-tolerance state | 0–1 | 0.3–1 | Adaptive glucose tolerance to a carbohydrate challenge (lowered by weeks of low carbohydrate intake) | 1 if habitual CHO ≥150 g/d; else from §4.19 |
| `S_hep` | Relative hepatic insulin sensitivity | dimensionless (1 = lean healthy reference) | 0.3–1.3 | Insulin suppression of hepatic glucose output; drives fasting glucose/insulin (HOMA) | from liver fat and adiposity (§4.18) |
| `S_mus` | Relative peripheral (muscle) insulin sensitivity | dimensionless | 0.3–1.5 | Insulin-stimulated glucose uptake and glycogen synthesis | from adiposity, activity and fitness (§4.18) |
| `Glc(t)` | Plasma glucose | mmol/L | 3.5–9 (healthy) | Output curve | fasting value from §4.16 |
| `Ins(t)` | Plasma insulin | µU/mL | 2–150 | Output curve; drives lipolysis suppression | fasting value from §4.17 |
| `λ(t)` | Fractional suppression of adipose lipolysis | 0–1 | 0.2–0.97 | Insulin action on adipose tissue | computed |
| `f_C(t)` | Carbohydrate share of non-protein energy oxidised | 0–1 | 0.05–0.95 (NPRQ >1 only when net DNL occurs) | Links to RQ | computed |
| `DNL_net` | Whole-body net de novo lipogenesis | g fat/d | 0 (normal) to ~150–240 (massive CHO overfeeding) | Fat made from carbohydrate in excess of fat oxidised | 0 |
| `fDNL` | Hepatic fractional DNL (VLDL-palmitate) | % | 0.1–45 | Biomarker of recent carbohydrate/sugar excess | from §4.13 |
| `A_keto` | Keto-adaptation state | 0–1 | — | **Input from dossier 05**; reduces glycolytic flux/glycogen use | from 05 |

---

## 3. Inputs that drive it

| Input | Unit | How it enters |
|---|---|---|
| Digestible carbohydrate per meal, split into glucose-equivalents (starch, maltodextrin, glucose, ½ sucrose, ½ lactose), fructose (free + ½ sucrose + HFCS fructose), galactose (½ lactose) | g | Absorption kernels `Ra_x(t)` (§4.10); fructose/galactose handled hepatically (§4.8, §4.20) |
| Glycaemic index of the carbohydrate source or food form (liquid / refined solid / whole / legume) | 0–100 (glucose scale) | Effective glycaemic load, time-to-peak (§4.16) |
| Fibre per meal: viscous soluble (β-glucan, guar, psyllium), other fermentable, insoluble | g | Glycaemic modifier (§4.16); metabolisable energy (§4.21, dossier 15) |
| Protein and fat per meal | g | Slow gastric emptying, reduce glucose peak, add insulin (protein) (§4.16–4.17) |
| Meal order (carbohydrate last), vinegar with meal | boolean | Glycaemic modifiers (§4.16) |
| Clock time of meal | h | Circadian tolerance modifier (coordinate with 07) |
| Daily energy balance (intake − expenditure) | kcal/d | Hepatic insulin sensitivity (§4.18), DNL (§4.13) |
| Energy expenditure time course (non-protein) | kcal/h | Oxidation demand (§4.10) — **from dossiers 01/02/10** |
| Protein oxidation and lipolysis (glycerol) | g/h | Gluconeogenesis substrate (§4.22) — from 03/05 |
| Endurance exercise: intensity (%VO2max), duration, modality, active muscle mass | %, min, kg | Muscle and liver glycogenolysis (§4.3–4.4) |
| Resistance exercise: sets per muscle group, groups trained | sets | Muscle glycogen depletion (§4.5) |
| Carbohydrate eaten during exercise | g/min | Spares liver glycogen (§4.3) |
| Steps/day, training status (VO2max) | steps, mL/kg/min | Insulin sensitivity (§4.18), resting glycogen (§2) |
| Sleep duration last night / last week | h | Insulin sensitivity (§4.18; dossier 16) |
| Saturated fat %E, free sugar/fructose %E | %E | Insulin sensitivity, liver fat, DNL (§4.13, §4.18, §4.20) |
| Liver fat, body-fat %, visceral fat | %, %, L | Insulin sensitivity (from 06/14) |
| Keto-adaptation `A_keto` | 0–1 | From 05; lowers carbohydrate oxidation drive |

---

## 4. Mechanisms & equations

### 4.1 Glycogen storage capacity, composition, water and potassium

**Mechanism.** Glycogen is stored mainly in liver (~80 g typical, range 0–160 g) and skeletal muscle (~500 g typical, range 300–700 g) [19]. Liver glycogen serves blood glucose. Muscle glycogen is used almost only by the muscle that stores it. Capacity rises with carbohydrate loading, and whole-body glycogen can reach about 15 g/kg body mass [42]. Glycogen is stored hydrated and with potassium, which explains the fast "water weight" changes on the scale.

**Numbers located in the literature**

| Quantity | Value | Population / condition | Source |
|---|---|---|---|
| Liver glycogen conc., 4 h after standard meal | 282 ± 60 mmol/L liver (controls) vs 131 ± 20 (T2D) | Healthy vs T2D, 13C-MRS | Magnusson 1992 [7] |
| Liver glycogen conc., evening post-meal → morning | 350 ± 18 → 207 ± 22 mmol/L | Healthy, 13C-MRS | Taylor 1996 [8] |
| Liver glycogen after 139 g glucose liquid meal | 207 → 316 mmol/L (peak ~318 min); +28.3 ± 3.7 g ≈ 19% of meal CHO | Healthy | Taylor 1996 [8] |
| Liver volume | 1.19 L (controls) [7]; 1.44 ± 0.06 L [8]; ~1.8 L implied in trained cyclists (53.6 g at 183 mmol/L) [15] | MRI | [7][8][15] |
| Liver glycogen, overnight-fasted trained cyclists | 325 ± 168 mmol/L; 454 ± 33 in water-control group | 13C-MRS | Gonzalez 2015 [13] |
| Liver glycogen: typical and range | 80 g (0–160 g) | Review table (Hargreaves 2012) | Murray & Rosenbloom 2018 [19] |
| Muscle glycogen, vastus lateralis, normal CHO | 462 ± 132 mmol/kg dw (≈107 mmol/kg ww) at VO2max 53 ± 8 | Meta-regression, 181 studies, males | Areta & Hopkins 2018 [20] |
| Effect of high CHO (≥6 g/kg/d ≥3 d) | +102 ± 47 mmol/kg dw | Same | [20] |
| Effect of low CHO + depletion | −253 ± 30 mmol/kg dw | Same | [20] |
| Effect of +10 mL/kg/min VO2max | +29 (low CHO), +67 (normal), +80 (high CHO) mmol/kg dw; small increases in females | Same | [20] |
| Normal range / after 3 d fat+protein / after 3 d high CHO | 0.93–2.0 g/100 g ww normal; mixed diet 1.75, fat+protein 0.63, CHO 3.31 g/100 g ww (≈108 / 39 / 204 mmol/kg ww); max 4.7 g/100 g (≈290 mmol/kg) | 9 healthy men, after exhaustive exercise | Bergström 1967 [21] |
| 1-day loading ceiling | 95 → 180 mmol/kg ww after 24 h of 10 g/kg/d high-GI CHO while inactive; no further rise at 72 h | 8 endurance-trained men | Bussau 2002 [22] |
| Classic vs moderate loading | 207, 203 vs 159 mmol/kg ww (gastrocnemius) | Trained runners | Sherman 1981 [23] |
| 72 h at 12 g/kg/d after depletion | 72.7 → 169.4 mmol/kg ww; total body water (D2O) 39.3 → 40.2 kg | 8 men | Shiose 2016 [3] |
| Whole-body glycogen capacity | ≈15 g/kg BM; a gain of ≈500 g above normal is accommodated before net lipid synthesis | 3 men, 7-d CHO overfeeding after depletion | Acheson 1988 [42] |
| Skeletal muscle mass | 33.0 kg (38.4% BM) men; 21.0 kg (30.6%) women | MRI, n = 468 | Janssen 2000 [30] |
| Water per g glycogen | "3–4 g" (Olsson & Saltin 1970, tritium dilution + biopsies) [1]; ≥3 g recovered with glycogen when fluid was restricted; 1:17 with full rehydration (water not bound to glycogen) [2]; 2.7–4 g quoted [3]; human evidence "inconclusive", animal liver 1.6–3.8 g/g [4] | Humans / animals | [1][2][3][4] |
| Potassium per g glycogen | 0.45 mmol K/g | VLCD subjects (total body K) | Kreitzman 1992 [5] |

**What the data really show about water.** The "3–4 g/g" number goes back to Olsson & Saltin 1970 [1]. The best biopsy study (Fernández-Elías 2015) found at least 3 g of water stored per g of glycogen re-synthesised when little fluid was given. With full rehydration the ratio was 1:17, because extra water that is not bound to glycogen is also stored [2]. Shiose 2016 measured whole-body water with D2O [3]. Muscle glycogen rose by ≈97 mmol/kg ww (≈15.7 g/kg ww), which is ≈440 g across ≈28 kg of muscle (muscle mass assumed), while total body water rose by only 0.9 kg. That implies ≈2 g water per g glycogen (derived here; D2O precision is ±0.5 kg). **Model choice: h = 3.0 g/g (uncertainty 2–4).** Grade B− (the direction is robust; the ratio varies with hydration).

**Equations**
```
G_L,max = C_L,max · V_liv · 0.162          ; C_L,max = 500 mmol/L  →  ≈ 115 g for 1.45 L
G_M,max = Σ_j 0.162 · c_M,max · SMM_j       ; c_M,max = 200 mmol/kg ww (180–290)
G_cap   = G_L,max + G_M,max                 ; sanity check ≈ 15 g/kg BM [42]
W_G     = h · (G_L + G_M) / 1000            ; kg, h = 3.0
ΔScaleWeight_glycogen = (1 + h) · ΔG_tot / 1000   (kg)  — add ECF/sodium effects from dossiers 13/15
K_G     = 0.45 · (G_L + G_M)                ; mmol
```

| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| C_L,max | 500 | mmol/L liver | 400–550 | [13] (454 observed), Murray range 160 g [19] |
| V_liv | 1.45 | L | 1.2–1.8 | [7][8][15] |
| c_M,max | 200 | mmol/kg ww | 180–290 | [21][22][23][3] |
| c_M normal | 80–130 | mmol/kg ww | by fitness | [20][21] |
| h | 3.0 | g water/g glycogen | 2–4 | [1][2][3][4] |
| k_K | 0.45 | mmol K/g glycogen | — | [5] |

**Time dynamics:** see §4.2–4.9. **Moderators:** training raises resting and maximal muscle glycogen (+67 mmol/kg dw per +10 mL/kg/min VO2max on a normal diet) [20]. Women have slightly higher concentrations [20] but less muscle mass [30]. T2D lowers liver glycogen (131 vs 282 mmol/L) [7] and muscle glycogen (57 vs 69 mmol/L) [28].
**Evidence grade: A−** for stores and capacity (many biopsy and 13C-MRS studies plus a meta-analysis). **B−** for the water ratio.

---

### 4.2 Liver glycogen during fasting (hourly)

**Mechanism.** After absorption ends (≈4–6 h after a meal), hepatic glucose output (HGO) is supplied by net glycogenolysis plus gluconeogenesis (GNG). The glycogenolysis share falls as the store shrinks. GNG supplies 64 ± 5% of glucose production in the first 22 h of fasting, 82 ± 5% in the next 14 h, and 96 ± 1% in a later 18-h period of a 68-h fast [6]. Overnight net liver glycogen depletion is ≈0.93 mg/kg/min (46% of glucose production, which is 2.19 mg/kg/min) [9]. By 60 h, glucose production falls to 1.43 mg/kg/min, with 78% from GNG [9].

**Data points (for fitting)**

| Condition | Observation | Source |
|---|---|---|
| Controls, 4 h → 22.5 h after meal | 282 → 98 mmol/L; mean decline 10.5 ± 2.0 mmol/(L·h); liver 1.19 L ⇒ ≈2.0 g/h (derived); net glycogenolysis 2.8 µmol/kg/min; GNG 70% of GP | Magnusson 1992 [7] |
| Evening meal + 4 h → 06:00 | 350 → 207 mmol/L (≈−41% in ~10.5 h); liver 1.44 L ⇒ ≈3.2 g/h (derived) | Taylor 1996 [8] |
| 20:00 → 06:00 | liver glycogen −21 to −23%; muscle +2–3% (unchanged) | Iwayama 2021 [12] |
| Overnight fast (tracer) | net hepatic glycogen depletion 0.93 mg/kg/min ⇒ ≈3.9 g/h for 70 kg (derived) | Hellerstein 1997 [9] |
| 0–22 h, next 14 h, later 18 h | GNG fraction 64%, 82%, 96% ⇒ glycogenolysis ≈3.0, 1.4 and 0.25 g/h (derived assuming GP 2.0 → 1.5 mg/kg/min, 70 kg) | Rothman 1991 [6], Hellerstein [9] |

**Equation — PROPOSED FIT (first-order with floor)**
```
J_L,out(t) = (G_L − G_L,floor)/τ_L · (1 − σ_fed(t)) + J_L,ex(t)          [g/h]
dG_L/dt    = S_L(t) − J_L,out(t)                                            (S_L in §4.8)
σ_fed(t)   = suppression of glycogenolysis while exogenous glucose is appearing:
             σ_fed = min(1, Ra_glc,total(t) / R_half),  R_half = 10 g/h
```
Fitted parameters (data: [6][7][8][9][12]). An exponential with τ_L = 24 h gives −35% over 10.5 h (Taylor: −41%) and −54% over 18.5 h (Magnusson: −65%). From 97 g it gives ≈2.5 g/h over 0–22 h, 1.2 g/h over 22–36 h and 0.45 g/h late (Rothman-derived: 3.0/1.4/0.25).

| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| τ_L | 24 | h | 18–36 | fitted to [7][8][12] |
| G_L,floor | 5 | g | 0–15 (UNVERIFIED) | glycogen cycling persists at 60 h [9] |
| R_half | 10 | g/h | UNVERIFIED | HGO fully suppressed within 30 min of a 139 g glucose meal and back to basal by ≈4–5 h [8] |

**Time dynamics.** Half-life ≈17 h (ln2·24 h). An overnight fast (10–12 h) removes ≈25–40%. At 24 h, ≈60–65% is gone (≈15–25 g left). At 48 h, ≈85–90% is gone. Liver glycogen depletion is the main driver of rising ketogenesis (hand-off to dossier 05). **Moderators:** T2D has lower glycogen and lower net glycogenolysis (1.3 vs 2.8 µmol/kg/min), with GNG 88% of GP [7]. Liver volume shrinks ≈23% over 67 h of fasting [7]. Scale by liver volume and body mass.
**Evidence grade: A−** (direct 13C-MRS time series in several studies). The floor value is grade C.

---

### 4.3 Liver glycogen during exercise

**Mechanism.** Exercise raises hepatic glucose output in step with intensity. Liver glycogen is spared if carbohydrate is eaten at a high enough rate.

**Data.** 3 h at 50% Wpeak with water only: 454 → 283 mmol/L (≈−50 g in a ~1.8 L liver, ≈17 g/h, derived). With 1.7 g/min glucose or sucrose: no decline (325 → 345; 321 → 348 mmol/L) [13]. Ingesting >1.5 g/min prevents liver glycogen depletion during moderate exercise [14]. 60 min running at 70% VO2max before breakfast took liver glycogen from −23% (overnight) to −46% of the evening value [12], ≈13 g/h extra (derived).

**Equation — PROPOSED FIT**
```
J_L,ex(t) = 30 · max(0, I − 0.20) · (G_L/G_L,ref)^0.5 · (1 − min(1, CHO_in,ex / 1.2))    [g/h]
I = fraction of VO2max; CHO_in,ex = carbohydrate ingested during exercise (g/min); G_L,ref = 80 g
```
This gives ≈9 g/h at 50%, ≈13.5 g/h at 65% and ≈19.5 g/h at 85% VO2max.
| Parameter | Value | Uncertainty | Source |
|---|---|---|---|
| slope | 30 g/h per unit I | ±50% | [12][13] |
| threshold | 0.20 VO2max | 0.15–0.30 | UNVERIFIED |
| full sparing | CHO intake ≥1.2–1.5 g/min | — | [13][14] |
**Evidence grade: C** (two 13C-MRS studies; intensity dependence is interpolated). Coordinate with dossier 10.

---

### 4.4 Muscle glycogen use during endurance exercise

**Mechanism.** Muscle glycogenolysis rises steeply with intensity, because more type-II fibres are recruited and phosphorylase is activated. It is faster when starting glycogen is higher, and it slows over time. Keto-adaptation reduces glycogen use at submaximal intensities about 4-fold. At 25% VO2max, muscle glycogen oxidation is negligible and plasma FFA dominate. From 65% to 85% VO2max, glycogen and plasma-glucose oxidation increase with intensity [35][36].

**Data points (active muscle, mmol/kg ww/min)**
| Intensity | Rate | Condition | Source |
|---|---|---|---|
| ≈75% VO2max | 0.88 (mixed diet), 0.54 (fat+protein diet), 1.06 (high-CHO diet) | 14.2, 8.8, 17.1 mg/100 g/min | Bergström 1967 [21] |
| 62–64% VO2max | 0.61 (mixed diet) → 0.13 after 4 wk ketogenic diet (unit reported as mmol/kg/min; ww assumed — UNVERIFIED) | 5 trained cyclists | Phinney 1983 [37] |
| 64% VO2max, 180 min | −64% of pre-exercise, same in keto-adapted and high-CHO athletes | elite ultra-endurance | Volek 2016 [38] |
| 73% VO2max running | 5.0 (loaded) vs 3.1 (moderate) mmol/kg per km | runners | Sherman 1981 [23] |
| 50% Wpeak (≈60% VO2max), 3 h with 1.7 g/min CHO | 101 → 60 mmol/L (≈0.23/min) | 13C-MRS | Gonzalez 2015 [13] |
| +30% VO2max intensity | +87 to +134 mmol/kg dw extra use at 23–116 min | meta-regression | Areta 2018 [20] |
| Initial glycogen +200 mmol/kg dw | more glycogen used | meta-regression | [20] |

**Equation — PROPOSED FIT (per kg of active muscle)**
```
u_ex(I) = 0.9 · ((I − 0.25)/0.50)^1.5     for I > 0.25, else 0       [mmol/kg ww/min]
U_ex,j  = u_ex(I) · (c_M,j/110)^0.5 · (1 − 0.75·A_keto)               [mmol/kg ww/min]
dc_M,j/dt (during exercise) −= U_ex,j ;   grams/h = 60 · 0.162 · U_ex,j · SMM_active,j
```
Fit check: I = 0.50 → 0.32; 0.64 → 0.62; 0.75 → 0.90; 0.85 → 1.18 mmol/kg/min (data 0.23–0.32, 0.46–0.61, 0.88–1.06, n/a). At 70% VO2max, with ≈13 kg of active leg muscle, this gives ≈1.6 g/min from muscle glycogen. **Active muscle mass:** cycling/running ≈0.40·SMM (UNVERIFIED; dossier 10 should supply by modality). Intervals >90% VO2max: use u ≈ 2.5–4 mmol/kg/min during work bouts (UNVERIFIED; Murray cites up to 40 mmol/kg/min for all-out sprints [19]).

| Parameter | Value | Uncertainty | Source |
|---|---|---|---|
| u at 75% VO2max | 0.9 mmol/kg ww/min | ±30% | [21][23] |
| exponent on intensity | 1.5 | 1.2–2 | fit |
| glycogen-availability exponent | 0.5 | 0.3–1.9 (Bergström ≈0.3–0.5; Sherman ≈1.9) | [21][23] |
| keto-adaptation reduction | 75% | 60–80% (Phinney 79%) | [37] |
Floor: muscle glycogen does not fall below ≈10% of the initial value [19].
**Evidence grade: B** (many biopsy studies, but the rates are pooled across protocols).

---

### 4.5 Muscle glycogen use during resistance exercise

**Data.** Biceps: −12% after 1 set and −24% after 3 sets at 80% 1-RM [32]. Leg extension: 6 sets at 70% or 35% 1-RM with equal work gave the same −47 mmol/kg ww; the rate was about double at 70% [31]. 5 sets × 4 lower-body exercises (≈30 min): 160 → 118 mmol/kg ww (−26%) [34]. ≈45-min whole-body session in untrained men: −23% (type I), −40% (IIa), −44% (IIx) [33]. Review range: −25 to −40% [19]. No net resynthesis over 2 h fasted recovery in untrained [33]. +14–22 mmol/kg in 2 h without food (lactate-derived) in trained [31].

**Equation — PROPOSED FIT (per trained muscle group, per session)**
```
D_RT,j = D_max · (1 − exp(−sets_j / s0))           fraction of c_M,j removed during the session
c_M,j ← c_M,j · (1 − D_RT,j · (c_M,j/110)^0.3)      (applied over the session duration)
```
| Parameter | Value | Uncertainty | Source / fit |
|---|---|---|---|
| D_max | 0.40 | 0.25–0.50 | [19][32][33] |
| s0 | 3 sets | 2–5 | fit: 1 set → 11% (obs 12%), 3 → 25% (24%), 6 → 35% (≈30–38%), ≥15 → 40% (Tesch 26%) |
Whole-body grams: sum over trained groups (e.g., a leg day with 12 sets ≈ 0.39 × leg glycogen ≈ 100–150 g).
**Evidence grade: B−** (consistent small biopsy studies). Set counts come from dossier 09.

---

### 4.6 Muscle glycogen at rest, during low-carbohydrate intake and with keto-adaptation

**Mechanism.** Resting muscle hardly uses its own glycogen. Overnight fasting leaves it unchanged (+2–3%) [12][19]. After a meal, gastrocnemius glycogen rises (69 → 97 mmol/L at 240 min) [28], and net breakdown resumes ≈5 h later, with lactate returning to the liver [8]. On low carbohydrate intake, meals no longer refill muscle while this slow breakdown and any exercise continue, so muscle glycogen drifts down over days. Weeks of keto-adaptation reduce glycolytic flux, and athletes adapted for months show resting glycogen similar to high-CHO athletes [38].

**Data points**
| Condition | Result | Source |
|---|---|---|
| 3 d LCHF (65% fat, 20% CHO) vs HCLF (70% CHO), trained men | 439 → 358 (−18%) vs 407 → 498 (+22%) mmol/kg dw | Tarry 2025 [39] |
| 3 d fat+protein diet after exhaustive exercise | glycogen recovered to ≈30% of initial (0.63 g/100 g) | Bergström 1967 [21] |
| Ketogenic diet 4 wk (<20 g/d CHO) | resting glycogen roughly halved (143 → 76 — UNVERIFIED, abstract gives only use rates) | Phinney 1983 [37] |
| Keto-adapted >6 months (≈10% CHO) | resting glycogen not different from high-CHO athletes; same depletion (−64%) and 2-h repletion (−36% of pre) | Volek 2016 [38] |

**Equation — PROPOSED FIT (resting, post-absorptive hours only)**
```
J_M,rest,j = k_Mr · (c_M,j − c_M,floor) · (1 − σ_fed(t)) · (1 − 0.5·A_keto)     [mmol/kg ww/h]
```
The released carbon goes to lactate → liver (Cori cycle). Book it as an input to hepatic glucose production, **not** as carbohydrate oxidation.
| Parameter | Value | Uncertainty | Calibration |
|---|---|---|---|
| k_Mr | 0.0035 /h | 0.002–0.005 | ≈−14% over 3 d at 20%E CHO with ~16 post-absorptive h/d (Tarry −18%); ≈−5%/d decay of supercompensated stores (Arnall, §4.9) |
| c_M,floor | 25 mmol/kg ww | 15–40 | UNVERIFIED |
Keto-adapted restoration: glycogen synthesis from gluconeogenic carbon (glycerol, amino acids, lactate) is captured in §4.11 via the `GNG_gly` (glycerol) input and the `A_keto` term. The target is ≈80–100% of normal glycogen after ≥3 months of adaptation [38].
**Time to a new steady state on very-low-CHO intake:** liver ≈1–2 days (§4.2). Muscle falls ≈15–30% in 3–7 days, depending on activity. It recovers toward normal over weeks to months if keto-adaptation completes (grade C).
**Evidence grade: C** (few studies, varied protocols, the key Phinney number is unverified).

---

### 4.7 Muscle glycogen repletion

**Mechanism.** Recovery is biphasic. A rapid, insulin-independent phase lasts 30–60 min after glycogen-depleting exercise (GLUT4 translocation). A slower, insulin-dependent phase can last hours [25]. Low glycogen strongly activates glycogen synthase [25]. The rate depends on carbohydrate supply up to ≈1.0–1.2 g/kg/h. Adding protein helps only when carbohydrate is below that level [25][27].

**Data points**
| Condition | Rate / result | Source |
|---|---|---|
| 2 g/kg immediately post-exercise vs 2 h delayed | 7.7 vs 2.5 mmol/kg ww/h in first 2 h; 4.3 vs 4.1 in hours 2–4 (delayed still 45% slower) | Ivy 1988 [26] |
| 1.0–1.85 g/kg/h CHO at 15–60 min intervals, up to 5 h | highest reported rates; delay → ~50% lower | Jentjens & Jeukendrup 2003 [25] |
| 1.0–1.2 g/kg/h | 10–11 mmol/kg ww/h | Murray 2018 (review) [19] |
| Max rate ≈10 mmol/kg/h sustained ≈4 h, then ≈50% (4–6) | depletion of 150 mmol/kg needs ≈24 h | [19] |
| 10 g/kg/d high-GI over 24 h | 106 mmol/kg ww/d (≈4.4/h); low-GI 72 | Burke (cited in [19]) |
| 24 h at 9.8 vs 1.9 g/kg/d | 93% vs 13% of glycogen used in 2 h at 65% VO2max restored | Starling (cited in [19]) |
| No CHO | 1–2 mmol/kg ww/h (GNG/lactate), none after ~4 h; 2–12 mmol/kg dw/h in 4 h fasted | [16][19] |
| 1.5 g/kg/h glucose or sucrose, 5 h | 85 → 140 vs 86 → 136 mmol/L (no difference) | Fuchs 2016 [15] |
| Protein co-ingestion | helps only when CHO <1.2 g/kg/h; 0.3–0.4 g/kg protein augments synthesis | [19][25][27] |
| Sedentary mixed meal (190 g CHO) | gastrocnemius 69 → 97 mmol/L at 240 min (≈7 mmol/L/h); T2D 57 → 66 | Carey 2003 [28] |
| Glycogen synthesis under clamp (insulin 400 pmol/L, glucose 10 mM) | 183 ± 39 vs 78 ± 28 µmol/kg ww/min (normal vs T2D); muscle glycogen synthesis ≈ most of whole-body glucose uptake | Shulman 1990 [29] |

**Equation — PROPOSED FIT (per muscle group j, per hour)**
```
S_M,j = S_max · Φ(R) · (1 − (c_M,j/c_M,cap)^4) · (1 + E_ex,j) · S_mus^0.5 · T_C^0.5     [mmol/kg ww/h]
Φ(R)  = R_eff / (R_eff + K_R) ;   R_eff = R_CHO + 0.5 · min(R_prot, 0.4)·[R_CHO < 1.0]   (g/kg BM/h)
E_ex,j(t) = E_rapid·exp(−Δt/τ_E1) + E_slow·exp(−Δt/τ_E2)    (Δt = time since the session that depleted muscle j)
c_M,cap = 200 mmol/kg ww (180–220; up to 290 in extreme loading)
Supply constraint: Σ_j S_M,j·0.162·SMM_j ≤ glucose available after the liver and oxidation (§4.10)
```
| Symbol | Value | Unit | Uncertainty | Calibration |
|---|---|---|---|---|
| S_max | 7.5 | mmol/kg ww/h | 5–10 | Bussau: +85 in 24 h at 10 g/kg/d, inactive; Carey: +28 in 4 h |
| K_R | 0.3 | g/kg/h | 0.2–0.5 | saturation near 1.0–1.2 g/kg/h [25] |
| E_rapid | 1.0 | — | 0.5–1.5 | 1.2 g/kg/h post-exercise → ≈12/h (obs 10–11) |
| τ_E1 | 1.5 | h | 1–3 | Ivy delayed-feeding penalty [26] |
| E_slow | 0.3 | — | 0.1–0.5 | enhanced insulin action for 48 h [95] |
| τ_E2 | 36 | h | 24–48 | effect present at 48 h, gone by 5 d [95] |
| protein credit | 0.5 g CHO-equivalent per g protein when CHO <1.0 g/kg/h, protein ≤0.4 g/kg | — | UNVERIFIED magnitude | [19][25][27] |
Without carbohydrate (Φ≈0) there is post-exercise resynthesis from lactate: S = 1.5 mmol/kg/h × exp(−Δt/1.5 h) (data: 1–2 mmol/kg/h, ≈0 after 4 h [19][26]; Robergs +14–22 in 2 h [31]).
**Evidence grade: A−** for the rates (reviews plus many RCTs). **C** for the exact functional form.

---

### 4.8 Liver glycogen repletion and the role of fructose/galactose

**Mechanism.** About 19% of an oral glucose meal is stored as net liver glycogen [8], through direct and indirect (gluconeogenic) pathways: 46% direct at 2–4 h and 68% at 4–6 h [8]. Fructose is extracted by the liver on first pass. Via fructose-1-phosphate it releases glucokinase from its regulatory protein [16], which about doubles liver glycogen repletion when co-ingested with glucose [16][17][15].

**Data points**
| Condition | Result | Source |
|---|---|---|
| Liquid mixed meal, 139 g glucose | +0.34 mmol/(L·min) (≈20 mmol/L/h ≈4.7 g/h), +28 g at peak | Taylor 1996 [8] |
| Post-exercise glucose only (≥0.9 g/kg/h) | ≈3.5 g/h | Fuchs 2019 review [16] |
| Post-exercise glucose + fructose or sucrose | ≈7.4 g/h (≈2×) | [16][17][15] |
| 1.5 g/kg/h sucrose vs glucose, 5 h | 53.6 → 86.8 g vs 49.3 → 65.7 g; +3.4 g/h (95% CI 1.6–5.1) with sucrose | Fuchs 2016 [15] |
| 69 g CHO/h maltodextrin + fructose or galactose vs + glucose | 24 ± 2 mmol/L/h with fructose; ≈2× glucose | Décombaz 2011 [17] |
| 1 g/kg glucose vs sucrose after exercise | +13 ± 8 g vs +25 ± 5 g liver in 4 h; no muscle resynthesis | Casey 2000 [18] |
| Fructose fate (tracer review) | 45 ± 11% oxidised within 3–6 h (rest); 41 ± 11% converted to glucose within 3–6 h; ≈25% to lactate; <1% directly to plasma TG; ≥15% to liver glycogen | Sun & Empie 2012 [108], Fuchs 2019 [16] |

**Equation — PROPOSED FIT**
```
S_L = min( V_L,syn ,  α_glc·Ra_glc,portal + α_fru·(Ra_fru + Ra_gal) ) · (1 − G_L/G_L,max)^0.5   [g/h]
α_glc = 0.20 at rest ; 0.10 when any E_ex,j > 0.3 (muscle competes after exercise)
α_fru = 0.15 (direct glycogen); remaining fructose: 0.40 → glucose released (1-h delay) ; 0.45 → oxidised (counts as CHO oxidation)
```
| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| α_glc (rest) | 0.20 | — | 0.15–0.25 | 19% of meal glucose [8] |
| α_glc (post-exercise) | 0.10 | — | 0.05–0.15 | ≈3.5 g/h at ≈60 g/h absorbed glucose [15][16] |
| α_fru | 0.15 | — | 0.07–0.30 | [16][108]; sucrose adds ≈3.4 g/h [15] |
| V_L,syn | 8 | g/h | 6–10 | max observed ≈7.4 g/h [16] |
**Evidence grade: B** (several 13C-MRS RCTs; the fractional split is fitted).

---

### 4.9 Supercompensation: time course and decay

**Data.** Classic 3 d low-CHO + 3 d high-CHO: 207 mmol/kg ww. Moderate protocol: 203. 6 d at 50% CHO: 159 [23]. One day of 10 g/kg/d high-GI while inactive: 95 → 180 mmol/kg ww, with no further gain on days 2–3 [22]. 72 h at 12 g/kg/d after depletion: 73 → 169 [3]. **Persistence:** after a 3-day load and then a 60%-CHO diet with limited activity, stores fall 34%, 20% and 46% from peak at 3, 5 and 7 days. They remain significantly elevated for up to 5 days [24].
**Model behaviour required:** (a) the depletion-then-load and simple-load protocols both reach ≈180–210 mmol/kg in 24–72 h. This needs a sharp saturation `(1 − (c/c_cap)^4)` plus E_ex from depletion. (b) Decay under a normal diet at rest is ≈5%/d, from `k_Mr` in §4.6 (because synthesis from meals ≈0 near the cap).
Scale weight: +1.0–1.5 kg with loading (body water) [4]; Shiose: +0.9 kg total body water [3].
**Evidence grade: B.**

---

### 4.10 Hourly carbohydrate-disposal rule set (meal → oxidation / storage / DNL)

**Mechanism in plain language.** Absorbed glucose goes first to obligatory users (brain, red cells). The liver takes about a fifth of it into glycogen. Insulin then shifts the body's fuel mix toward carbohydrate, which cuts fat oxidation. Muscle stores most of what is left, up to its capacity. Only when both liver and muscle are close to full, and intake still exceeds maximal oxidation, does carbohydrate go to net fat synthesis. Even one 479 g starch meal was 72% stored as glycogen and 28% oxidised over 10 h, with NPRQ 0.91–0.98 and no net DNL [41]. Glucose uptake under insulin is mostly muscle glycogen synthesis [29].

**Algorithm (PROPOSED; every coefficient is sourced in the table or in §4.2–4.9).** Time step Δt = 1 h (use 10–15 min sub-steps for glucose/insulin curves).
```
for each hour t:
  # 1. Absorption (per meal m): gamma kernel, shape k = 2, scale θ_m = t_p,m (§4.16)
  Ra_glc(t) = Σ_m C_glc,m · (t−t_m)/θ_m² · exp(−(t−t_m)/θ_m)          [g/h]; same for Ra_fru, Ra_gal
  cap: Ra_glc ≤ 60 g/h ; Ra_glc + Ra_fru ≤ 90–105 g/h  (excess is queued to later hours)
  # 2. Fructose/galactose first pass (liver)
  to_glycogen_L += α_fru·(Ra_fru+Ra_gal) ; Ra_glc_delayed(t+1h) += 0.40·(Ra_fru+Ra_gal) ; CHOox_fru = 0.45·(Ra_fru+Ra_gal)
  # 3. Liver: glycogen synthesis S_L (§4.8), glycogenolysis J_L,out suppressed by σ_fed (§4.2)
  # 4. Oxidation demand (non-protein energy EE_np from dossiers 01/02/10)
  f_C,pa = clamp( 0.45 · (G_tot/G_ref)^2 · (1 − 0.75·A_keto) , 0.05 , 0.85 )     # post-absorptive CHO share
  f_C(t) = f_C,pa + (f_C,max − f_C,pa) · Ins(t)^2 / (Ins(t)^2 + EC50_ox^2)
  CHOox(t) = f_C(t) · EE_np(t) / 4.1         [g/h]   (≥ brain floor 4.5–6 g/h unless ketone-adapted, §4.22)
  FATox(t) = (1 − f_C(t)) · EE_np(t) / 9.4   [g/h]
  # 5. Allocation of exogenous glucose supply  A = Ra_glc + Ra_glc_delayed   [g/h]
  L_up  = min(V_L,syn − to_glycogen_L, α_glc·A·(1 − G_L/G_L,max)^0.5)   → liver glycogen (§4.8)
  A1    = A − L_up
  Ox_ex = min(A1, max(0, CHOox(t) − CHOox_fru))                        → exogenous glucose oxidised
  A2    = A1 − Ox_ex
  M_up  = min(A2, Σ_j S_M,j · 0.162 · SMM_j)                           → muscle glycogen (S_M mmol/kg/h × kg × 0.162 g/mmol; §4.7)
  A3    = A2 − M_up                                                    → if G_tot ≥ 0.95·G_cap: DNL_glc += A3 ; else carry A3 to t+1 (raises glucose)
  # 6. Endogenous supply: HGO(t) = max(0, CHOox(t) − CHOox_fru − Ox_ex) is met by J_L,out (§4.2) + J_M,rest lactate (§4.6) + GNG (§4.22);
  #    if endogenous supply < demand, CHOox is reduced and FATox (and ketones, dossier 05) cover the gap.
  # 7. Update G_L, c_M,j, W_G, K_G; DNL_fat = DNL_glc/3.2 ; energy lost as heat = 0.28·4.1·DNL_glc (§4.13)
```

| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| Max intestinal glucose absorption | ≈1.0–1.1 g/min (60–66 g/h) | — | — | peak exogenous glucose oxidation ≈1.1 g/min [16] |
| Glucose + fructose | ≈1.5–1.75 g/min | — | — | [16] |
| f_C,pa at reference glycogen | 0.45 | — | 0.35–0.55 | post-absorptive NPRQ 0.83–0.84 on mixed diets [7][43] ⇒ (0.84−0.707)/0.293 ≈ 0.45 |
| f_C,max | 0.95 | — | 0.9–1.0 | NPRQ 0.91–0.98 after 479 g meal [41] |
| EC50_ox (insulin suppressing FFA oxidation) | 54 µU/mL (324 pM) | — | ±60 pM | Campbell 1992 [70] |
| Energy per g glycogen/starch oxidised | 4.1–4.2 kcal | — | — | standard (UNVERIFIED primary here) |
| Brain/obligatory glucose | 110–145 g/d (4.6–6 g/h) fed state | — | — | Owen 1967 (citing earlier work) [116] |

**Consistency check vs Acheson 1982 [41]** (70 kg, 479 g starch, 10 h). Observed: CHO ox 133 g, glycogen gain 346 g, SDA 5.9%, NPRQ 0.91–0.98. Rule set: EE_np ≈ 750 kcal/10 h × f_C ≈ 0.7 → ≈128 g oxidised. Storage ≈ liver ≈40–60 g + muscle ≈280–300 g (c_M +55 mmol/kg in 33 kg muscle, i.e. ≈5.5 mmol/kg/h). Net DNL = 0 because G_tot stays below G_cap.
**Evidence grade: B** for the overall partition (tracer, calorimetry and MRS data). **C** for the individual coefficients.

---

### 4.11 Daily reduced-form carbohydrate balance and oxidation autoregulation (planner / fast mode)

**Mechanism.** Glycogen stores are small relative to intake, so carbohydrate oxidation tracks carbohydrate intake within about 1–3 days, working through glycogen level and insulin [51][52]. Fat oxidation has no such direct drive. It is simply the energy left over after carbohydrate and protein oxidation, so fat intake barely changes it and fat balance absorbs the error [51][53][54]. On day 7 of a high-CHO diet, CHO oxidation vs intake had a slope of 0.99; on day 7 of a high-fat diet, fat oxidation vs intake had a slope of 0.50 (lean only; none in obese) [54]. Diet composition shifted substrate oxidation rapidly without changing 24-h energy expenditure [53].

**Equation — Hall-type quadratic law.** Hall's models use a quadratic glycogen-dependence of carbohydrate oxidation (reported form ρ_G dG/dt = CI − k_G·G², k_G = CI_b/G_init²). The exact published form is UNVERIFIED here; confirm with dossier 01.
```
dG_tot/dt = CI_d + GNG_gly − C_ox,rest − C_ox,ex − DNL_glc                        [g/d]
C_ox,rest = min( k_G · G_tot² · (1 − 0.75·A_keto) ,  (TEE − EE_ex)/4.1 )
k_G       = CI_hab / G_ref²          (CI_hab = habitual digestible CHO g/d; G_ref = initial G_tot)
GNG_gly   = glycerol-derived glucose ≈ 0.10 · (fat oxidised, g/d)          (Owen: glycerol ≈10% of TG mass [116])
DNL_glc   = max(0, G_tot + dG − G_cap) and any intake above the oxidation cap (§4.13)
C_ox,ex   = carbohydrate used in exercise (dossier 10; muscle part from §4.4–4.5)
FATox_d   = TEE − 4.1·C_ox − 4.7·P_ox (− alcohol)   → fat balance = FI + DNL_fat − FATox_d
```
Convention: C_ox is **net** (calorimetric) carbohydrate oxidation. Glucose made from amino acids is booked under protein oxidation (dossier 03), so it is not added again here. If the engine books gross glucose oxidation instead, add `GNG_P = 0.57 g glucose per g protein oxidised via gluconeogenesis` [116].

**Behaviour and fit to data (derivations shown).**
- Steady state: `G_ss = G_ref·sqrt(CI/CI_hab)`. For a switch from ≈350 to ≈150 g/d CHO (≈45 → 20%E, gram values assumed): −35% glycogen at steady state. Tarry observed −18% in muscle after only 3 days at 20%E [39]. For ≈525 g/d (70%E): +22% (Tarry +22% [39]; Areta high-CHO +22% [20]).
- Linearised time constant: `τ = 1/(2·k_G·G_ss)`. For G_ref 500 g, CI_hab 330 → 150 g/d: G_ss 337 g, τ ≈ 1.1 d. Predicted daily fat balance +1.5, +0.9, +0.5 MJ on days 1–3 vs observed +1.06, +0.75, +0.55 MJ/d, with a new balance by day 7 (Schrauwen 1997, lean, energy balance [55]; diet composition taken from the companion study, 55 → 25%E CHO [56]).
- Depletion followed by overfeeding (Acheson 1988 [42]). Model CHO ox at G = 250 g: 0.0012·250² = 75 g/d (observed 74 g/d on day 3 of low-CHO). With 783 g/d CHO, ox rises toward ≈400 g/d while G fills. Observed day-1 values: ox 398 g/d, storage 339 g/d. Saturation arrives in ≈4 d at +770 g. G_ss at 1000 g/d CI = sqrt(1000/0.0012) ≈ 913 g, which is close to G_cap.
- Very-low CHO (20 g/d), not adapted: G_ss = sqrt((20+15)/0.0012) ≈ 170 g (≈34% of normal; Bergström 30–36% [21]), τ ≈ 2.4 d. Keto-adapted (A_keto = 1): ≈340 g, i.e. 70% of normal (Volek: ≈normal [38]).
- Glycogen-lowering exercise makes fat oxidation match a new high-fat intake at once (within the 36 h chamber stay) [56]. In the model, lower G ⇒ lower C_ox ⇒ higher FATox. Physical activity speeds the RQ fall on a switch to high fat [57].
- Hall 2015 ward study (19 adults with obesity, −30% energy by cutting CHO vs cutting fat) [58]. Cutting CHO raised net fat oxidation by 463 ± 63 kcal/d and lowered CHO oxidation by 595 ± 57 kcal/d by day 6. Cutting fat changed fat oxidation only on day 1 (−96 kcal/d), with CHO oxidation +147 kcal/d on day 1 and no sustained change in RQ.

| Parameter | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| G_ref | initial G_tot (≈500 g for a 75 kg man) | g | ±30% | §2 |
| k_G | CI_hab/G_ref² (≈0.0012 d⁻¹g⁻¹) | — | — | Hall-type (UNVERIFIED exact form) |
| keto-adaptation reduction | 0.75 | — | 0.6–0.9 | [37][38] |
| oxidation time constant | 1–3 d | d | — | [53][55][58] |
**Evidence grade: A−** for the qualitative law (CHO oxidation tracks CHO intake fast, fat oxidation lags, several ward/chamber studies). **B/C** for the quadratic form and its parameters.

---

### 4.12 Respiratory quotient, food quotient and 24-h fat balance

**Mechanism.** At macronutrient and energy balance, 24-h RQ equals the food quotient (FQ) [52]. On a carbohydrate-lowering switch, RQ drifts down to the new FQ as glycogen falls (§4.11). The engine should output RQ as a derived metric and use it to check the sign of fat balance.

**Equations**
```
Frayn (1983) [74]:  CHO_ox (g/min) = 4.55·VCO2 − 3.21·VO2 − 2.87·n ;  FAT_ox (g/min) = 1.67·VO2 − 1.67·VCO2 − 1.92·n
                    (VO2, VCO2 L/min; n = urinary N g/min).  Coefficients quoted as widely used; UNVERIFIED against the full text.
Apparent CHO ox includes carbohydrate used for lipogenesis minus carbohydrate made from amino acids; negative FAT_ox = net lipogenesis [74].
Engine inverse (for display):  VO2 = 0.829·C + 2.019·F + 0.966·P ;  VCO2 = 0.829·C + 1.427·F + 0.781·P   (L, grams oxidised;
                    per-gram factors UNVERIFIED here — see Livesey & Elia 1988 [75])
RQ_24h = VCO2/VO2 ;   FQ = same formula applied to intake (C,F,P) ;  NPRQ > 1.0 ⇔ net DNL.
```
Data: fasting NPRQ after 5-d diets: −50% CHO 0.77; −25% 0.80; eucaloric 0.84; +25% 0.91; +50% 0.95 [43]. Isocaloric ketogenic diet: RQ −0.111 ± 0.003 [59]. Carbohydrate overfeeding with saturated stores: 24-h NPRQ 1.15 [42].
**Evidence grade: A** (textbook indirect-calorimetry theory, validated in chamber studies).

---

### 4.13 De novo lipogenesis (DNL)

**Mechanism.** Hepatic DNL rises many-fold with carbohydrate excess, and especially with sugars and fructose. In absolute terms it stays small (≤5–10 g fat/d) unless carbohydrate intake exceeds total energy expenditure and glycogen is saturated [43][47][50]. In that case whole-body net DNL, mostly in adipose tissue, can reach ≈150–240 g/d [42][49]. Surplus carbohydrate is mainly handled by *sparing fat oxidation*, not by converting it to fat [43][50]. Replacing fat with carbohydrate at equal energy "does not induce hepatic DNL to any substantial degree" [50]. In formula-fed volunteers, however, fractional VLDL DNL can reach 44% [45], and it is reversed by swapping sugar for starch in solid food [46].

**Data points**
| Condition | fDNL / DNL | Source |
|---|---|---|
| 5-d diets, fasting (fed) fDNL | −50% CHO ≈0.1%; −25% ≈1.0%; +25% CHO 10.6% (23.2%); +50% CHO 20.1% (30.4%); absolute hepatic DNL 3.3 ± 0.8 (method 1) / 3.4 ± 0.4 g/d (method 2) at +50% CHO; stoichiometry 2.8 g glucose per g fatty acid | Schwarz 1995 [43] |
| Isoenergetic high-fat low-CHO (5 d) | 1.6 ± 0.5% (lean normoinsulinaemic), 2.3 ± 0.3% (obese normoinsulinaemic), 8.5 ± 0.7% (hyperinsulinaemic obese) | Schwarz 2003 [44] |
| Isoenergetic low-fat high-CHO (5 d) | 13 ± 5.1% (lean), 12.8 ± 1.4% (hyperinsulinaemic obese); TG rose, correlated with fDNL | Schwarz 2003 [44] |
| 25 d liquid formula, 10% fat / 75% glucose polymers, eucaloric | newly synthesised FA = 44 ± 10% of VLDL-TG | Hudgins 1996 [45] |
| Same then solid food 10% fat / 75% starch-sugar-fibre | 30–54% → 0–1%; stimulation persisted with 75% sugar | Hudgins 1998 [46] |
| +50% energy as sucrose or glucose, 96 h | DNL 2–3× control; VLDL DNL 2 g/d (control) to ≤10 g/d; fat balance ≈+275 g over 96 h; sucrose = glucose | McDevitt 2001 [47] |
| 4 d at 175% energy, 71% CHO | whole-body net DNL after 3.25 g/kg FFM glucose load: 35 → 156 mg/kg FFM/5 h (lean); 49 → 64 (overweight) | Minehira 2004 [48] |
| ≈2.5× EE carbohydrate overfeeding, day 1 and day 4 | RER 0.99 and 1.15; whole-body net fat synthesis on day 4 ≈2.2 g/kg/d (units given per min in abstract — typographic; per day implied); hepatic secretion of new FA rose 35× but ≈2% of total | Aarsland 1997 [49] |
| 7-d massive CHO overfeeding after depletion | net DNL ≈150 g lipid/d using ≈475 g CHO/d when saturated; total ≈580 g over 6 d; 142 g/d during last 3 d; 24-h NPRQ 1.15 | Acheson 1988 [42] |
| +1000 kcal/d simple sugars, 3 wk | DNL +98%, IHTG +33% (SAT fat +55%, UNSAT +15%) | Luukkonen 2018 [102] |
| 25% of energy as fructose vs glucose, 10 wk | hepatic DNL and 23-h TG AUC increased only with fructose | Stanhope 2009 [109] |

**Equations**
```
# (a) Whole-body net DNL (energy-relevant; drives fat mass)
DNL_glc = carbohydrate in excess of [oxidation capacity + remaining glycogen room]   (from §4.10/§4.11)
DNL_fat [g/d] = DNL_glc / 3.2            (Acheson: 475 g CHO → ≈150 g lipid ⇒ 3.17 g/g)
Heat cost of DNL = 28% of the carbohydrate energy (derived: 475 g·4.1 kcal = 1950 kcal → 150 g·9.4 = 1410 kcal) ; theoretical 20–25% often cited (UNVERIFIED)
Glycogen storage cost ≈5–7% of energy (UNVERIFIED); TEF of a 479 g CHO meal 5.9% [41] (TEF → dossier 02)

# (b) Hepatic fractional DNL biomarker (does NOT change fat mass by itself) — PROPOSED FIT
fDNL_fast [%] = 3.7 · exp(0.416·(CHO%E − 45)/10) · (1 + 1.5·max(0, EB%)/50) · m_sugar · m_IR
  EB% = (EI − TEE)/TEE·100 ;  m_sugar = 0.5 + 2.0·(free-sugar share of CHO) (= 1.0 at a typical 25% share; UNVERIFIED; range 0.1–3.4 in [45][46]);
  m_IR = 1 + 2.5·max(0, 1 − S_hep)  (hyperinsulinaemia raises fDNL 3.7–5.3× on high-fat diets [44]) ; cap 50%
  fed-state value ≈ 1.5–2 × fasting [43]
Absolute hepatic DNL [g/d] ≈ fDNL/100 · 28 g/d VLDL-FA output   (≈1–10 g/d)  [43][47]
```
Fit anchors for (b): 30% CHO → ≈2% [44]; 75% → ≈13% [44]; +25% CHO & +28% energy → 10.6% (fit 10.6) [43]; +50% CHO & +67% energy → 20.1% (fit 19.8) [43].

**Time dynamics.** fDNL responds within days (5-day diets change it >10-fold) [43] and reverses within days when sugar is replaced by starch [46]. Net DNL starts on day 2 of carbohydrate overfeeding after depletion (NPRQ >1) [42].
**Moderators.** Hyperinsulinaemia/insulin resistance increases fDNL [44]. Overweight subjects showed less whole-body DNL and more glycogen synthesis after overfeeding [48]. Fructose is more lipogenic than glucose per gram at 25%E [109], but sucrose = glucose at +50% overfeeding [47].
**Evidence grade: A−** for "DNL is quantitatively minor unless CHO > TEE with saturated glycogen" (tracer + calorimetry, multiple labs). **C** for the fDNL fitting function.

---

### 4.14 Insulin action on lipolysis and fat oxidation; duration of postprandial suppression

**Mechanism.** Adipose lipolysis is extremely sensitive to insulin: half-maximal suppression happens close to fasting insulin levels. Suppression of FFA *oxidation* needs ≈3–4× more insulin [70]. After a meal, plasma FFA fall for several hours and then rebound above baseline [8]. Carbohydrate therefore lowers fat oxidation acutely. Over a day, however, fat balance is set by total energy and carbohydrate balance (§4.11, §4.15).

**Data points**
| Measure | Value | Source |
|---|---|---|
| EC50 insulin for lipolysis suppression | ≈12 pM free insulin (<2 µU/mL) with pancreatic clamp; palmitate flux 2.5 (insulin withdrawal) → 0.17 µmol/kg/min (max suppression, −93%) | Jensen 1989 [69] |
| EC50 lipolysis / FFA Ra / FFA re-esterification / FFA oxidation | 106 ± 26 / 91 ± 20 / 80 ± 16 / 324 ± 60 pM | Campbell 1992 [70] |
| EC50 systemic / adipose / muscle lipolysis | 51 / 68 / 44 pM | Stumvoll 2000 [71] |
| EC50 for lipolysis correlates with TG and insulin sensitivity (log-log linear) | — | Jensen & Nielsen 2007 [72] |
| 139 g glucose + 17 g fat + 29 g protein liquid meal | FFA 449 → 137 µmol/L at 90 min, suppressed >3 h, rebound to 932 at 540 min | Taylor 1996 [8] |
| 479 g starch meal | insulin peak 139 µU/mL at 90 min, 22 µU/mL at 10 h; only 17 g fat oxidised in 10 h | Acheson 1982 [41] |
| Ketogenic diet (4 wk) | insulin-mediated antilipolysis decreased regardless of test meal | Rosenbaum 2019 [130] |

**Equations — PROPOSED FIT**
```
λ(t)   = Ins(t)^h / (Ins(t)^h + EC50_lip^h)          fraction of lipolysis suppressed
Lip(t) = Lip_max · (1 − λ(t))                         (Lip_max from dossier 05; palmitate-flux range 0.17–2.5 µmol/kg/min [69])
EC50_lip = 10 µU/mL · S_adip^−1   (≈60 pM; literature 2–18 µU/mL [69][70][71]);  h = 2 (UNVERIFIED)
FFA-oxidation suppression uses EC50_ox = 54 µU/mL (324 pM) [70] inside f_C(t) (§4.10)
Postprandial "lipolysis-suppressed window" D_supp = time with λ > 0.8   (derived from the insulin curve, §4.17)
```
Emergent durations with §4.17: 50 g CHO ≈ 3 h; 139 g ≈ 4 h (observed >3 h [8]); 479 g ≈ 10 h (observed ≥10 h low fat oxidation [41]). Quick heuristic when the insulin curve is not simulated (PROPOSED FIT to [8][41]): `D_supp ≈ 0.076·C^0.79 h` (C = digestible CHO g), i.e. 25 g → 1.0 h, 50 g → 1.7 h, 100 g → 2.9 h. Protein-only meals give shorter windows because the insulin rise is smaller.
**Moderators:** adipose insulin resistance (obesity) shifts EC50 right [72]. Keto-adaptation lowers insulin antilipolysis [130]. 5% weight loss maximally improves adipose insulin sensitivity [94].
**Evidence grade: A−** for the dose-response (clamp studies). **C** for meal-level durations.

---

### 4.15 Carbohydrate–insulin model (CIM) vs energy-balance model (EBM): quantitative verdict

**Claims.** CIM: high-glycaemic-load diets raise insulin, which pushes fuel into adipose tissue and so drives hunger and lower expenditure. At equal calories, low-CHO diets should therefore raise EE and fat loss [65][66]. EBM (Hall): at equal calories and protein, the CHO:fat ratio has negligible effects on body fat [58][59][62].

| Study | Design | Result | Source |
|---|---|---|---|
| Hall 2015 Cell Metab | 19 obese, ward, 6 d each, −30% energy via CHO cut (≈140 g/d CHO left) vs fat cut (8% fat); protein equal | Fat loss 53 ± 6 (RC) vs 89 ± 6 g/d (RF) by balance; cumulative 245 vs 463 g; insulin secretion −22.3 ± 7.0% only with RC; model predicted RF ≈3 kg more fat loss over 6 months; very-low-CHO predicted comparable to low-fat | [58] |
| Hall 2016 AJCN | 17 men, 4 wk BD (50% CHO) → 4 wk isocaloric KD (5% CHO), ward | EE_chamber +57 ± 13, SEE +89 ± 14 kcal/d; EE_DLW +151 ± 63; RQ −0.111; body-fat loss *slowed* on KD; protein use and FFM loss increased | [59] |
| Hall 2019 AJCN | DLW methodology re-analysis of the same cohort | DLW excess (209 kcal/d) disappears when RQ is adjusted for energy imbalance (+46 ± 65 kcal/d after removing outliers) | [60] |
| Hall & Guo 2017 | meta-analysis of 32 controlled feeding studies, protein equal | EE +26 kcal/d and fat loss +16 g/d *favouring lower-fat* diets; "for all practical purposes a calorie is a calorie" | [62] |
| Ebbeling 2018 BMJ | 164 adults after 12% weight loss, 20 wk, 20/40/60% CHO, DLW | TEE +52 kcal/d per 10% lower CHO; low vs high CHO +209 (91–326) kcal/d | [67] |
| Ebbeling 2012 JAMA | 21 adults, 4-wk crossovers after weight loss | REE decline −205 (low-fat) vs −138 (VLC) kcal/d; TEE −423 vs −97 | [68] |
| Hall 2021 Nat Med | 20 adults, ad libitum, 2 wk each, plant low-fat (75% CHO, GL 85 g/1000 kcal) vs animal keto (10% CHO) | Low-fat diet led to 689 ± 73 kcal/d *less* intake (544 in week 2) despite higher glucose/insulin | [61] |

**Best quantitative estimate for the engine.** At equal energy and protein intake, isocaloric CHO↔fat substitution changes body-fat balance by **0 ± 20 g/d**. The pooled sign slightly favours lower-fat diets (+16 g/d fat loss; +26 kcal/d EE) [62]. Over 6 months that is ≤ ≈0.5–3 kg, and the model predictions converge when CHO is very low [58]. EE differences from DLW (+150–210 kcal/d) are method-sensitive [60] and remain contested [67].
**Engine decision:** no insulin-driven partitioning term acts on fat mass. Fat mass follows energy balance, with protein/lean partitioning from 01/03. Differences between diets appear through: (i) glycogen + water + sodium transients on the scale (§4.1; dossiers 13/15); (ii) ad libitum intake effects (dossier 12; Hall 2021 [61]); (iii) the small EE effects of dossier 02 (TEF). Show the CIM as a labelled "contested" sensitivity option (+50 kcal/d TEE per −10%E CHO [67], grade C).
**Evidence grade: A** for "insulin does not by itself determine fat balance at fixed energy" (ward studies plus meta-analysis). **C** for any residual EE effect.

---

### 4.16 Glycaemic response: parametric post-prandial glucose curve

**Mechanism.** The post-prandial glucose excursion depends mainly on the **amount** and the **type (GI)** of carbohydrate. These two explain ≈90% of variance in mean responses to mixed meals in lean healthy subjects [76]. Glycaemic load (GI × g/100) predicts responses stepwise across food doses [78]. The response rises less than proportionally with dose: glucose iAUC rose only 68% from 25 → 50 g and 38% from 50 → 100 g, while insulin rose nearly linearly [80]. Protein and fat reduce the glycaemic response linearly over 0–30 g, with protein ≈2–3× as effective as fat per gram [77]. In solid meals, adding 12.5–25 g protein or up to 22 g fat did not significantly change the response to 50 g white-bread carbohydrate, whereas 50 g protein did [81]. Other modifiers: viscous β-glucan (≈4 g per 30–80 g available CHO) [84]; eating carbohydrate last [82]; vinegar [83]; time of day (lower excursions at breakfast than lunch or dinner) [89]. Glucose tolerance also falls after low-carbohydrate intake (§4.19), with sleep loss and with insulin resistance (§4.18). Individual variability to identical meals is large, and gut microbiome and personal factors predict part of it [85].

**Equations — PROPOSED FIT**
```
Glc(t)  = Glc_f + M_tol · M_circ(t_m) · Σ_m ΔG_m(t)                                   [mmol/L]
Glc_f   = 5.0 · S_hep^(−0.1)                                                           (fasting)
ΔG_m(t) = A_m · x · exp(1 − x),   x = (t − t_m)/t_p,m   (gamma shape k = 2; peak A_m at t_p; ≈back to baseline by 4–5 t_p)
A_m     = A_50 · [L_eff·(K_L + 50)] / [50·(K_L + L_eff)] · M_PF · M_fib · M_order · M_vin · S_mus^(−0.5) ;  cap 4.5 mmol/L (healthy)
L_eff   = Σ_i (GI_i/100)·C_i      (glucose-scale glycaemic load of the meal, g; GI from tables [79]; fructose GI 16 ± 4 on the bread scale ≈ 11 on the glucose scale; glucose itself = 149 on the bread scale [80])
M_PF    = 1 − 0.006·min(P,50) − 0.0025·min(F,30)        (P, F grams in the same meal)
M_fib   = 1 − 0.035·min(βglucan_viscous_g, 12)          (non-viscous fibre: 1.0)
M_order = 0.70 if carbohydrate eaten last (≥10 min after vegetables/protein), else 1
M_vin   = 0.80 if ≥10–20 g vinegar (acetic acid ≈1 g) with the meal, else 1
t_p     = 0.50 h (liquid glucose/sugars) ; 0.75 h (high-GI refined solid) ; 1.0 h (mixed meal) ;
          1.25–1.5 h (low-GI, legumes, meals with >30 g fat, >150 g CHO)
iAUC_m  ≈ e · A_m · t_p   (mmol·h/L over the full excursion; ≈75% of it falls within 2 h)
```
| Symbol | Value | Unit | Uncertainty | Source / fit |
|---|---|---|---|---|
| A_50 (peak rise after 50 g glucose, lean healthy) | 2.8 | mmol/L | 2.0–3.5 (UNVERIFIED typical value) | — |
| K_L | 80 | g | 60–110 | fitted to +68% (25→50 g) and +38% (50→100 g) [80] (K = 106 and 61 respectively) |
| protein coefficient | 0.006 /g | — | 0.003–0.01 | linear 0–30 g, protein ≈2–3× fat [77]; n.s. at ≤25 g in solid meals [81] |
| fat coefficient | 0.0025 /g | — | 0.001–0.005 | [77][81] |
| β-glucan | −3.5%/g (4 g ≈ −27 mmol·min/L) | — | UNVERIFIED conversion to % | [84] |
| carbohydrate-last | −30% | — | T2D: peaks −29% (30 min), −37% (60 min), iAUC −73% [82]; healthy magnitude UNVERIFIED | [82] |
| vinegar | −20% | — | glucose AUC SMD −0.60 (95% CI −1.08 to −0.11); insulin SMD −1.30 [83]; % conversion UNVERIFIED | [83] |
| M_circ | 1.0 breakfast; 1.15 lunch/dinner/late | — | UNVERIFIED magnitude; direction from [89]; coordinate with 07 | [89] |

**Checks.** (i) Taylor 1996 [8]: 139 g glucose + 29 g protein + 17 g fat (liquid). Model: A = 2.8·(139·130)/(50·219)·(1 − 0.174 − 0.043) = 3.6 mmol/L vs observed 5.2 → 8.6 (Δ3.4). (ii) Lee & Wolever dose steps are reproduced by construction. (iii) **Known limitation:** very large, slowly eaten starchy meals give lower and longer peaks than predicted. Acheson's 479 g starch meal peaked at only 6.6 mmol/L at 90 min and stayed ≈5.5 mmol/L for 8 h [41]; the cap at 4.5 mmol/L still overpredicts. Treat meals >150 g CHO as t_p = 1.5 h with an extended tail.
**Glucose variability outputs** (compute over the simulated 24-h trace): mean, SD, CV%, time in range 70–140 mg/dL (3.9–7.8 mmol/L), time above 140 mg/dL, time below 70 mg/dL. Healthy non-diabetic CGM reference: mean 98–99 mg/dL (5.4–5.5 mmol/L; 104 mg/dL if >60 y), TIR 70–140 = 96% (IQR 93–98), CV 17 ± 3%, >140 mg/dL 2.1% (≈30 min/d), <70 mg/dL 1.1% (≈15 min/d) [86]. A deterministic model underestimates CV, so add a noise term (SD ≈0.3 mmol/L, UNVERIFIED) or report CV only as relative change. "Glucotypes" show that some normoglycaemic people have high-variability patterns [87].
**Evidence grade: B** for the determinants (GI/GL validation, dose-response, meta-analyses of modifiers). **C** for the exact curve shape and modifier magnitudes in healthy people. Individual prediction is poor (grade D) [85].

---

### 4.17 Insulin response curve

**Mechanism.** Insulin rises almost linearly with carbohydrate dose over 0–100 g [80]. Glucose and insulin scores are correlated (r = 0.70). Protein-rich foods and fat + refined-carbohydrate bakery foods give insulin responses disproportionately higher than their glycaemic responses [88]. Insulin resistance increases the insulin response for a given glucose response (T2D: 752 vs 372 pmol/L at 300 min after mixed meals [28]).

**Equations — PROPOSED FIT**
```
Ins(t)  = Ins_f + M_ins · Σ_m ΔI_m(t)                                                 [µU/mL]
Ins_f   = 7 · S_hep^(−0.9)                     (lean fasting ≈5–8 µU/mL, UNVERIFIED typical; HOMA link §4.18)
ΔI_m(t) = B_m · y · exp(1 − y),   y = (t − t_m)/(t_p,m + 0.25 h)
B_m     = [ B_max · L_I/(L_I + K_I) + b_P·P_m ] · S_mus^(−0.7)
L_I     = Σ_i (0.5 + 0.5·GI_i/100)·C_i        (insulin tracks load more than GI)
M_ins   = 1 − 0.2·(1 − T_C)                    (lower first-phase secretion after low-CHO intake [105])
```
| Symbol | Value | Unit | Uncertainty | Source / fit |
|---|---|---|---|---|
| B_max | 250 | µU/mL | ±40% | fit: 75 g → ≈50 µU/mL (UNVERIFIED typical OGTT peak); 479 g → 154 (observed 139 µU/mL [41]) |
| K_I | 300 | g | 150–500 | near-linear 0–100 g [80] |
| b_P | 0.6 | µU/mL per g protein | 0.3–1.0 (UNVERIFIED) | disproportionate insulin with protein-rich foods [88] |
Emergent: lipolysis-suppression windows (§4.14). OGTT insulin iAUC in trained middle-aged adults ≈2,240–3,729 µU·min/mL across days after exercise [96], which serves as a plausibility band.
**Evidence grade: B−** (dose-response), **C** for the parameters.

---

### 4.18 Insulin sensitivity as a state variable (index + update rule)

**Mechanism.** Insulin sensitivity has a hepatic part (suppression of glucose output; drives fasting glucose/insulin and HOMA-IR) and a peripheral/muscle part (glucose uptake → glycogen; drives post-meal tolerance; Matsuda-type indices). They change on different time-scales:
- **Energy deficit** improves hepatic sensitivity within **48 h to 7 days**. Examples: 48 h at −1000 kcal/d lowered liver fat 30% (LC) vs 9% (HC) and basal glucose production 23% vs 7%, with no change in muscle glucose uptake [92]. A 600 kcal/d diet normalised hepatic insulin suppression of HGO within 1 week (43 → 74%; controls 68%) and fasting glucose (9.2 → 5.9 mmol/L) in T2D [91]. ≈8 kg weight loss cut intrahepatic lipid by 81% and normalised HGO suppression (29 → 99%) without changing peripheral uptake [93].
- **Weight/fat loss** improves muscle sensitivity: +25% at 5% weight loss, ≈2× at 11–16%. Hepatic and adipose improvements plateau after 5% [94].
- **Acute exercise** raises insulin action (lower Km 52 → 40–43 µU/mL, higher Vmax, higher glycogen synthesis). The effect persists at 48 h and is gone by 5 days [95]. OGTT glucose AUC is lowest 1–3 days after training and has risen again by days 5–7 of inactivity [96].
- **Inactivity:** cutting steps from 10,501 to 1,344/d for 2 weeks lowered clamp glucose infusion by 17% (peripheral) [97].
- **Sleep loss:** one night of 4 h sleep lowered GIR ≈25% (hepatic and peripheral) [99]. Seven nights of 5 h lowered clamp sensitivity 11 ± 5.5% and IVGTT sensitivity 20 ± 24% [100] (dossier 16 owns sleep).
- **Saturated fat:** an isoenergetic SFA-rich diet for 3 months lowered insulin sensitivity 10% vs +2% on MUFA, only when total fat was <37%E [101]. +1000 kcal/d from SFA for 3 weeks raised HOMA-IR 23% and liver fat 55% [102].
- **Sugars:** HFCS at 25% of energy requirement for 2 weeks: Matsuda −8.4 ± 4.7%, Predicted-M −5.9 ± 2.5%, with linear dose-response and increased hepatic lipid [111]. 25%E fructose for 10 weeks lowered insulin sensitivity (glucose did not) [109].
- **Time of day:** better tolerance and β-cell responsivity at breakfast than at lunch or dinner [89] (dossier 07).
- **Very-low-carbohydrate intake:** lowers glucose tolerance to a carbohydrate challenge while fasting glucose/insulin fall. This is modelled separately as `T_C` (§4.19).

**Update rule — PROPOSED (daily step, or hourly with the same τ)**
```
dS_hep/dt = (S_hep* − S_hep)/τ_hep ;   dS_mus/dt = (S_mus* − S_mus)/τ_mus
S_hep* = F_LF · F_EBh · F_sleep · F_SFA · F_sugar
S_mus* = F_adip · F_steps · F_fit · F_exAcute · F_sleep · F_SFA
S_I (whole body, Matsuda-like, relative) = S_hep^0.4 · S_mus^0.6
HOMA-IR = Glc_f[mmol/L] · Ins_f[µU/mL] / 22.5   (Matthews 1985 [103]); with §4.16/§4.17 defaults HOMA_ref = 5.0·7/22.5 = 1.56 at S_hep = 1
Matsuda ISI = 10000 / sqrt(G0·I0·Gmean·Imean)   (simulate a 75-g OGTT; mg/dL, µU/mL) (Matsuda & DeFronzo 1999 [104])
```
| Factor | Form | Parameters | Anchors / source | Grade |
|---|---|---|---|---|
| F_LF (liver fat, from 06) | 1/(1 + a·max(0, LF% − 3)) | a = 0.08 | LF 12% → 0.58; normalises as LF → 2–3% [91][93] | C |
| F_EBh (3-day mean energy balance EB₃) | deficit: 1 + 0.25·min(1, −EB₃/1000); surplus: 1 − 0.10·min(1, EB₃/1000) | τ_hep = 2 d | 48 h CR effects [92]; 1-week normalisation [91]; overfeeding HOMA +23% with SFA [102] | C |
| F_adip (fat mass %) | max(0.40, exp(−0.08·max(0, FM% − FM%_ref))) | FM%_ref = 18 (men) / 28 (women) (UNVERIFIED) | −2.6 pts FM ⇒ +23% (obs +25%); −6.2 pts ⇒ +64% (obs ≈+100%) [94] | C |
| F_steps (7-day mean steps) | 1 − 0.17·clamp((8000 − steps)/6700, 0, 1) | τ = 7 d | −17% at ≈1,300 steps/d for 2 wk [97] | B− |
| F_fit (VO2max, from 10) | clamp(1 + 0.01·(VO2max − 40), 0.85, 1.25) | — | UNVERIFIED slope; direction from [98] | D |
| F_exAcute | 1 + 0.25·E_is ; after a session E_is = min(1, EE_session/400 kcal or sets/12); E_is(Δt) = E_is0 for Δt < 24 h, then ·exp(−(Δt − 24)/30 h) | — | persists 48 h, gone by 5 d [95]; OGTT best at days 1–3 [96] | B |
| F_sleep (dossier 16) | 1 − 0.06·min(4, sleep debt last night, h); chronic 5 h/night ⇒ 0.85 | recovery τ = 1 d | −25% after one 4-h night [99]; −11 to −20% after a week [100] | B |
| F_SFA | 1 − 0.012·max(0, SFA%E − 10) | τ = 21 d | −10% SFA vs MUFA diet over 3 months [101] (SFA %E of that diet UNVERIFIED) | C |
| F_sugar (added fructose-containing sugars %E) | 1 − 0.0034·sugar%E | τ = 7 d | 25%E ⇒ −8.5% [111] | C |
Time constants: τ_hep = 2 d and τ_mus = 3 d by default. Factors with their own τ (F_steps 7 d, F_SFA 21 d, F_sugar 7 d, F_sleep 1 d) are first passed through their own first-order lag and then multiplied. F_exAcute and F_adip enter without extra lag.
Glycogen-depletion link (optional alternative to F_exAcute, do not use both): S_mus × (1 + 0.3·max(0, 1 − G_M/G_M,ref)) [33][95] (UNVERIFIED magnitude).
**Moderators:** T2D and obesity have lower baselines (set S at initialisation from FM%, liver fat, fasting glucose/insulin if the user provides them: S_hep,0 = HOMA_ref/HOMA_user).
**Evidence grade: B** for direction and time-scales (clamp/tracer RCTs). **C** for the combined multiplicative index.

---

### 4.19 "Physiological" glucose intolerance after low carbohydrate intake (carbohydrate-tolerance state `T_C`)

**Mechanism.** Days to weeks of low carbohydrate intake raise PDK4, lower GLUT4/AMPK [107] and lower first-phase insulin secretion [105]. The result is a larger glucose excursion to a carbohydrate challenge even though fasting glucose and insulin are lower [107][130]. The effect reverses when carbohydrate is reintroduced, partly within days but fully only over weeks.

**Data points**
| Condition | Result | Source |
|---|---|---|
| 3 d LC/HF (≈69% fat) vs normal (22% fat), isoenergetic, 9 healthy men | higher OGTT glucose and iAUC (P = 0.024); lower first-phase insulin; higher GLP-1 | Numao 2012 [105] |
| 4 wk isocaloric KD (5% CHO) after BD | higher glucose AUC to both test meals; fasting insulin and C-peptide lower; less insulin antilipolysis | Rosenbaum 2019 [130] |
| 12-wk ketogenic diet (free-living) | reduced mean glycaemia/variability in week 1; fasting glucose −0.5 mmol/L (−0.2 to −0.8) at week 4; higher meal-test glucose iAUC and peak at week 4, n.s. at week 12; PDK4 up, GLUT4/AMPK down | Hengist 2024 [107] |
| After a VLC run-in that produced 15% weight loss, 10 wk at 57% CHO (starch or sugar), isoenergetic | CGM fasting, peak and 2-h glucose kept falling from week 2 to week 9; change point ≈5 weeks (95% CI 3.2–7.7); slopes −0.04 to −0.10 mmol/L per week; abnormal OGTT 17 → 9 of 25 | Jansen 2022 [106] |
| Keto-adapted athletes (>6 months) | impaired OGTT glucose tolerance with lower GLUT4/IRS1 (cited in [40]) | Webster 2020 (via [40]) |
| Historical | glucose tolerance abnormal for several weeks after 5 d <50 g/d CHO (Hales & Randle 1963, via [106]) | [106] |

**Equations — PROPOSED FIT**
```
T_C* = clamp( (CI_3d − 50)/100 , 0 , 1 )                   (CI_3d = 3-day mean digestible CHO, g/d)
T_C  = 0.6·T_fast + 0.4·T_slow
dT_fast/dt = (T_C* − T_fast)/τ_f      τ_f = 2.5 d (entry and exit)
dT_slow/dt = (T_C* − T_slow)/τ_s      τ_s = 14 d  (range 10–25; ≈5-week change point [106])
Glucose excursion multiplier M_tol = 1 + 0.6·(1 − T_C)      (applied to ΔG in §4.16; magnitude UNVERIFIED, range 0.3–1.0)
Insulin peak multiplier     M_ins = 1 − 0.2·(1 − T_C)       (§4.17)
Fasting values: NOT worsened by low T_C (fasting glucose −0.3 to −0.5 mmol/L on VLC [107])
```
**Engine/UI rule:** warn that an OGTT or post-meal glucose reading taken within ≈3 days of reintroducing carbohydrate after a period below ≈100 g/d overstates glucose intolerance. Residual bias can last weeks [106]. Hengist found the effect waned by 12 weeks despite continued ketosis [107], so a long-term keto-adaptation offset may be needed (open question).
**Evidence grade: C** (consistent direction across 4 RCT-type studies; magnitude and time constants loosely fitted).

---

### 4.20 Fructose and sucrose specifics

**Mechanism.** Fructose is taken up on first pass by the liver (and some in the intestine) via fructokinase, bypassing the insulin/PFK control step. Within 3–6 h at rest, 45 ± 11% is oxidised, 41 ± 11% becomes glucose, ≈25% becomes lactate, ≥15% goes directly to glycogen, and <1% goes directly to plasma TG [108][16]. Its low GI (16 ± 4, bread = 100) and insulin index (22 ± 3) [80] mean little glycaemic load. Its metabolic effects depend on **dose and energy context**:

| Question | Result | Source |
|---|---|---|
| Isocaloric exchange of fructose for other CHO (7 trials) | no effect on intrahepatocellular lipid or ALT | Chiu 2014 [112] |
| Hypercaloric fructose (+21–35% energy; 104–220 g/d fructose; 6 trials) | IHCL SMD 0.45 (0.18–0.72); ALT +4.94 U/L | Chiu 2014 [112] |
| Uric acid, isocaloric (21 trials total) | MD 0.56 µmol/L (−6.62 to 7.74) — none | Wang 2012 [113] |
| Uric acid, hypercaloric 213–219 g/d fructose | +31.0 µmol/L (15.4–46.5) | Wang 2012 [113] |
| HFCS beverages 0 / 10 / 17.5 / 25% Ereq, 2 wk (young adults) | postprandial TG Δ 0 / +22 / +25 / +37 mg/dL; fasting LDL −1.0 / +7.4 / +8.2 / +15.9 mg/dL; 24-h uric acid −0.13 / +0.15 / +0.30 / +0.59 mg/dL | Stanhope 2015 [110] |
| Same doses, liver fat and insulin sensitivity | linear dose-response for hepatic lipid (p = 0.015); Matsuda −8.4% at 25% | Sigala 2022 [111] |
| 25%E fructose vs glucose, 10 wk (overweight/obese) | both gained similar weight; only fructose increased visceral fat, hepatic DNL, postprandial TG, apoB/LDL, and lowered insulin sensitivity | Stanhope 2009 [109] |
| Sucrose vs glucose at +50% energy (96 h) | same DNL | McDevitt 2001 [47] |
| Very-low-fat (10%) diets: sugar vs starch | fDNL stays high with 75% sugar and falls to 0–1% with solid starch-based food | Hudgins 1998 [46] |
| Post-exercise | sucrose/fructose doubles liver glycogen repletion; muscle unchanged | [15][16][17] |

**Engine rules (PROPOSED; biomarker equations belong to dossier 06):**
- Fructose → liver: §4.8 split (0.15 glycogen, 0.40 glucose, 0.45 oxidised). Fructose raises `m_sugar` in fDNL (§4.13).
- **Thresholds:** flag "fructose excess" when fructose-containing added sugars exceed 10% of energy *and* energy balance >0 (TG/LDL effects appear in 2 weeks at 10%E HFCS [110]). Flag strongly above 25%E or >100 g/d fructose in surplus (liver fat, uric acid) [111][112][113]. No liver-fat or uric-acid penalty for isocaloric exchange within ≈50–100 g/d fructose [112][113].
- Intestinal first-pass clearance of small fructose doses (≈5 g) is based mostly on mouse data (grade D) [16].
**Evidence grade: A−** for isocaloric vs hypercaloric distinction (meta-analyses). **B** for HFCS dose-response.

---

### 4.21 Fibre vs net (digestible) carbohydrate

**Mechanism.** Only digestible carbohydrate drives glycaemia and glycogen. Fibre reaches the colon, where part of it is fermented to short-chain fatty acids (energy ≈2 kcal/g for fermentable fibre — FAO convention, UNVERIFIED against the primary report here). Fibre also lowers the digestibility of fat and protein in mixed diets, so dietary metabolisable energy falls as fibre rises [114]. Cell-wall encapsulation matters too: the measured ME of almonds is 4.6 ± 0.8 kcal/g vs 6.0–6.1 by Atwater factors, a 32% overestimate [115].
**Glycaemia:** viscous β-glucan (≥4 g per 30–80 g available CHO) lowers glucose iAUC by ≈27 mmol·min/L, with a larger effect in intact grains [84]. 4.8–9.6 g of oat-cereal fibre added to white bread had no significant effect [81].
**Engine rules:**
```
net_CHO = total_CHO − fibre − (polyols·(1 − polyol_absorbed_fraction))    (if the label lists fibre inside total CHO; EU labels already exclude fibre)
Energy_fibre = 2 kcal/g · fermentable_fibre + 0 · insoluble (UNVERIFIED split; dossier 15 owns details and faecal-energy loss)
Glycaemic effect: only viscous soluble fibre enters M_fib (§4.16)
```
**Evidence grade: B** (energy: metabolic-balance studies; glycaemia: systematic review). Fermentation and satiety details are in dossier 15.

---

### 4.22 Minimum carbohydrate needs, brain glucose, and the protein cost of gluconeogenesis

**Mechanism.** In the fed/post-absorptive state the brain oxidises 110–145 g glucose/d [116]. Carbohydrate is not dietary-essential: glucose can be made from glycerol (≈10% of triglyceride mass) and from amino acids (≈57 g glucose per 100 g protein) [116]. As ketone bodies rise, they replace glucose as the main brain fuel [116][117]. The RDA of 130 g/d (EAR 100 g/d) is based on brain glucose use [19][119][120].

**Data**
| Quantity | Value | Source |
|---|---|---|
| Brain glucose (short fasts) | 110–145 g/24 h | Owen 1967 [116] |
| Brain fuel after 38–41 d starvation (O2 equivalents) | glucose (net of lactate/pyruvate) ≈28%, β-OHB + AcAc ≈58%, α-amino-N ≈14% (derived from Table: 0.87, 1.77, 0.42 of 3.06 mmol/L) | Owen 1967 [116] |
| Glucose from protein | 57 g per 100 g protein | Owen 1967 [116] |
| Late starvation glucose synthesis | ≈19 g glycerol (from ≈1729 kcal fat/d) + ≈14 g from 3.72 g N/d ⇒ ≈33 g/d; kidney becomes the main site | Owen 1967 [116] |
| Glucose production | 2.19 mg/kg/min overnight (36% GNG) → 1.43 at 60 h (78% GNG) | Hellerstein 1997 [9] |
| GNG fraction of glucose production | 64% (0–22 h), 82%, 96% (to 64 h) | Rothman 1991 [6] |
| RDA / EAR | 130 / 100 g/d (adults) | IOM 2005 [120]; KDRI 2020 [119]; [19] |

**Engine rule — PROPOSED**
```
Glucose_need [g/d] = 120 · (1 − 1.2·K_brain) + 10           (K_brain = ketone share of brain O2 use, 0–0.58, from dossier 05;
                                                             at K_brain = 0.58 brain glucose ≈ 28% of fuel, as in Owen 1967 [116])
Supply order: dietary CHO → glycogen (§4.2, 4.6) → glycerol GNG (0.10 × fat oxidised) → amino-acid GNG (1 g glucose ← 1.75 g protein)
Protein_for_GNG [g/d] = max(0, Glucose_need − CI − glycogen_release − GNG_gly) / 0.57
```
Derived examples: zero CHO before ketone adaptation → need ≈130 g; glycerol supplies ≈15–20 g; ≈110 g from amino acids ⇒ ≈190 g protein/d. That exceeds most intakes, so muscle protein is drawn on (dossier 03/20). After full brain ketone adaptation (K_brain ≈ 0.58): need ≈44 g; minus ≈17 g from glycerol ⇒ ≈27 g from amino acids ⇒ ≈47 g protein/d, easily covered by dietary protein. This matches the ≈33 g/d glucose synthesis (≈23 g protein/d) seen in prolonged starvation [116].
**Evidence grade: B** (classic tracer/catheter physiology; the adaptation curve comes from dossier 05).

---

### 4.23 Carbohydrate and performance, training volume, muscle retention, hormones (brief)

- **Endurance performance:** time to exhaustion at ≈75% VO2max rises with starting muscle glycogen (≈1 h after a fat+protein diet, ≈2 h on a mixed diet, ≈3 h on a high-CHO diet) [21]. Carbohydrate during exercise: 30–60 g/h, up to 90 g/h for events >2.5 h [121]. Daily intake guidelines scale with training load (6–10 g/kg/d for high loads, 8–12 g/kg/d for very high) [19]. Adapting to a low-CHO high-fat diet takes 5–6 days and impairs economy and high-intensity race performance by ≈8% vs HCHO. One day of CHO restoration does not rescue it; de-adaptation occurs within 5 days [40]. Submaximal (62–64% VO2max) endurance was preserved after 4 weeks of ketosis [37]. Engine: performance factor = f(local glycogen, intensity), owned by dossier 19; this dossier supplies glycogen.
- **Resistance training:** in 49 studies, carbohydrate intake did not change strength-training performance in the fed state for workouts of ≤10 sets per muscle group. Higher volumes, fasted or twice-daily sessions may benefit [122]. Engine: penalise volume capacity only if local c_M < 50% of normal *and* planned sets >10 per muscle (PROPOSED, grade C).
- **Muscle retention/gain at equal protein and energy:** KD + RT vs non-KD (13 RCTs, n = 244): body mass −3.67 kg, fat mass −2.21 kg (−3.09 to −1.34), FFM −1.26 kg (−1.82 to −0.70) [123]. A ≈400 g glycogen drop carries ≈1.2–1.6 kg of water, so much of the FFM gap can be glycogen + water, not contractile protein. An isocaloric KD increased protein use and FFM loss over 4 weeks [59]. **Engine:** no independent carbohydrate effect on MPS at equal protein and energy (dossiers 03/09 decide). Report "lean tissue" and "glycogen + water" separately so DXA/BIA-like outputs show the confound. Grade C.
- **Hormones (coordinate with 12):** 800 kcal diets for 2 weeks: 0 g CHO → T3 −47%; ≥50 g CHO/d → no T3 change [125]. High-CHO vs high-protein diet for 10 d at equal energy and fat: testosterone 468 vs 371 ng/dL, cortisol 7.74 vs 10.6 µg/dL [126]. Low-fat vs high-fat diets lower testosterone (SMD −0.38, 95% CI −0.75 to −0.01) [124]. A low-CHO diet raises hepatic cortisol regeneration (11β-HSD1) without changing plasma cortisol [127]. 3-d CHO overfeeding raises leptin 28% and 24-h EE 7%; fat overfeeding does not [128].
**Evidence grade:** performance A−; RT C; muscle C; hormones B−/C.

---

## 5. Interactions with other subsystems

| Direction | Module | What flows | Notes |
|---|---|---|---|
| needs ← | 01 Body-weight models | Energy ledger; convention for booking gluconeogenic glucose (net vs gross CHO oxidation); Hall-model glycogen term to reconcile with §4.11 [63][64] | The Hall-type quadratic form is UNVERIFIED here |
| needs ← | 02 Energy expenditure | TEE, non-exercise EE time course `EE_np(t)`, TEF (CHO TEF ≈6% for a 479 g meal [41]) | — |
| needs ← | 03 Protein/MPS | Protein oxidation and amino-acid GNG supply; protein-sparing rules when CHO is low (§4.22) | — |
| needs ← | 05 Fat oxidation / ketosis | `A_keto`, `K_brain`, lipolysis ceiling `Lip_max`; gets `G_L`, `Ins(t)`, `λ(t)` back | Liver glycogen <~20 g plus low insulin ⇒ ketogenesis ramps |
| needs ← | 06 Lipids / liver fat | Liver fat % (→ S_hep), SFA %E; takes fDNL, fructose load, TG drivers | Fructose biomarker equations live in 06 |
| needs ← | 07 Meal timing / circadian | Meal clock times, fasting windows, circadian multiplier `M_circ` | §4.2 gives the hour-by-hour liver glycogen curve |
| needs ← | 09 Resistance training | Sets per muscle group, session time | §4.5 |
| needs ← | 10 Cardio | Intensity (%VO2max), duration, active muscle mass, VO2max, whole-body CHO use during exercise | §4.3–4.4 give the glycogen share |
| needs ← | 12 Hormones / appetite | Ad libitum intake effects of diet composition [61]; gets CHO-related T3/leptin/testosterone signals (§4.23) | — |
| needs ← | 14 Anthropometrics | SMM per region, FM%, VAT, liver volume | Initial glycogen and S_mus |
| needs ← | 15 Fibre/water/alcohol | Fermentable vs insoluble fibre, faecal energy, sodium/ECF with insulin, alcohol (suppresses GNG) | Insulin lowers renal sodium excretion, adding ECF shifts beyond glycogen water [63] |
| needs ← | 16 Sleep / sex / age | Sleep debt → F_sleep; sex/age modifiers of SMM and glycogen | — |
| gives → | 01 / 11 | Daily CHO oxidation, fat oxidation (residual), net DNL (g fat/d) | Surplus CHO mainly spares fat oxidation [43][50] |
| gives → | 05 / 20 | `G_L(t)`, time to liver glycogen depletion, glucose need, GNG protein demand | — |
| gives → | 13 Transitions | Glycogen + water + K⁺ transients (`W_G`, `K_G`), `T_C` tolerance transients | Scale-weight changes of 1–2 kg in 2–5 days |
| gives → | 08 Autophagy / mTOR | Insulin curve, hours/day with insulin near basal | — |
| gives → | 19 Performance | Local muscle glycogen per group, liver glycogen before exercise | — |
| gives → | UI | Glucose/insulin curves, variability, S_I/HOMA, RQ | — |

---

## 6. Output metrics for the UI

| Metric | Unit | Direction of good | How to compute | Grade |
|---|---|---|---|---|
| Liver glycogen | g and % of G_L,max | context (low = ketosis-prone; high = fuelled) | `G_L` | A− |
| Muscle glycogen (whole-body and per group) | mmol/kg ww; % of personal normal | higher for performance; context for fat-loss goals | `c_M,j`, `G_M` | B |
| Glycogen-bound water (scale-weight component) | kg | neutral (explains scale noise) | `W_G` (+ ECF from 13/15) | B− |
| 24-h RQ | — | context | §4.12 | A |
| Carbohydrate / fat oxidation | g/d | context | §4.10–4.11 | B |
| Net de novo lipogenesis | g fat/d | lower | `DNL_fat` | A− (whether it is 0), C (magnitude) |
| Hepatic fractional DNL | % | lower | §4.13(b) | C |
| Mean glucose, CV%, time 70–140 mg/dL, time >140 | mg/dL, %, % | lower CV; higher TIR; lower TAR | §4.16 trace | C |
| Per-meal glucose peak and iAUC | mmol/L; mmol·min/L | lower | §4.16 | C |
| Daily insulin AUC | µU·h/mL | lower (context) | §4.17 | C |
| Hours per day with lipolysis suppressed (λ > 0.8) | h/d | context (fewer = more fat mobilisation) | §4.14 | C |
| Insulin sensitivity (relative), HOMA-IR, Matsuda-like index | —, —, — | higher S_I; lower HOMA | §4.18 | B/C |
| Carbohydrate tolerance | 0–1 | higher when carbohydrate is eaten | `T_C` §4.19 | C |
| Fructose-excess flag | boolean / %E | off | §4.20 | B |
| Protein needed for gluconeogenesis | g/d | lower than protein intake | §4.22 | B |
| Time until liver glycogen <20 g during a fast | h | context (ketosis onset, dossier 05) | §4.2 | A− |
| Training readiness (local glycogen) | % of normal | ≥80% before hard sessions | `c_M,j` | B |

---

## 7. Validation targets

| # | Study (subjects) | Conditions in | Measured outcomes the engine must reproduce | Tolerance |
|---|---|---|---|---|
| V1 | Acheson 1982 [41] (6 healthy men, 70 ± 2 kg, 21 y) | Single meal of 479 g starch (bread, jam, juice) after overnight fast; 10 h calorimetry | Glucose peak 6.6 mM at 90 min; insulin peak 139 µU/mL, 22 µU/mL at 10 h; NPRQ 0.91–0.98; oxidised in 10 h: 133 g CHO, 17 g fat, 29 g protein; glycogen +408 g at 5 h and +346 ± 12 g at 10 h; TEF 5.9%; **no net DNL** | CHO ox ±20%; glycogen ±20%; NPRQ <1.0 throughout |
| V2 | Acheson 1988 [42] (3 men) | 3 d at 10% CHO (≈1360–2000 kcal) + exercise → 7 d CHO overfeeding, 86% CHO, 3642 → 4930 kcal/d → 2 d at 602 kcal (85% protein) | CHO ox 74 g/d (end of depletion) → 398 g/d on day 1 of overfeeding; glycogen storage 339 g on day 1, falling daily; saturation after ≈4 d (+≈770 g); 24-h NPRQ >1 from day 2, 1.15 in last 3 d; net DNL ≈142–150 g/d at the end (≈580 g total); capacity ≈15 g/kg | Capacity ±20%; DNL onset ±1 d; DNL rate ±30% |
| V3 | Taylor 1996 [8]; Magnusson 1992 [7]; Rothman 1991 [6] (healthy adults) | (a) Overnight fast after dinner; (b) 824-kcal liquid meal with 139 g glucose; (c) 23–68 h fast | (a) 350 → 207 mmol/L overnight; (b) 207 → 316 mmol/L peak at ≈5.3 h, +28 g (≈19% of CHO); FFA nadir at 90 min, suppressed >3 h; HGO suppressed within 30 min and back by ≈4–5 h; (c) 282 → 98 mmol/L from 4 → 22.5 h (10.5 mmol/L/h); GNG 64%, 82%, 96% of glucose production over successive periods | ±20% concentrations; ±1 h timing |
| V4 | Bussau 2002 [22]; Shiose 2016 [3] | (a) 10 g/kg/d high-GI CHO, inactive, trained men, 3 d; (b) 12 g/kg/d for 72 h after glycogen-depleting cycling | (a) 95 → 180 mmol/kg ww after 24 h, no further rise at 72 h; (b) 72.7 → 169.4 mmol/kg ww at 72 h; total body water +0.9 kg (39.3 → 40.2 kg) | ±15% glycogen; water +0.6 to +1.6 kg |
| V5 | Ivy 1988 [26]; Fuchs 2016 [15] | (a) 2 g/kg CHO immediately vs 2 h after 70 min cycling; (b) 1.5 g/kg/h sucrose vs glucose for 5 h after depletion | (a) 7.7 vs 2.5 mmol/kg ww/h in 0–2 h; 4.3 vs 4.1 in 2–4 h; (b) liver 53.6 → 86.8 g (sucrose) vs 49.3 → 65.7 g (glucose); muscle 85 → 140 vs 86 → 136 mmol/L | ±25% rates; the sucrose–glucose liver difference must be positive (≈+3.4 g/h) |
| V6 | Schrauwen 1997 [55][56] (12 lean adults, energy balance in chamber) | Low-fat diet 6 d → high-fat diet 7 d (companion study composition: 30/55/15 → 60/25/15 %E fat/CHO/protein) | Fat balance +1.06, +0.75, +0.55 MJ/d on days 1–3; zero by day 7. With prior glycogen-lowering exercise, fat oxidation matches fat intake immediately | Day-1 imbalance within ±50%; balance reached by day 5–9 |
| V7 | Hall 2015 [58] (19 adults with obesity, metabolic ward) | 5-d baseline, then 6 d at −30% energy (−810 kcal/d) by cutting CHO (RC, ≈140 g/d CHO left) or fat (RF, 8% fat), protein unchanged; crossover | Fat loss 53 ± 6 (RC) vs 89 ± 6 g/d (RF); cumulative 245 vs 463 g; RC: net fat ox +463 ± 63 kcal/d, CHO ox −595 ± 57 kcal/d by day 6, insulin secretion −22 ± 7%; RF: no sustained change in fat ox or RQ; RC larger *weight* loss | Fat-loss difference sign and ≥50% of magnitude; oxidation shifts ±30% |
| V8 | Mikines 1988 [95] / King 1995 [96]; Jansen 2022 [106] | (a) 60 min cycling at 150 W, clamps at 0 and 48 h, extra subjects at 5 d; (b) 5 d training then 7 d inactivity, OGTT days 1–7; (c) VLC run-in then 10 wk at 57% CHO | (a) Higher insulin action at 0 and 48 h, none at 5 d; (b) OGTT glucose AUC 136 (day 1) → 225 (day 7) mM·min; (c) 2-h and fasting glucose keep falling for ≈5 weeks (−0.04 to −0.10 mmol/L/wk), abnormal OGTT 17 → 9 of 25 | (a)/(b) qualitative timing ±1 d; (c) time constant 10–25 d |

---

## 8. Myths and contested claims

1. **"Carbs turn into body fat."** False under normal conditions. Hepatic DNL is ≤5–10 g fat/d even at +50% CHO overfeeding [43][47]. One 479 g starch meal was stored as glycogen with no net fat synthesis [41]. Net DNL becomes large only when CHO intake exceeds TEE and glycogen (≈15 g/kg) is saturated [42][50]. Surplus carbohydrate still causes fat gain, mainly by sparing oxidation of dietary fat [43][50] (grade A−).
2. **"Insulin, not calories, sets body fat; low-carb has a metabolic advantage."** At equal energy and protein, ward studies show equal or *less* fat loss on low-carb [58][59]. A meta-analysis of 32 feeding studies found +16 g/d fat loss and +26 kcal/d EE *favouring lower fat* [62]. DLW-based EE advantages (+150–210 kcal/d) [67] shrink when the RQ used in DLW calculations is corrected for energy imbalance [60]. The CIM proponents' position is documented in [65][66] (contested; engine default = energy balance).
3. **"The first-week drop on low-carb is fat loss."** It is mostly glycogen (≈300–500 g) with ≈3 g water/g plus natriuresis ⇒ 1–2 kg [1][5][63]. In Hall 2015 the low-CHO arm lost more *weight* but less *fat* [58].
4. **"Each gram of glycogen always holds 3–4 g water."** Measured ratios are ≥3 g/g when fluid is limited, 17 g/g with full rehydration (non-glycogen water) [2], and ≈2 g/g from whole-body D2O (derived from [3]). The review calls the relationship inconclusive [4].
5. **"Fasting burns muscle glycogen."** Overnight and short fasts deplete liver glycogen (−20–40% overnight, ≈60% by 24 h). Resting muscle glycogen does not change [12][19].
6. **"Carb loading needs a depletion phase."** One day of ≈10 g/kg/d high-GI carbohydrate while resting reaches maximal stores [22]. A moderate taper protocol gives levels similar to the classic depletion protocol [23].
7. **"Fructose is toxic at any dose."** Isocaloric exchange for other carbohydrate does not raise liver fat or uric acid [112][113]. Harm appears with energy surplus and high doses, and HFCS at ≥10% of energy raises TG and LDL within 2 weeks [110][111]. Both statements are true together.
8. **"Low-GI foods always give low glucose."** Meal load, protein/fat, order, time of day and the individual matter. Responses to identical meals vary widely between people [76][85].
9. **"Any glucose spike above 140 mg/dL in a healthy person is pathological."** Healthy adults spend ≈2% of the day (≈30 min) above 140 mg/dL [86].
10. **"Keto makes you diabetic because your OGTT worsens."** This is an adaptive, reversible drop in carbohydrate tolerance while fasting glucose and insulin are *lower* [106][107][130]. It does distort diagnostic tests [106].
11. **"You must eat carbs to build muscle."** No carbohydrate effect on strength-training performance for ≤10 sets/muscle in the fed state [122]. FFM deficits on KD are partly glycogen water [123].
12. **"The brain needs 130 g/day of dietary carbohydrate."** The RDA reflects the non-ketotic brain glucose use [120]. Gluconeogenesis and ketones cover needs when intake is lower, at a protein cost (§4.22) [116].
13. **"Metabolic flexibility = burning more fat."** Metabolic flexibility is the ability to switch fuels to match supply and demand; insulin resistance impairs switching in both directions [129]. The engine models it through `f_C` dynamics and S_I.

---

## 9. Safety bounds (engine must warn; see dossier 17 for the master list)

- **Hypoglycaemia:** very-low-CHO intake, prolonged fasting or long exercise without CHO in people on insulin or sulfonylureas ⇒ hard warning. One participant withdrew from the low-CHO arm of Hall 2021 because of hypoglycaemia [61]. SGLT2-inhibitor users on very-low-CHO diets carry a risk of euglycaemic ketoacidosis (UNVERIFIED here; dossier 17).
- **Refeeding after prolonged low intake/fasting:** large carbohydrate loads drive intracellular K⁺ (0.45 mmol/g glycogen stored [5]), phosphate and Mg²⁺ shifts. Cap first-day refeeding carbohydrate and warn (dossiers 17/20).
- **Massive carbohydrate overfeeding** (> TEE, several days): hypertriglyceridaemia (plasma TG rose ≈10-fold in [42]) and rapid fat gain once glycogen is saturated. The simulator may run it, but the planner must not prescribe it.
- **Fructose/HFCS:** warn above 10%E in energy surplus; strong warning above 25%E or >100 g/d fructose (liver fat, TG, LDL, uric acid/gout risk) [110][111][112][113].
- **Carbohydrate loading:** expect +1–1.5 kg from water [4]. Not for people with diabetes without supervision. During exercise, >60 g/h of glucose alone causes GI distress; use glucose + fructose [16][121].
- **Very-low-CHO + low protein:** if digestible CHO <50 g/d and protein cannot cover GNG needs (§4.22), warn about lean-tissue loss (thresholds from 03/17).
- **Diagnostics:** tell users not to interpret an OGTT, HbA1c-adjacent readings or CGM "spikes" within the first days to weeks of reintroducing carbohydrate after low-CHO eating [106].
- **Prolonged exercise with low liver glycogen** (fasted, >90 min): risk of hypoglycaemia and impaired performance. Suggest ≥30–60 g/h CHO for long sessions if performance is the goal [121].

---

## 10. Open questions and weakest assumptions

1. **Glycogen–oxidation law.** The quadratic dependence (Hall-type) is used without verifying Hall's exact published equation. It fits Schrauwen 1997, Acheson 1988 and Tarry 2025 reasonably, but a linear or Hill law with keto-adaptation might fit as well. Obese subjects did not match fat oxidation to fat intake over 7 days [54], so the τ may be longer in obesity.
2. **Resting muscle glycogen on long-term very-low-CHO diets** in non-athletes. Phinney's resting values could not be verified. The keto-adapted "restoration" rests on one cross-sectional study [38]. `k_Mr` and the keto terms are grade C/D.
3. **Water per gram of glycogen** (2–4 g/g), its hydration dependence, and separation from ECF/sodium effects of insulin (dossiers 13/15).
4. **Whole-body muscle glycogen** is inferred from vastus lateralis/gastrocnemius values × total SMM. Upper-body muscles and fibre-type differences are ignored.
5. **Liver volume scaling** and liver biopsy norms: Nilsson & Hultman's biopsy data [10][11] were not accessed. The model relies on 13C-MRS studies [7][8][13][15].
6. **Glycaemic model:** the empirical gamma curve with GL saturation is not a validated physiological model. The upgrade path is the Dalla Man meal simulation model [90]. Circadian and personal variability magnitudes are unverified [85][89].
7. **Insulin-sensitivity index:** the multiplicative structure and coefficients are proposed. Interactions such as exercise + energy deficit + sleep are probably sub-additive.
8. **Carbohydrate tolerance `T_C`:** the magnitude (M_tol up to +60%) and its waning after months of keto [107] are uncertain.
9. **CIM vs EBM beyond 6 months** under controlled feeding: no ward data. DLW methodology disputes are unresolved [60][67].
10. **fDNL biomarker function:** sugar vs starch, liquid vs solid [45][46], and fructose-specific effects [109] are poorly quantified. The `m_sugar` range spans 30×.
11. **Protein cost of GNG** uses classic stoichiometry (57 g glucose/100 g protein [116]; Jungas et al. show most amino-acid carbon passes through glucose [118]). The time course of brain ketone adaptation belongs to dossier 05.
12. **Postprandial fat-oxidation suppression** in mixed meals with fat (chylomicron trafficking, adipose buffering [73]) is simplified to insulin control of lipolysis and FFA oxidation.

---

## 11. References

1. Olsson KE, Saltin B. Variation in total body water with muscle glycogen changes in man. *Acta Physiol Scand* 1970;80:11-18. PMID 5475323. doi:10.1111/j.1748-1716.1970.tb04764.x. https://pubmed.ncbi.nlm.nih.gov/5475323/
2. Fernández-Elías VE, Ortega JF, Nelson RK, Mora-Rodriguez R. Relationship between muscle water and glycogen recovery after prolonged exercise in the heat in humans. *Eur J Appl Physiol* 2015;115:1919-26. PMID 25911631. doi:10.1007/s00421-015-3175-z. https://pubmed.ncbi.nlm.nih.gov/25911631/
3. Shiose K, Yamada Y, Motonaga K, et al. Segmental extracellular and intracellular water distribution and muscle glycogen after 72-h carbohydrate loading using spectroscopic techniques. *J Appl Physiol* 2016;121:205-11. PMID 27231310. doi:10.1152/japplphysiol.00126.2016. https://pubmed.ncbi.nlm.nih.gov/27231310/
4. Shiose K, Takahashi H, Yamada Y. Muscle glycogen assessment and relationship with body hydration status: a narrative review. *Nutrients* 2022;15:155. PMID 36615811. doi:10.3390/nu15010155. https://pmc.ncbi.nlm.nih.gov/articles/PMC9823884/
5. Kreitzman SN, Coxon AY, Szaz KF. Glycogen storage: illusions of easy weight loss, excessive weight regain, and distortions in estimates of body composition. *Am J Clin Nutr* 1992;56(1 Suppl):292S-293S. PMID 1615908. doi:10.1093/ajcn/56.1.292S. https://pubmed.ncbi.nlm.nih.gov/1615908/
6. Rothman DL, Magnusson I, Katz LD, Shulman RG, Shulman GI. Quantitation of hepatic glycogenolysis and gluconeogenesis in fasting humans with 13C NMR. *Science* 1991;254:573-6. PMID 1948033. doi:10.1126/science.1948033. https://pubmed.ncbi.nlm.nih.gov/1948033/
7. Magnusson I, Rothman DL, Katz LD, Shulman RG, Shulman GI. Increased rate of gluconeogenesis in type II diabetes mellitus. A 13C nuclear magnetic resonance study. *J Clin Invest* 1992;90:1323-7. PMID 1401068. doi:10.1172/JCI115997. https://pmc.ncbi.nlm.nih.gov/articles/PMC443176/
8. Taylor R, Magnusson I, Rothman DL, et al. Direct assessment of liver glycogen storage by 13C nuclear magnetic resonance spectroscopy and regulation of glucose homeostasis after a mixed meal in normal subjects. *J Clin Invest* 1996;97:126-32. PMID 8550823. doi:10.1172/JCI118379. https://pmc.ncbi.nlm.nih.gov/articles/PMC507070/
9. Hellerstein MK, Neese RA, Linfoot P, et al. Hepatic gluconeogenic fluxes and glycogen turnover during fasting in humans. A stable isotope study. *J Clin Invest* 1997;100:1305-19. PMID 9276749. doi:10.1172/JCI119644. https://pmc.ncbi.nlm.nih.gov/articles/PMC508308/
10. Nilsson LH, Hultman E. Liver glycogen in man — the effect of total starvation or a carbohydrate-poor diet followed by carbohydrate refeeding. *Scand J Clin Lab Invest* 1973;32:325-30. PMID 4771102. doi:10.3109/00365517309084355. (not accessed beyond citation) https://pubmed.ncbi.nlm.nih.gov/4771102/
11. Nilsson LH. Liver glycogen content in man in the postabsorptive state. *Scand J Clin Lab Invest* 1973;32:317-23. PMID 4771101. doi:10.3109/00365517309084354. (not accessed beyond citation) https://pubmed.ncbi.nlm.nih.gov/4771101/
12. Iwayama K, Tanabe Y, Tanji F, Ohnishi T, Takahashi H. Diurnal variations in muscle and liver glycogen differ depending on the timing of exercise. *J Physiol Sci* 2021;71:35. PMID 34802419. doi:10.1186/s12576-021-00821-1. https://pmc.ncbi.nlm.nih.gov/articles/PMC10717652/
13. Gonzalez JT, Fuchs CJ, Smith FE, et al. Ingestion of glucose or sucrose prevents liver but not muscle glycogen depletion during prolonged endurance-type exercise in trained cyclists. *Am J Physiol Endocrinol Metab* 2015;309:E1032-9. PMID 26487008. doi:10.1152/ajpendo.00376.2015. https://pubmed.ncbi.nlm.nih.gov/26487008/
14. Gonzalez JT, Fuchs CJ, Betts JA, van Loon LJ. Liver glycogen metabolism during and after prolonged endurance-type exercise. *Am J Physiol Endocrinol Metab* 2016;311:E543-53. PMID 27436612. doi:10.1152/ajpendo.00232.2016. https://pubmed.ncbi.nlm.nih.gov/27436612/
15. Fuchs CJ, Gonzalez JT, Beelen M, et al. Sucrose ingestion after exhaustive exercise accelerates liver, but not muscle glycogen repletion compared with glucose ingestion in trained athletes. *J Appl Physiol* 2016;120:1328-34. PMID 27013608. doi:10.1152/japplphysiol.01023.2015. https://pubmed.ncbi.nlm.nih.gov/27013608/
16. Fuchs CJ, Gonzalez JT, van Loon LJC. Fructose co-ingestion to increase carbohydrate availability in athletes. *J Physiol* 2019;597:3549-60. PMID 31166604. doi:10.1113/JP277116. https://pmc.ncbi.nlm.nih.gov/articles/PMC6852172/
17. Décombaz J, Jentjens R, Ith M, et al. Fructose and galactose enhance postexercise human liver glycogen synthesis. *Med Sci Sports Exerc* 2011;43:1964-71. PMID 21407126. doi:10.1249/MSS.0b013e318218ca5a. https://pubmed.ncbi.nlm.nih.gov/21407126/
18. Casey A, Mann R, Banister K, et al. Effect of carbohydrate ingestion on glycogen resynthesis in human liver and skeletal muscle, measured by 13C MRS. *Am J Physiol Endocrinol Metab* 2000;278:E65-75. PMID 10644538. doi:10.1152/ajpendo.2000.278.1.E65. https://pubmed.ncbi.nlm.nih.gov/10644538/
19. Murray B, Rosenbloom C. Fundamentals of glycogen metabolism for coaches and athletes. *Nutr Rev* 2018;76:243-59. PMID 29444266. doi:10.1093/nutrit/nuy001. https://pmc.ncbi.nlm.nih.gov/articles/PMC6019055/
20. Areta JL, Hopkins WG. Skeletal muscle glycogen content at rest and during endurance exercise in humans: a meta-analysis. *Sports Med* 2018;48:2091-102. PMID 29923148. doi:10.1007/s40279-018-0941-1. https://pubmed.ncbi.nlm.nih.gov/29923148/
21. Bergström J, Hermansen L, Hultman E, Saltin B. Diet, muscle glycogen and physical performance. *Acta Physiol Scand* 1967;71:140-50. PMID 5584523. doi:10.1111/j.1748-1716.1967.tb03720.x. https://pubmed.ncbi.nlm.nih.gov/5584523/
22. Bussau VA, Fairchild TJ, Rao A, Steele P, Fournier PA. Carbohydrate loading in human muscle: an improved 1 day protocol. *Eur J Appl Physiol* 2002;87:290-5. PMID 12111292. doi:10.1007/s00421-002-0621-5. https://pubmed.ncbi.nlm.nih.gov/12111292/
23. Sherman WM, Costill DL, Fink WJ, Miller JM. Effect of exercise-diet manipulation on muscle glycogen and its subsequent utilization during performance. *Int J Sports Med* 1981;2:114-8. PMID 7333741. doi:10.1055/s-2008-1034594. https://pubmed.ncbi.nlm.nih.gov/7333741/
24. Arnall DA, Nelson AG, Quigley J, et al. Supercompensated glycogen loads persist 5 days in resting trained cyclists. *Eur J Appl Physiol* 2007;99:251-6. PMID 17120016. doi:10.1007/s00421-006-0340-4. https://pubmed.ncbi.nlm.nih.gov/17120016/
25. Jentjens R, Jeukendrup A. Determinants of post-exercise glycogen synthesis during short-term recovery. *Sports Med* 2003;33:117-44. PMID 12617691. doi:10.2165/00007256-200333020-00004. https://pubmed.ncbi.nlm.nih.gov/12617691/
26. Ivy JL, Katz AL, Cutler CL, Sherman WM, Coyle EF. Muscle glycogen synthesis after exercise: effect of time of carbohydrate ingestion. *J Appl Physiol* 1988;64:1480-5. PMID 3132449. doi:10.1152/jappl.1988.64.4.1480. https://pubmed.ncbi.nlm.nih.gov/3132449/
27. Burke LM, van Loon LJC, Hawley JA. Postexercise muscle glycogen resynthesis in humans. *J Appl Physiol* 2017;122:1055-67. PMID 27789774. doi:10.1152/japplphysiol.00860.2016. https://pubmed.ncbi.nlm.nih.gov/27789774/
28. Carey PE, Halliday J, Snaar JE, Morris PG, Taylor R. Direct assessment of muscle glycogen storage after mixed meals in normal and type 2 diabetic subjects. *Am J Physiol Endocrinol Metab* 2003;284:E688-94. PMID 12453829. doi:10.1152/ajpendo.00471.2002. https://pubmed.ncbi.nlm.nih.gov/12453829/
29. Shulman GI, Rothman DL, Jue T, et al. Quantitation of muscle glycogen synthesis in normal subjects and subjects with non-insulin-dependent diabetes by 13C nuclear magnetic resonance spectroscopy. *N Engl J Med* 1990;322:223-8. PMID 2403659. doi:10.1056/NEJM199001253220403. https://pubmed.ncbi.nlm.nih.gov/2403659/
30. Janssen I, Heymsfield SB, Wang ZM, Ross R. Skeletal muscle mass and distribution in 468 men and women aged 18-88 yr. *J Appl Physiol* 2000;89:81-8. PMID 10904038. doi:10.1152/jappl.2000.89.1.81. https://pubmed.ncbi.nlm.nih.gov/10904038/
31. Robergs RA, Pearson DR, Costill DL, et al. Muscle glycogenolysis during differing intensities of weight-resistance exercise. *J Appl Physiol* 1991;70:1700-6. PMID 2055849. doi:10.1152/jappl.1991.70.4.1700. https://pubmed.ncbi.nlm.nih.gov/2055849/
32. MacDougall JD, Ray S, Sale DG, et al. Muscle substrate utilization and lactate production. *Can J Appl Physiol* 1999;24:209-15. PMID 10364416. doi:10.1139/h99-017. https://pubmed.ncbi.nlm.nih.gov/10364416/
33. Koopman R, Manders RJ, Jonkers RA, et al. Intramyocellular lipid and glycogen content are reduced following resistance exercise in untrained healthy males. *Eur J Appl Physiol* 2006;96:525-34. PMID 16369816. doi:10.1007/s00421-005-0118-0. https://pubmed.ncbi.nlm.nih.gov/16369816/
34. Tesch PA, Colliander EB, Kaiser P. Muscle metabolism during intense, heavy-resistance exercise. *Eur J Appl Physiol Occup Physiol* 1986;55:362-6. PMID 3758035. doi:10.1007/BF00422734. https://pubmed.ncbi.nlm.nih.gov/3758035/
35. Romijn JA, Coyle EF, Sidossis LS, et al. Regulation of endogenous fat and carbohydrate metabolism in relation to exercise intensity and duration. *Am J Physiol* 1993;265:E380-91. PMID 8214047. doi:10.1152/ajpendo.1993.265.3.E380. https://pubmed.ncbi.nlm.nih.gov/8214047/
36. van Loon LJ, Greenhaff PL, Constantin-Teodosiu D, Saris WH, Wagenmakers AJ. The effects of increasing exercise intensity on muscle fuel utilisation in humans. *J Physiol* 2001;536:295-304. PMID 11579177. doi:10.1111/j.1469-7793.2001.00295.x. https://pubmed.ncbi.nlm.nih.gov/11579177/
37. Phinney SD, Bistrian BR, Evans WJ, Gervino E, Blackburn GL. The human metabolic response to chronic ketosis without caloric restriction: preservation of submaximal exercise capability with reduced carbohydrate oxidation. *Metabolism* 1983;32:769-76. PMID 6865776. doi:10.1016/0026-0495(83)90106-3. https://pubmed.ncbi.nlm.nih.gov/6865776/
38. Volek JS, Freidenreich DJ, Saenz C, et al. Metabolic characteristics of keto-adapted ultra-endurance runners. *Metabolism* 2016;65:100-10. PMID 26892521. doi:10.1016/j.metabol.2015.10.028. https://pubmed.ncbi.nlm.nih.gov/26892521/
39. Tarry EK, Vestergaard SG, Petersen EA, et al. Divergent changes in peak fat oxidation and Fatmax following 3-day dietary interventions are related to muscle glycogen availability in men. *Scand J Med Sci Sports* 2025;35:e70132. PMID 40922559. doi:10.1111/sms.70132. https://pmc.ncbi.nlm.nih.gov/articles/PMC12417932/
40. Burke LM, Whitfield J, Heikura IA, et al. Adaptation to a low carbohydrate high fat diet is rapid but impairs endurance exercise metabolism and performance despite enhanced glycogen availability. *J Physiol* 2021;599:771-90. PMID 32697366. doi:10.1113/JP280221. https://pmc.ncbi.nlm.nih.gov/articles/PMC7891450/
41. Acheson KJ, Flatt JP, Jéquier E. Glycogen synthesis versus lipogenesis after a 500 gram carbohydrate meal in man. *Metabolism* 1982;31:1234-40. PMID 6755166. doi:10.1016/0026-0495(82)90010-5. https://pubmed.ncbi.nlm.nih.gov/6755166/
42. Acheson KJ, Schutz Y, Bessard T, et al. Glycogen storage capacity and de novo lipogenesis during massive carbohydrate overfeeding in man. *Am J Clin Nutr* 1988;48:240-7. PMID 3165600. doi:10.1093/ajcn/48.2.240. https://pubmed.ncbi.nlm.nih.gov/3165600/
43. Schwarz JM, Neese RA, Turner S, Dare D, Hellerstein MK. Short-term alterations in carbohydrate energy intake in humans. Striking effects on hepatic glucose production, de novo lipogenesis, lipolysis, and whole-body fuel selection. *J Clin Invest* 1995;96:2735-43. PMID 8675642. doi:10.1172/JCI118342. https://pmc.ncbi.nlm.nih.gov/articles/PMC185982/
44. Schwarz JM, Linfoot P, Dare D, Aghajanian K. Hepatic de novo lipogenesis in normoinsulinemic and hyperinsulinemic subjects consuming high-fat, low-carbohydrate and low-fat, high-carbohydrate isoenergetic diets. *Am J Clin Nutr* 2003;77:43-50. PMID 12499321. doi:10.1093/ajcn/77.1.43. https://pubmed.ncbi.nlm.nih.gov/12499321/
45. Hudgins LC, Hellerstein M, Seidman C, et al. Human fatty acid synthesis is stimulated by a eucaloric low fat, high carbohydrate diet. *J Clin Invest* 1996;97:2081-91. PMID 8621798. doi:10.1172/JCI118645. https://pmc.ncbi.nlm.nih.gov/articles/PMC507283/
46. Hudgins LC, Seidman CE, Diakun J, Hirsch J. Human fatty acid synthesis is reduced after the substitution of dietary starch for sugar. *Am J Clin Nutr* 1998;67:631-9. PMID 9537610. doi:10.1093/ajcn/67.4.631. https://pubmed.ncbi.nlm.nih.gov/9537610/
47. McDevitt RM, Bott SJ, Harding M, et al. De novo lipogenesis during controlled overfeeding with sucrose or glucose in lean and obese women. *Am J Clin Nutr* 2001;74:737-46. PMID 11722954. doi:10.1093/ajcn/74.6.737. https://pubmed.ncbi.nlm.nih.gov/11722954/
48. Minehira K, Vega N, Vidal H, Acheson K, Tappy L. Effect of carbohydrate overfeeding on whole body macronutrient metabolism and expression of lipogenic enzymes in adipose tissue of lean and overweight humans. *Int J Obes Relat Metab Disord* 2004;28:1291-8. PMID 15303106. doi:10.1038/sj.ijo.0802760. https://pubmed.ncbi.nlm.nih.gov/15303106/
49. Aarsland A, Chinkes D, Wolfe RR. Hepatic and whole-body fat synthesis in humans during carbohydrate overfeeding. *Am J Clin Nutr* 1997;65:1774-82. PMID 9174472. doi:10.1093/ajcn/65.6.1774. https://pubmed.ncbi.nlm.nih.gov/9174472/
50. Hellerstein MK. De novo lipogenesis in humans: metabolic and regulatory aspects. *Eur J Clin Nutr* 1999;53 Suppl 1:S53-65. PMID 10365981. doi:10.1038/sj.ejcn.1600744. https://pubmed.ncbi.nlm.nih.gov/10365981/
51. Flatt JP. Use and storage of carbohydrate and fat. *Am J Clin Nutr* 1995;61:952S-959S. PMID 7900694. doi:10.1093/ajcn/61.4.952S. https://pubmed.ncbi.nlm.nih.gov/7900694/
52. Flatt JP. Importance of nutrient balance in body weight regulation. *Diabetes Metab Rev* 1988;4:571-81. PMID 3065010. doi:10.1002/dmr.5610040603. https://pubmed.ncbi.nlm.nih.gov/3065010/
53. Hill JO, Peters JC, Reed GW, et al. Nutrient balance in humans: effects of diet composition. *Am J Clin Nutr* 1991;54:10-17. PMID 2058571. doi:10.1093/ajcn/54.1.10. https://pubmed.ncbi.nlm.nih.gov/2058571/
54. Thomas CD, Peters JC, Reed GW, et al. Nutrient balance and energy expenditure during ad libitum feeding of high-fat and high-carbohydrate diets in humans. *Am J Clin Nutr* 1992;55:934-42. PMID 1570800. doi:10.1093/ajcn/55.5.934. https://pubmed.ncbi.nlm.nih.gov/1570800/
55. Schrauwen P, van Marken Lichtenbelt WD, Saris WH, Westerterp KR. Changes in fat oxidation in response to a high-fat diet. *Am J Clin Nutr* 1997;66:276-82. PMID 9250105. doi:10.1093/ajcn/66.2.276. https://pubmed.ncbi.nlm.nih.gov/9250105/
56. Schrauwen P, van Marken Lichtenbelt WD, Saris WH, Westerterp KR. Role of glycogen-lowering exercise in the change of fat oxidation in response to a high-fat diet. *Am J Physiol* 1997;273:E623-9. PMID 9316454. doi:10.1152/ajpendo.1997.273.3.E623. https://pubmed.ncbi.nlm.nih.gov/9316454/
57. Smith SR, de Jonge L, Zachwieja JJ, et al. Concurrent physical activity increases fat oxidation during the shift to a high-fat diet. *Am J Clin Nutr* 2000;72:131-8. PMID 10871571. doi:10.1093/ajcn/72.1.131. https://pubmed.ncbi.nlm.nih.gov/10871571/
58. Hall KD, Bemis T, Brychta R, et al. Calorie for calorie, dietary fat restriction results in more body fat loss than carbohydrate restriction in people with obesity. *Cell Metab* 2015;22:427-36. PMID 26278052. doi:10.1016/j.cmet.2015.07.021. https://pmc.ncbi.nlm.nih.gov/articles/PMC4603544/
59. Hall KD, Chen KY, Guo J, et al. Energy expenditure and body composition changes after an isocaloric ketogenic diet in overweight and obese men. *Am J Clin Nutr* 2016;104:324-33. PMID 27385608. doi:10.3945/ajcn.116.133561. https://pmc.ncbi.nlm.nih.gov/articles/PMC4962163/
60. Hall KD, Guo J, Chen KY, et al. Methodologic considerations for measuring energy expenditure differences between diets varying in carbohydrate using the doubly labeled water method. *Am J Clin Nutr* 2019;109:1328-34. PMID 31028699. doi:10.1093/ajcn/nqy390. https://pmc.ncbi.nlm.nih.gov/articles/PMC6499509/
61. Hall KD, Guo J, Courville AB, et al. Effect of a plant-based, low-fat diet versus an animal-based, ketogenic diet on ad libitum energy intake. *Nat Med* 2021;27:344-53. PMID 33479499. doi:10.1038/s41591-020-01209-1. https://pubmed.ncbi.nlm.nih.gov/33479499/
62. Hall KD, Guo J. Obesity energetics: body weight regulation and the effects of diet composition. *Gastroenterology* 2017;152:1718-27.e3. PMID 28193517. doi:10.1053/j.gastro.2017.01.052. https://pmc.ncbi.nlm.nih.gov/articles/PMC5568065/
63. Hall KD, Sacks G, Chandramohan D, et al. Quantification of the effect of energy imbalance on bodyweight. *Lancet* 2011;378:826-37. PMID 21872751. doi:10.1016/S0140-6736(11)60812-X. https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/
64. Hall KD. Predicting metabolic adaptation, body weight change, and energy intake in humans. *Am J Physiol Endocrinol Metab* 2010;298:E449-66. PMID 19934407. doi:10.1152/ajpendo.00559.2009. https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/
65. Ludwig DS, Aronne LJ, Astrup A, et al. The carbohydrate-insulin model: a physiological perspective on the obesity pandemic. *Am J Clin Nutr* 2021;114:1873-85. PMID 34515299. doi:10.1093/ajcn/nqab270. https://pmc.ncbi.nlm.nih.gov/articles/PMC8634575/
66. Ludwig DS, Apovian CM, Aronne LJ, et al. Competing paradigms of obesity pathogenesis: energy balance versus carbohydrate-insulin models. *Eur J Clin Nutr* 2022;76:1209-21. PMID 35896818. doi:10.1038/s41430-022-01179-2. https://pmc.ncbi.nlm.nih.gov/articles/PMC9436778/
67. Ebbeling CB, Feldman HA, Klein GL, et al. Effects of a low carbohydrate diet on energy expenditure during weight loss maintenance: randomized trial. *BMJ* 2018;363:k4583. PMID 30429127. doi:10.1136/bmj.k4583. https://pmc.ncbi.nlm.nih.gov/articles/PMC6233655/
68. Ebbeling CB, Swain JF, Feldman HA, et al. Effects of dietary composition on energy expenditure during weight-loss maintenance. *JAMA* 2012;307:2627-34. PMID 22735432. doi:10.1001/jama.2012.6607. https://pmc.ncbi.nlm.nih.gov/articles/PMC3564212/
69. Jensen MD, Caruso M, Heiling V, Miles JM. Insulin regulation of lipolysis in nondiabetic and IDDM subjects. *Diabetes* 1989;38:1595-601. PMID 2573554. doi:10.2337/diab.38.12.1595. https://pubmed.ncbi.nlm.nih.gov/2573554/
70. Campbell PJ, Carlson MG, Hill JO, Nurjhan N. Regulation of free fatty acid metabolism by insulin in humans: role of lipolysis and reesterification. *Am J Physiol* 1992;263:E1063-9. PMID 1476178. https://pubmed.ncbi.nlm.nih.gov/1476178/
71. Stumvoll M, Jacob S, Wahl HG, et al. Suppression of systemic, intramuscular, and subcutaneous adipose tissue lipolysis by insulin in humans. *J Clin Endocrinol Metab* 2000;85:3740-5. PMID 11061533. doi:10.1210/jcem.85.10.6898. https://pubmed.ncbi.nlm.nih.gov/11061533/
72. Jensen MD, Nielsen S. Insulin dose response analysis of free fatty acid kinetics. *Metabolism* 2007;56:68-76. PMID 17161228. doi:10.1016/j.metabol.2006.08.022. https://pubmed.ncbi.nlm.nih.gov/17161228/
73. Frayn KN. Adipose tissue as a buffer for daily lipid flux. *Diabetologia* 2002;45:1201-10. PMID 12242452. doi:10.1007/s00125-002-0873-y. https://pubmed.ncbi.nlm.nih.gov/12242452/
74. Frayn KN. Calculation of substrate oxidation rates in vivo from gaseous exchange. *J Appl Physiol* 1983;55:628-34. PMID 6618956. doi:10.1152/jappl.1983.55.2.628. https://pubmed.ncbi.nlm.nih.gov/6618956/
75. Livesey G, Elia M. Estimation of energy expenditure, net carbohydrate utilization, and net fat oxidation and synthesis by indirect calorimetry: evaluation of errors with special reference to the detailed composition of fuels. *Am J Clin Nutr* 1988;47:608-28. PMID 3281434. doi:10.1093/ajcn/47.4.608. https://pubmed.ncbi.nlm.nih.gov/3281434/
76. Wolever TM, Bolognesi C. Prediction of glucose and insulin responses of normal subjects after consuming mixed meals varying in energy, protein, fat, carbohydrate and glycemic index. *J Nutr* 1996;126:2807-12. PMID 8914952. doi:10.1093/jn/126.11.2807. https://pubmed.ncbi.nlm.nih.gov/8914952/
77. Moghaddam E, Vogt JA, Wolever TM. The effects of fat and protein on glycemic responses in nondiabetic humans vary with waist circumference, fasting plasma insulin, and dietary fiber intake. *J Nutr* 2006;136:2506-11. PMID 16988118. doi:10.1093/jn/136.10.2506. https://pubmed.ncbi.nlm.nih.gov/16988118/
78. Brand-Miller JC, Thomas M, Swan V, et al. Physiological validation of the concept of glycemic load in lean young adults. *J Nutr* 2003;133:2728-32. PMID 12949357. doi:10.1093/jn/133.9.2728. https://pubmed.ncbi.nlm.nih.gov/12949357/
79. Atkinson FS, Brand-Miller JC, Foster-Powell K, Buyken AE, Goletzke J. International tables of glycemic index and glycemic load values 2021: a systematic review. *Am J Clin Nutr* 2021;114:1625-32. PMID 34258626. doi:10.1093/ajcn/nqab233. https://pubmed.ncbi.nlm.nih.gov/34258626/
80. Lee BM, Wolever TM. Effect of glucose, sucrose and fructose on plasma glucose and insulin responses in normal humans: comparison with white bread. *Eur J Clin Nutr* 1998;52:924-8. PMID 9881888. doi:10.1038/sj.ejcn.1600666. https://pubmed.ncbi.nlm.nih.gov/9881888/
81. Meng H, Matthan NR, Ausman LM, Lichtenstein AH. Effect of macronutrients and fiber on postprandial glycemic responses and meal glycemic index and glycemic load value determinations. *Am J Clin Nutr* 2017;105:842-53. PMID 28202475. doi:10.3945/ajcn.116.144162. https://pmc.ncbi.nlm.nih.gov/articles/PMC5366046/
82. Shukla AP, Iliescu RG, Thomas CE, Aronne LJ. Food order has a significant impact on postprandial glucose and insulin levels. *Diabetes Care* 2015;38:e98-9. PMID 26106234. doi:10.2337/dc15-0429. https://pmc.ncbi.nlm.nih.gov/articles/PMC4876745/
83. Shishehbor F, Mansoori A, Shirani F. Vinegar consumption can attenuate postprandial glucose and insulin responses; a systematic review and meta-analysis of clinical trials. *Diabetes Res Clin Pract* 2017;127:1-9. PMID 28292654. doi:10.1016/j.diabres.2017.01.021. https://pubmed.ncbi.nlm.nih.gov/28292654/
84. Tosh SM. Review of human studies investigating the post-prandial blood-glucose lowering ability of oat and barley food products. *Eur J Clin Nutr* 2013;67:310-7. PMID 23422921. doi:10.1038/ejcn.2013.25. https://pubmed.ncbi.nlm.nih.gov/23422921/
85. Zeevi D, Korem T, Zmora N, et al. Personalized nutrition by prediction of glycemic responses. *Cell* 2015;163:1079-94. PMID 26590418. doi:10.1016/j.cell.2015.11.001. https://pubmed.ncbi.nlm.nih.gov/26590418/
86. Shah VN, DuBose SN, Li Z, et al. Continuous glucose monitoring profiles in healthy nondiabetic participants: a multicenter prospective study. *J Clin Endocrinol Metab* 2019;104:4356-64. PMID 31127824. doi:10.1210/jc.2018-02763. https://pmc.ncbi.nlm.nih.gov/articles/PMC7296129/
87. Hall H, Perelman D, Breschi A, et al. Glucotypes reveal new patterns of glucose dysregulation. *PLoS Biol* 2018;16:e2005143. PMID 30040822. doi:10.1371/journal.pbio.2005143. https://pmc.ncbi.nlm.nih.gov/articles/PMC6057684/
88. Holt SH, Miller JC, Petocz P. An insulin index of foods: the insulin demand generated by 1000-kJ portions of common foods. *Am J Clin Nutr* 1997;66:1264-76. PMID 9356547. doi:10.1093/ajcn/66.5.1264. https://pubmed.ncbi.nlm.nih.gov/9356547/
89. Saad A, Dalla Man C, Nandy DK, et al. Diurnal pattern to insulin secretion and insulin action in healthy individuals. *Diabetes* 2012;61:2691-700. PMID 22751690. doi:10.2337/db11-1478. https://pmc.ncbi.nlm.nih.gov/articles/PMC3478548/
90. Dalla Man C, Rizza RA, Cobelli C. Meal simulation model of the glucose-insulin system. *IEEE Trans Biomed Eng* 2007;54:1740-9. PMID 17926672. doi:10.1109/TBME.2007.893506. https://pubmed.ncbi.nlm.nih.gov/17926672/
91. Lim EL, Hollingsworth KG, Aribisala BS, et al. Reversal of type 2 diabetes: normalisation of beta cell function in association with decreased pancreas and liver triacylglycerol. *Diabetologia* 2011;54:2506-14. PMID 21656330. doi:10.1007/s00125-011-2204-7. https://pmc.ncbi.nlm.nih.gov/articles/PMC3168743/
92. Kirk E, Reeds DN, Finck BN, et al. Dietary fat and carbohydrates differentially alter insulin sensitivity during caloric restriction. *Gastroenterology* 2009;136:1552-60. PMID 19208352. doi:10.1053/j.gastro.2009.01.048. https://pmc.ncbi.nlm.nih.gov/articles/PMC2677125/
93. Petersen KF, Dufour S, Befroy D, et al. Reversal of nonalcoholic hepatic steatosis, hepatic insulin resistance, and hyperglycemia by moderate weight reduction in patients with type 2 diabetes. *Diabetes* 2005;54:603-8. PMID 15734833. doi:10.2337/diabetes.54.3.603. https://pmc.ncbi.nlm.nih.gov/articles/PMC2995496/
94. Magkos F, Fraterrigo G, Yoshino J, et al. Effects of moderate and subsequent progressive weight loss on metabolic function and adipose tissue biology in humans with obesity. *Cell Metab* 2016;23:591-601. PMID 26916363. doi:10.1016/j.cmet.2016.02.005. https://pmc.ncbi.nlm.nih.gov/articles/PMC4833627/
95. Mikines KJ, Sonne B, Farrell PA, Tronier B, Galbo H. Effect of physical exercise on sensitivity and responsiveness to insulin in humans. *Am J Physiol* 1988;254:E248-59. PMID 3126668. doi:10.1152/ajpendo.1988.254.3.E248. https://pubmed.ncbi.nlm.nih.gov/3126668/
96. King DS, Baldus PJ, Sharp RL, et al. Time course for exercise-induced alterations in insulin action and glucose tolerance in middle-aged people. *J Appl Physiol* 1995;78:17-22. PMID 7713807. doi:10.1152/jappl.1995.78.1.17. https://pubmed.ncbi.nlm.nih.gov/7713807/
97. Krogh-Madsen R, Thyfault JP, Broholm C, et al. A 2-wk reduction of ambulatory activity attenuates peripheral insulin sensitivity. *J Appl Physiol* 2010;108:1034-40. PMID 20044474. doi:10.1152/japplphysiol.00977.2009. https://pubmed.ncbi.nlm.nih.gov/20044474/
98. Bird SR, Hawley JA. Update on the effects of physical activity on insulin sensitivity in humans. *BMJ Open Sport Exerc Med* 2016;2:e000143. PMID 28879026. doi:10.1136/bmjsem-2016-000143. https://pmc.ncbi.nlm.nih.gov/articles/PMC5569266/
99. Donga E, van Dijk M, van Dijk JG, et al. A single night of partial sleep deprivation induces insulin resistance in multiple metabolic pathways in healthy subjects. *J Clin Endocrinol Metab* 2010;95:2963-8. PMID 20371664. doi:10.1210/jc.2009-2430. https://pubmed.ncbi.nlm.nih.gov/20371664/
100. Buxton OM, Pavlova M, Reid EW, et al. Sleep restriction for 1 week reduces insulin sensitivity in healthy men. *Diabetes* 2010;59:2126-33. PMID 20585000. doi:10.2337/db09-0699. https://pmc.ncbi.nlm.nih.gov/articles/PMC2927933/
101. Vessby B, Uusitupa M, Hermansen K, et al. Substituting dietary saturated for monounsaturated fat impairs insulin sensitivity in healthy men and women: the KANWU Study. *Diabetologia* 2001;44:312-9. PMID 11317662. doi:10.1007/s001250051620. https://pubmed.ncbi.nlm.nih.gov/11317662/
102. Luukkonen PK, Sädevirta S, Zhou Y, et al. Saturated fat is more metabolically harmful for the human liver than unsaturated fat or simple sugars. *Diabetes Care* 2018;41:1732-9. PMID 29844096. doi:10.2337/dc18-0071. https://pmc.ncbi.nlm.nih.gov/articles/PMC7082640/
103. Matthews DR, Hosker JP, Rudenski AS, et al. Homeostasis model assessment: insulin resistance and beta-cell function from fasting plasma glucose and insulin concentrations in man. *Diabetologia* 1985;28:412-9. PMID 3899825. doi:10.1007/BF00280883. https://pubmed.ncbi.nlm.nih.gov/3899825/
104. Matsuda M, DeFronzo RA. Insulin sensitivity indices obtained from oral glucose tolerance testing: comparison with the euglycemic insulin clamp. *Diabetes Care* 1999;22:1462-70. PMID 10480510. doi:10.2337/diacare.22.9.1462. https://pubmed.ncbi.nlm.nih.gov/10480510/
105. Numao S, Kawano H, Endo N, et al. Short-term low carbohydrate/high-fat diet intake increases postprandial plasma glucose and glucagon-like peptide-1 levels during an oral glucose tolerance test in healthy men. *Eur J Clin Nutr* 2012;66:926-31. PMID 22669333. doi:10.1038/ejcn.2012.58. https://pubmed.ncbi.nlm.nih.gov/22669333/
106. Jansen LT, Yang N, Wong JMW, et al. Prolonged glycemic adaptation following transition from a low- to high-carbohydrate diet: a randomized controlled feeding trial. *Diabetes Care* 2022;45:576-84. PMID 35108378. doi:10.2337/dc21-1970. https://pmc.ncbi.nlm.nih.gov/articles/PMC8918196/
107. Hengist A, Davies RG, Walhin JP, et al. Ketogenic diet but not free-sugar restriction alters glucose tolerance, lipid metabolism, peripheral tissue phenotype, and gut microbiome: RCT. *Cell Rep Med* 2024;5:101667. PMID 39106867. doi:10.1016/j.xcrm.2024.101667. https://pmc.ncbi.nlm.nih.gov/articles/PMC11384946/
108. Sun SZ, Empie MW. Fructose metabolism in humans — what isotopic tracer studies tell us. *Nutr Metab (Lond)* 2012;9:89. PMID 23031075. doi:10.1186/1743-7075-9-89. https://pmc.ncbi.nlm.nih.gov/articles/PMC3533803/
109. Stanhope KL, Schwarz JM, Keim NL, et al. Consuming fructose-sweetened, not glucose-sweetened, beverages increases visceral adiposity and lipids and decreases insulin sensitivity in overweight/obese humans. *J Clin Invest* 2009;119:1322-34. PMID 19381015. doi:10.1172/JCI37385. https://pmc.ncbi.nlm.nih.gov/articles/PMC2673878/
110. Stanhope KL, Medici V, Bremer AA, et al. A dose-response study of consuming high-fructose corn syrup-sweetened beverages on lipid/lipoprotein risk factors for cardiovascular disease in young adults. *Am J Clin Nutr* 2015;101:1144-54. PMID 25904601. doi:10.3945/ajcn.114.100461. https://pmc.ncbi.nlm.nih.gov/articles/PMC4441807/
111. Sigala DM, Hieronimus B, Medici V, et al. The dose-response effects of consuming high fructose corn syrup-sweetened beverages on hepatic lipid content and insulin sensitivity in young adults. *Nutrients* 2022;14:1648. PMID 35458210. doi:10.3390/nu14081648. https://pmc.ncbi.nlm.nih.gov/articles/PMC9030734/
112. Chiu S, Sievenpiper JL, de Souza RJ, et al. Effect of fructose on markers of non-alcoholic fatty liver disease (NAFLD): a systematic review and meta-analysis of controlled feeding trials. *Eur J Clin Nutr* 2014;68:416-23. PMID 24569542. doi:10.1038/ejcn.2014.8. https://pmc.ncbi.nlm.nih.gov/articles/PMC3975811/
113. Wang DD, Sievenpiper JL, de Souza RJ, et al. The effects of fructose intake on serum uric acid vary among controlled dietary trials. *J Nutr* 2012;142:916-23. PMID 22457397. doi:10.3945/jn.111.151951. https://pmc.ncbi.nlm.nih.gov/articles/PMC3327749/
114. Baer DJ, Rumpler WV, Miles CW, Fahey GC. Dietary fiber decreases the metabolizable energy content and nutrient digestibility of mixed diets fed to humans. *J Nutr* 1997;127:579-86. PMID 9109608. doi:10.1093/jn/127.4.579. https://pubmed.ncbi.nlm.nih.gov/9109608/
115. Novotny JA, Gebauer SK, Baer DJ. Discrepancy between the Atwater factor predicted and empirically measured energy values of almonds in human diets. *Am J Clin Nutr* 2012;96:296-301. PMID 22760558. doi:10.3945/ajcn.112.035782. https://pmc.ncbi.nlm.nih.gov/articles/PMC3396444/
116. Owen OE, Morgan AP, Kemp HG, et al. Brain metabolism during fasting. *J Clin Invest* 1967;46:1589-95. PMID 6061736. doi:10.1172/JCI105650. https://pmc.ncbi.nlm.nih.gov/articles/PMC292907/
117. Cahill GF Jr. Fuel metabolism in starvation. *Annu Rev Nutr* 2006;26:1-22. PMID 16848698. doi:10.1146/annurev.nutr.26.061505.111258. https://pubmed.ncbi.nlm.nih.gov/16848698/
118. Jungas RL, Halperin ML, Brosnan JT. Quantitative analysis of amino acid oxidation and related gluconeogenesis in humans. *Physiol Rev* 1992;72:419-48. PMID 1557428. doi:10.1152/physrev.1992.72.2.419. https://pubmed.ncbi.nlm.nih.gov/1557428/
119. Ha K, Song Y. Low-carbohydrate diets in Korea: why does it matter, and what is next? *J Obes Metab Syndr* 2021;30:222-32. PMID 34504048. doi:10.7570/jomes21051. (states EAR 100 g/d, RNI 130 g/d from brain glucose use) https://pmc.ncbi.nlm.nih.gov/articles/PMC8526287/
120. Institute of Medicine. *Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids.* Washington DC: National Academies Press; 2005. Chapter 6. https://nap.nationalacademies.org/catalog/10490 (EAR 100 g/d and RDA 130 g/d quoted via [19][119]; primary text not accessed)
121. Burke LM, Hawley JA, Wong SH, Jeukendrup AE. Carbohydrates for training and competition. *J Sports Sci* 2011;29 Suppl 1:S17-27. PMID 21660838. doi:10.1080/02640414.2011.585473. https://pubmed.ncbi.nlm.nih.gov/21660838/
122. Henselmans M, Bjørnsen T, Hedderman R, Vårvik FT. The effect of carbohydrate intake on strength and resistance training performance: a systematic review. *Nutrients* 2022;14:856. PMID 35215506. doi:10.3390/nu14040856. https://pmc.ncbi.nlm.nih.gov/articles/PMC8878406/
123. Ashtary-Larky D, Bagheri R, Asbaghi O, et al. Effects of resistance training combined with a ketogenic diet on body composition: a systematic review and meta-analysis. *Crit Rev Food Sci Nutr* 2022;62:5717-32. PMID 33624538. doi:10.1080/10408398.2021.1890689. https://pubmed.ncbi.nlm.nih.gov/33624538/
124. Whittaker J, Wu K. Low-fat diets and testosterone in men: systematic review and meta-analysis of intervention studies. *J Steroid Biochem Mol Biol* 2021;210:105878. PMID 33741447. doi:10.1016/j.jsbmb.2021.105878. https://pubmed.ncbi.nlm.nih.gov/33741447/
125. Spaulding SW, Chopra IJ, Sherwin RS, Lyall SS. Effect of caloric restriction and dietary composition of serum T3 and reverse T3 in man. *J Clin Endocrinol Metab* 1976;42:197-200. PMID 1249190. doi:10.1210/jcem-42-1-197. https://pubmed.ncbi.nlm.nih.gov/1249190/
126. Anderson KE, Rosner W, Khan MS, et al. Diet-hormone interactions: protein/carbohydrate ratio alters reciprocally the plasma levels of testosterone and cortisol and their respective binding globulins in man. *Life Sci* 1987;40:1761-8. PMID 3573976. doi:10.1016/0024-3205(87)90086-5. https://pubmed.ncbi.nlm.nih.gov/3573976/
127. Stimson RH, Johnstone AM, Homer NZ, et al. Dietary macronutrient content alters cortisol metabolism independently of body weight changes in obese men. *J Clin Endocrinol Metab* 2007;92:4480-4. PMID 17785367. doi:10.1210/jc.2007-0692. https://pubmed.ncbi.nlm.nih.gov/17785367/
128. Dirlewanger M, di Vetta V, Guenat E, et al. Effects of short-term carbohydrate or fat overfeeding on energy expenditure and plasma leptin concentrations in healthy female subjects. *Int J Obes Relat Metab Disord* 2000;24:1413-8. PMID 11126336. doi:10.1038/sj.ijo.0801395. https://pubmed.ncbi.nlm.nih.gov/11126336/
129. Galgani JE, Moro C, Ravussin E. Metabolic flexibility and insulin resistance. *Am J Physiol Endocrinol Metab* 2008;295:E1009-17. PMID 18765680. doi:10.1152/ajpendo.90558.2008. https://pmc.ncbi.nlm.nih.gov/articles/PMC2584808/
130. Rosenbaum M, Hall KD, Guo J, et al. Glucose and lipid homeostasis and inflammation in humans following an isocaloric ketogenic diet. *Obesity (Silver Spring)* 2019;27:971-81. PMID 31067015. doi:10.1002/oby.22468. https://pmc.ncbi.nlm.nih.gov/articles/PMC6922028/
