# 15 — Micronutrients, fibre, hydration, food processing and common substances

> Dossier for Vitals (research protocol v1). Author: research agent 15. Compiled 2026-09-30.
> Evidence grades: A = meta-analysis / validated model / several controlled human trials; B = few human RCTs or consistent
> human mechanistic data; C = limited / indirect human data; D = animal, in-vitro, expert opinion.
> `PROPOSED FIT` = equation fitted by me to the listed data points (not published by the source authors).
> `UNVERIFIED` = number recalled from memory or from a secondary source; I could not open the primary source in this session
> (NIH-ODS, NASEM tables, EFSA, DGA PDF and journals.physiology.org were blocked; web-search quota was exhausted part-way).
> Numbers in `[n]` refer to the reference list at the end. "Coordinate NN" = defer to dossier NN.

---

## 1. Scope

This dossier covers the intake components that are **not** protein/fat/carbohydrate grams but still change simulator outputs:
fibre (types, colon, absorbed energy), food matrix / processing / energy density, sodium-potassium-water (scale weight,
hydration), micronutrient adequacy as a function of energy level and food-group exclusion, and the common substances
alcohol, caffeine (+green tea), creatine, plus a short list of other supplements and non-nutritive sweeteners.
For each item it decides whether it should be **(a) a user input, (b) a simulated state/output, or (c) only a warning**,
and gives the quantitative relationships. Macronutrient handling, glycogen, ketosis, MPS, lipids are in dossiers 03-06 and are
only cross-referenced.

### 1.1 Decision matrix (what the app should do with each item)

| Item | (a) Input? (default) | (b) State / output? | (c) Warning only? | Why |
|---|---|---|---|---|
| Total fibre g/d | YES, default = 8 g per 1000 kcal (typical Western) [1][2] | YES: absorbed-energy adjustment, stool mass, fermentation (SCFA) index, satiety coupling | flag < 14 g/1000 kcal; flag fast ramp-up | Whole-food fibre lowers absorbed energy by ~2.8 kcal per g relative to a 2 kcal/g label credit [2]; moves hunger a little |
| Fibre type | ADVANCED only: "viscous soluble g/d" (default 0.15 x fibre) | LDL / glycaemia coupling to 04/06 | otherwise ignore | Only viscous fibre has a solid LDL dose-response [27][28] |
| Nuts / food form | ADVANCED: nuts g/d + form (default 0) | YES: ME correction per nut type | - | Measured ME 5-25% below label kcal [33]-[37] |
| Ultra-processed share (% energy) | YES, default 55 % | YES: spontaneous-intake multiplier + craving-control modifier for dossier 12 | flag > 70 % during a deficit | 3 RCTs, consistent direction [40][41][42] |
| Energy density kcal/g | derived from UPF share; ADVANCED override | YES (same multiplier, elasticity 0.5) | - | Rolls [43][44] |
| Sodium g/d | ADVANCED, default 3.0 g | YES: sodium-load state -> water weight; natriuresis in ketosis/fasting | flag < 1.5 g/d, flag > 5 g/d in hypertension | Small but visible scale-weight effect; big in low-carb transition |
| Potassium, magnesium | ADVANCED, default "typical" | no separate state | YES (intake vs adequate intake; low-carb risk) | Effects are small/indirect; BP part is dossier 06 |
| Fluid intake | ADVANCED, default "adequate (thirst-driven)" | YES only when user sets low fluid or heavy sweat: hydration deficit state | YES: hyponatraemia with high fluid + low solute (fasting) | Scale-weight noise, endurance performance |
| Micronutrient status | quality/variety selector (1-3, default 2), supplement toggle (default off), exclusion flags (auto from macros; vegan/vegetarian selector) | YES: rule-based risk flags per nutrient, slow depletion index | YES | No RCT evidence to simulate levels mechanistically; rules are C/D grade |
| Alcohol | YES: standard drinks per day per block + "with meals / evening / binge" (default 0) | YES: ethanol pool, fat-oxidation suppression, MPS penalty, sleep penalty, extra intake | YES (dose thresholds) | Large, well-quantified acute effects [97][98][107] |
| Caffeine | ADVANCED: mg/day + time of last dose (default 150 mg, 12:00) | YES: small EE add-on, sleep interaction, performance modifier | YES (>400 mg/d, late doses) | EE effect small (<60 kcal/d net), sleep effect large [118][121][132] |
| Green tea extract | no | no | info only | Weight effect ~0 [123] |
| Creatine | YES: on/off + dose (default off; presets 3-5 g/d, optional loading) | YES: muscle-creatine state, water mass, LBM/strength modifiers | note serum-creatinine artefact | Time course & effect sizes well characterised [136][137][139][140] |
| Omega-3, vitamin D | toggles (default off) | tiny coupling (TG in 06); deficiency rule in micronutrient module | - | Benefit mostly in deficient / high-TG people [143][145] |
| MCT | ADVANCED g/d (default 0) | tiny ketone/weight effect (05) | - | -0.5 kg vs LCT over >3 wk [147] |
| BCAA, fat burners, exogenous ketones, "detox" | no | no | one-line "no modelled effect" | No supportive evidence [148][149][150] |
| Non-nutritive sweeteners | no (treated as zero-kcal foods) | no | one line | RCT weight effect = displaced sugar kcal [155][156] |
| Pre-meal water | no | no | tip | -8 to -13 % meal energy in older / overweight adults; small long-term [74]-[76] |

---

## 2. State variables

| Name | Unit | Typical range | Represents | Initial-value rule |
|---|---|---|---|---|
| `F_eff` | g/d | 0-70 | Gut-lag-filtered fibre exposure (EMA of daily fibre, tau_F ~ 3 d ~ whole-gut transit 60-70 h [9]) | = habitual fibre input (or 8 g/1000 kcal x E/1000) |
| `SCFA_idx` | dimensionless (1 = typical Western) | 0.3-1.8 | Relative colonic fermentation / SCFA production | 1.0 |
| `BUT_idx` | dimensionless | 0.2-1.5 | Relative butyrate availability (falls disproportionately with low carbohydrate [16]) | 1.0 |
| `S_stool` | g/d | 40-300 | Fresh stool output (output metric, not stored) | derived |
| `I_lag` | mmol/d | 0-400 | Lag-filtered effective sodium input (intake minus sweat and ketosis losses); tau_Na = 1.5 d | = `I_0` |
| `I_0` (parameter) | mmol/d | 30-300 | Habitual sodium intake at simulation start (fixed reference; the entered body weight already contains its water) | default 130 mmol = 3.0 g Na |
| `W_Na` | kg | -1.5...+1.5 | Water mass attached to sodium state: `kappa x (I_lag - I_0)` | 0 |
| `H_def` | kg | 0-3 | Acute hydration deficit (net fluid shortfall not yet made up) | 0 |
| `EtOH` | g | 0-150 | Ethanol still to be oxidised (queue) | 0 |
| `C_caf` | mg | 0-900 | Caffeine body load (one compartment) | habitual carry-over from previous day |
| `Tol_caf` | 0-1 | 0-1 | Caffeine tolerance (thermogenic / ergogenic) | 1 if habitual >= 300 mg/d, 0.5 if 100-300, else 0 |
| `Cr_x` | fraction | 0-0.4 | Fractional elevation of muscle total creatine above baseline | 0 |
| `W_Cr` | kg | 0-1.5 | Creatine-associated body water | 0 |
| `MN_stat[n]` | 0-1 | 0-1 | Slowly moving adequacy index per micronutrient group (for flags/time-to-symptom) | 1 (replete) unless user reports deficiency |
| `W_gut,fibre` | kg | -0.2...+0.5 | Fibre-dependent gut-content mass (small; fallback if dossier 13's `M_gut` is not used) | 0 |

All other water-weight components (glycogen water, cycle-related water, refeeding oedema) are owned by dossiers 04/13/16; the sums
are defined in 4.7.

---

## 3. Inputs that drive it

| Input | Unit | Default | How it enters |
|---|---|---|---|
| `fibre_g` | g/d (AOAC total dietary fibre) | 8 x E/1000 | ME adjustment (4.2), stool (4.3), SCFA (4.4), satiety (4.5), LDL/glycaemia via 04/06 |
| `viscous_g` | g/d | 0.15 x fibre_g | LDL coupling (06), satiety weighting |
| `nuts_g`, `nut_form` | g/d, enum | 0, "whole raw" | 4.2 nut correction |
| `ups_share` | fraction of energy | 0.55 | 4.6 |
| `ed_override` | kcal/g | null (auto) | 4.6 |
| `sodium_g` | g/d | 3.0 | 4.7 |
| `potassium_g`, `magnesium_mg` | g/d, mg/d | typical (2.8 g, 300 mg) | warnings 4.9 |
| `fluid_L` | L/d | null (= need) | 4.8 |
| `sweat_L_per_h` x `sweat_hours` | L/h, h | from exercise module x climate | 4.8 |
| `alcohol_drinks[d]`, `alcohol_time`, `alcohol_pattern` | standard drinks (14 g, [117]) | 0 | 4.10 |
| `caffeine_mg[d]`, `caffeine_last_time` | mg, clock | 150, 12:00 | 4.11 |
| `creatine_g`, `creatine_loading` | g/d, bool | 0, false | 4.12 |
| `food_quality` | 1 / 2 / 3 | 2 | 4.9 |
| `diet_animal_level` | omnivore / pescatarian / vegetarian / vegan | omnivore | 4.9 |
| `supplements` | {multivitamin, vitD, omega3 g, iron, B12, iodine} | all off | 4.9 |
| `menstruating` | bool | from sex/age (dossier 16) | iron rules 4.9 / 4.14 |
| From other modules | energy intake E, carbohydrate g, fat g, protein g, ketone state, glycogen, exercise sweat, body mass, sex, age | - | multiple |

### 3.1 Recommended input tiers (so casual users can ignore everything here)

| Tier | What the user sees | Controls |
|---|---|---|
| 0 - nothing | Defaults only; the model assumes a typical Western diet | fibre 8 g/1000 kcal, UPF share 55 %, sodium 3.0 g, no alcohol, caffeine 150 mg at 12:00, no supplements, omnivore, food quality 2 |
| 1 - "Food and habits" card (<= 6 controls) | Presets and toggles | fibre preset (low / typical / high = 8 / 14 / 20 g per 1000 kcal); food-form preset (mostly processed / mixed / mostly whole -> UPF share 0.75 / 0.55 / 0.2); alcohol drinks per week; caffeine (none / 1-2 / 3-4+ cups) and last-cup time; creatine on/off (3-5 g/d, optional loading); diet type (omnivore / vegetarian / vegan) with "I take a multivitamin" |
| 2 - advanced | Numbers | exact fibre and viscous-fibre grams; nuts g and form; sodium g; fluid L and sweat; potassium/magnesium/electrolyte supplements; energy-density override; food quality/variety 1-3; omega-3, vitamin D, iron, B12, iodine toggles; MCT g |

Rule: any control left at default must produce output identical to Tier 0; warnings (section 9) fire from Tier-0 assumptions when the plan itself (low energy, very low fat, vegan, fasting, alcohol, late caffeine) triggers them.

---

## 4. Mechanisms and equations

### 4.1 Fibre: what it is, what the engine needs to know

**Mechanism.** Dietary fibre is the part of plant carbohydrate that escapes small-intestinal digestion. It (i) carries a little
energy of its own once fermented, (ii) traps or delays digestion of fat, protein and starch (net: less absorbed energy),
(iii) is fermented by colonic bacteria to short-chain fatty acids (SCFA) and microbial biomass, (iv) adds stool bulk, and
(v) viscous fractions slow gastric emptying / glucose absorption and bind bile acids. The four functional classes below matter
for different outputs; the simulator only needs total fibre `F` plus an optional viscous-soluble amount.

| Class | Examples | Colonic fermentation | Bulking (stool) | Main modelled effect | Evidence |
|---|---|---|---|---|---|
| Viscous soluble | oat/barley beta-glucan, psyllium, guar, pectin, glucomannan | high | modest | LDL (-0.057 mmol/L per g soluble fibre, 2-10 g/d [27]; beta-glucan >= 3 g/d: -0.25 mmol/L LDL [28]); appetite reduced in 59 % of comparisons vs 14 % for non-viscous [23] | A (LDL), B (appetite) |
| Insoluble / poorly fermented | wheat bran, cellulose, lignin | low-moderate | highest | stool mass, transit; carries most of the "less absorbed energy" in whole-grain diets [2] | B |
| Fermentable oligosaccharides | inulin, FOS, GOS | very high, rapid | low | SCFA, gas; lowest GI tolerance per gram [22] | B |
| Resistant starch (RS2/RS3) | raw potato, green banana, cooked-and-cooled starch | high | lower than NSP [12] | SCFA/butyrate; RS is not in nutrient databases [1] | B |

Reference intake: 14 g per 1000 kcal (Dietary Guidelines / IOM AI; secondary citation [160]); Reynolds 2019 found the largest risk
reduction for non-communicable disease at 25-29 g/d and suggested more is better [30]. Typical Western intake: 7.6 g/1000 kcal
(median; IQR 6.6-10.4) in [1]; 8 g/1000 kcal in [2]. Convention used here: `F` = AOAC total dietary fibre. Englyst NSP is
smaller (roughly 0.6-0.7 x AOAC; UNVERIFIED, from UK "18 g NSP ~ 30 g AOAC" convention) - relevant only when using Cummings'
stool equation.

**Evidence grade (classification):** A for LDL and stool bulk; B for the rest.

---

### 4.2 Absorbed energy: fibre and food-matrix adjustment (the "true ME vs label" module)

**Mechanism.** Label (Atwater) kcal assume near-complete absorption of fat/protein/available carbohydrate (general factors 4/9/4 kcal/g; digestibility ~92-98 %, UNVERIFIED) and credit fibre 0, 2 or 4 kcal/g
depending on region [7]. High-fibre, whole-food, coarse-particle diets lower digestibility of fat, protein and starch and raise
faecal energy (undigested substrate + bacterial biomass). Fermentation returns ~2 kcal per g of fermented fibre to the host as SCFA
[7], but the net measured effect in controlled feeding studies is a *loss* of absorbed energy.

**Data (all controlled feeding, all measured by bomb calorimetry or chemical oxygen demand of stool):**

| Study | Design | Fibre (g/d) | Result |
|---|---|---|---|
| Karl 2017 [2] | 81 adults 40-65 y, 6 wk weight-maintenance, RCT parallel; whole-grain-rich (WG) vs refined-grain (RG), identical kcal (~2,550) | WG 40 +/- 5 vs RG 21 +/- 3 | Stool weight +76 +/- 12 g/d; total stool energy RG 125 -> 102, WG 128 -> 197 kcal/d (between-group +96 +/- 18 kcal/d; fibre-adjusted [stool energy - 2.2 kcal/g x fibre] +57 +/- 17); stool energy density unchanged (5.0-5.1 kcal/g dry); RMR +43 +/- 25 kcal/d; combined net energy loss 92 kcal/d (95 % CI 28-156), 108 kcal/d excluding non-adherers |
| Corbin 2023 [1] | 17 young adults, metabolic ward crossover; "Microbiome Enhancer Diet" (MBD: fibre + resistant starch + large particles + minimally processed) vs Western diet (WD), equal designed ME | habitual 7.6 g/1000 kcal; diet fibre UNVERIFIED (supplement not accessible) | Host ME 89.5 % (range 84.2-96.1) on MBD vs 95.4 % (94.1-97.0) on WD, i.e. 116 +/- 56 kcal/d more lost in faeces (p < 0.0001); no change in EE, hunger, intake; large inter-individual spread; energy balance +4 vs +5 kcal/d |
| Zou 2007 [3] | 27 adults, parallel, spontaneous intake reduction on high-fibre low-fat diets | fruit-veg or cereal fibre | Atwater-type factors overestimated ME by up to 4 % (refined) and up to 11 % (low-fat high-fibre) |
| Miles 1988 [5] | 12 men, crossover 6 wk each, 2800 kcal | 37 g (fruit+veg) vs 16 g (juice) | Availability of energy, fat, protein, CHO lower on high-fibre diet; specific Atwater factors overestimated ME by 6 % (37 g) and 4.6 % (16 g) |
| Baer 1997 [4] | 17 adults, 9 diets differing in fat (18/34/47 %) and fibre (3/4/7 % of dry matter) | - | Fibre lowered fat and protein digestibility; ME fell as TDF/NDF rose |
| Livesey 1990 [6] | analysis of 29 human diets, unavailable carbohydrate 4-93 g/d | - | "partial digestible energy value" of unavailable carbohydrate ranged -4.8 to +2.4 kcal/g depending on how well it was fermented |
| Davis 2026 (DAMM model) [8] | mechanistic digestion model validated on the Corbin diets | - | R2 for metabolisable COD 96 % vs 88 % for Atwater; absorbed SCFA energy 33.8 gCOD/d (WD) vs 51.9 gCOD/d (MBD) (~110-165 kcal/d at 3.2 kcal/gCOD; 5-10 % of ME) |

**Accounting convention (this is the crux; it was easy to get wrong).** Faecal energy (FE) is a *physical* quantity, but "absorbed energy vs label" also depends on how many kcal the
label/engine credits to fibre (`c_f`: 0 in some US practice, 2 kcal/g in FAO/EU practice, 4 kcal/g if fibre stays inside "total carbohydrate x 4") [7]. In an isoenergetic-by-design feeding study the extra fibre replaces digestible
energy in proportion to `c_f`, so
`dME_vs_label per extra g fibre = (GE_fib - c_f) - k_F = -(k_F - GE_fib + c_f)` (gross energy added minus digestible energy displaced minus extra faecal energy), i.e. **`k_net = k_F - GE_fib + c_f`**, with FE slope `k_F = 5.0` kcal/g and fibre gross energy `GE_fib = 4.2` kcal/g (2.2 kcal/g non-metabolisable + 2.0 metabolisable, as used by Karl [2]).
Numbers: `c_f = 0` -> 0.8 kcal/g; `c_f = 2` -> **2.8 kcal/g**; `c_f = 4` -> 4.8 kcal/g. Cross-check: Karl's authors' own fibre-adjusted stool-energy difference (+57 kcal/d for +19 g = 3.0 kcal/g) corresponds to `c_f = 2`.
**Engine convention (aligned with dossier 02, which already credits fibre at ME 2.0 kcal/g): `E_eng = 4 x protein + 9 x fat + 4 x (carbohydrate - fibre) + 2.0 x fibre + 7 x alcohol`.** Dossier 02's optional fibre TEF (0.30) should stay at 0 unless this module's `dTEE_fibre` is off.
If the user types kcal from a label/app, the app should recompute from macros with this convention; otherwise bias up to +/- 2-4 kcal per g fibre.

**Equations (`PROPOSED FIT` to Karl [2] post-intervention values; cross-checked against Corbin [1])**

```
FE(F)      = FE0 + k_F * F_eff                     // total faecal energy, kcal/d  (whole-food fibre; PHYSICAL quantity)
FE0        = 0 kcal/d   (plausible -25..+30)
k_F        = 5.0 kcal per g fibre  (95% range 3.5-6.5)
data       : Karl RG  F=21 g -> FE=102 kcal/d ; WG F=40 g -> FE=197 kcal/d  (slope 5.0, intercept ~ -3)
             Corbin  WD 4.6% of intake (~90-95 kcal/d, i.e. F~18 g)  vs MBD 10.5% (~210 kcal/d, i.e. F~40 g)  [both fit within their SD; fibre values UNVERIFIED]
F_ref      = 8 g * E/1000                         // typical density; TDEE equations / label kcal of typical diets are calibrated on this
GE_fib     = 4.2 kcal/g ; c_f = 2.0 kcal/g (engine credit) ; k_net = k_F - GE_fib + c_f = 2.8 kcal/g   (range 1.3-4.3 for k_F 3.5-6.5)
dME_fibre  = - k_net * (F_eff - F_ref)            // kcal/d, applied to absorbed energy on top of E_eng
clamp      : dME_fibre in [ -0.06*E , +0.03*E ]   // cap: Zou's "up to 11 %" Atwater overestimate includes ~4 % present on refined diets [3]; low-fibre gain cap is a guess (grade C)
F_eff      = EMA of daily F with tau_F = 3 d (first-order lag; whole-gut transit 60-70 h [9])
F used in F_eff EXCLUDES fibre contained in nuts (their ME is corrected separately, below; nut fibre ~ 0.10-0.12 g per g nuts, UNVERIFIED) and excludes isolated fibre supplements (k_supp below)
isolated fibre supplements: dME_supp = k_supp * supp_fibre_g,  k_supp = 0 (range -1 .. +2 kcal/g; Livesey [6])
optional thermic add-on (coordinate 02): dTEE_fibre = +2.3 kcal per g above F_ref (Karl RMR +43 kcal for +19 g, p=0.04, not robust) -> default 0
```

Worked examples (`c_f = 2`): 2,550 kcal, fibre 40 g vs typical 20.4 g -> `dME = -2.8 x 19.6 = -55 kcal/d (-2.2 %)` (+ optional RMR +43 -> Karl's ~100 kcal/d net energy effect);
2,500 kcal, fibre 45 g vs 20 g -> `-70 kcal/d (-2.8 %)`; 1,500 kcal, fibre 30 g vs 12 g -> `-50 kcal/d (-3.4 %)`; a near-zero-fibre 2,000 kcal diet vs 16 g reference -> `+45 kcal/d (+2.2 %)`.
For comparison the *faecal-energy* change is larger (+5 kcal per g: +96 kcal/d in Karl, +116 kcal/d in Corbin), because the diet's gross energy also rises with the fibre's own 4.2 kcal/g.

**Nuts and processed/ground forms (multiplicative correction on label kcal of the nut fraction).**

| Food (form) | Measured ME | Label/Atwater | Fraction of label kcal NOT available (`delta`) | Source |
|---|---|---|---|---|
| Almonds, whole raw | 4.42-4.6 kcal/g (129 kcal per 28 g) | 6.0-6.1 kcal/g (168-170 per 28 g) | 0.24-0.27 | [33] (18 adults, 0/42/84 g/d); [34] |
| Almonds, whole roasted | 4.86 kcal/g | 6.1 | 0.20 | [34] |
| Almonds, chopped | 5.04 kcal/g | 6.1 | 0.17 | [34] |
| Almond butter | 6.53 kcal/g | ~6.3-6.5 | ~0 (n.s.) | [34] |
| Walnuts | 5.22 kcal/g (146 kcal per 28 g) | 6.61 (185 per 28 g) | 0.21 | [36] |
| Cashews | 137 kcal per 28 g (range 105-151) | ~163 | 0.16 | [37] |
| Pistachios | 22.6 kJ/g | 23.7 kJ/g | 0.05 | [35] |
| Peanuts, hazelnuts, pecans, seeds | not measured in my sources | - | assume 0.10 (UNVERIFIED) | - |

`dME_nut = - sum_i delta_i * label_kcal_i`. Typical 28-56 g/d of almonds/walnuts: -40 to -80 kcal/d. Mechanism: intact cell walls hold lipid
(fat excretion 10.8 vs 1.7 g/d at 84 g almonds [33]); grinding to butter removes most of the effect [34].

**Whole-food vs refined as one input?** Feasible but redundant: `fibre_g` already carries the whole-grain effect (Karl's WG-RG contrast is
+19 g fibre). A separate "whole vs refined" slider would double-count. Recommendation: keep `fibre_g` + optional `nuts_g/nut_form`;
present the *same* information to casual users as a 3-level "food form" preset that sets `fibre_g` (8 / 14 / 20 g per 1000 kcal) and `ups_share` (0.75 / 0.55 / 0.2).

**Cooked vs raw.** Human evidence is weak: cooking raises starch and protein digestibility mainly in animal experiments and modelling [39];
long-term raw-food eaters (>= 70 % raw, n = 513) had lost ~10-12 kg since starting, 25 % of women BMI < 18.5, ~30 % of women < 45 y partial/complete
amenorrhoea, with BMI falling as raw share rose [38] (cross-sectional; cannot separate lower ME from lower intake and high fibre/low density).
Not modelled beyond a warning (grade C/D).

**Protein's "true ME".** Atwater general 4 kcal/g already nets out urinary nitrogen; net of thermic effect the effective value is ~3-3.2 kcal/g
(coordinate 02/03). Almond protein specific factor 3.47 kcal/g, fat 8.37, CHO 4.07 [33]. No change to the engine beyond 02/03.

**Parameter table**

| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| `k_F` (faecal-energy slope) | 5.0 | kcal per g fibre | 3.5-6.5 | fit to [2]; consistent with [1] |
| `GE_fib` | 4.2 | kcal/g | 4.0-4.4 | gross energy of fibre (2.2 non-metabolisable + 2.0 metabolisable), as used in [2]; UNVERIFIED independently |
| `c_f` (engine credit) | 2.0 | kcal/g | 0 / 2 / 4 by convention | FAO/EU practice [7]; dossier 02 |
| `k_net` = `k_F - GE_fib + c_f` | 2.8 | kcal per g fibre | 1.3-4.3 | derived; Karl fibre-adjusted 57 kcal / 19 g = 3.0 [2] |
| `F_ref` | 8 x E/1000 | g/d | 7.6-8 typical | [1][2] |
| `cap_neg` / `cap_pos` | 0.06 / 0.03 | fraction of E | pos cap = guess | [3] |
| `tau_F` | 3 | d | 2-4 | transit [9] |
| `delta_nut` | 0.05-0.25 (table) | fraction | +/-0.03 | [33]-[37] |
| Colon credit for fermentable fibre | 2.0 | kcal/g fermented | 1.5-2.5 | [7] (embedded in net slope, do not add again) |

**Time dynamics.** Faecal energy follows fibre intake with the gut-transit lag (2-3 d). Adaptation of the fermentative community to a
sustained fibre change is probably additional weeks (Corbin's participants were on diet 11 d at home before the 6-d measurement [1]); the
time course of the *energy* effect has not been measured. Assumption: full effect by 2 weeks. Reversal: as fast as the lag (days).

**Moderators.** Large inter-individual range: MBD ME 84.2-96.1 % [1]; Jumpertz: a 20 % increase in Firmicutes (and matching Bacteroidetes drop)
was associated with ~150 kcal more absorbed [21] (association, n = 21). Overfeeding shrinks fractional stool loss [21]. Interindividual SD of `dME` ~50 % of the mean. Sex/age: none reported.

**Evidence grade: B** (four independent controlled-feeding studies, consistent sign, magnitude 4-11 % of intake; slope extrapolated beyond 40 g/d is C).

---

### 4.3 Fibre -> stool mass and gut-content contribution to scale weight

**Mechanism.** Stool mass = undigested fibre + water held by fibre + bacterial mass. Linear in fibre intake over 4-32 g/d NSP.

```
S_stool (g/d) = 38 + 5.3 * NSP        // Cummings 1992 meta-regression, 26 dietary periods, n=206 (mixed sources: 35 + 4.9*NSP) [9]
              ~ 38 + 4.0 * F_AOAC     // Karl: +76 +/- 12 g/d for +19 g AOAC fibre [2]  (=4.0 g/g); use this with F_eff
UK adults on habitual diet: median 106 g/d (men 104, women 99), whole-gut transit 60 h (men 55, women 72); 17 % of women < 50 g/d, 1 % of men [9]
```

Colon volume (fasting MRI, n = 75): ascending 203 +/- 75, transverse 198 +/- 79, descending 160 +/- 86 mL (total ~560 mL) [14] - includes gas and fluid,
so it overstates solid mass.

**Scale-weight consequence (uncertain, 0.1-0.6 kg).** Colon content ~ stool output x colonic residence time. If transit time is held fixed (as in dossier 13's `M_gut`, using Stephen 1986: stool 162 g/d men / 83 g/d women on a low-fibre diet, +5 g per g NSP, transit 2-3 d), a 0 -> 40 g NSP swing adds ~0.35-0.6 kg;
if residence time shortens as stool mass rises (Cummings: transit time and stool weight are closely related [9]) the product stays ~0.2-0.5 kg and the change is <= 0.15 kg. Midpoint (`PROPOSED`, grade D):
```
W_gut,fibre (kg) = 0.010 * (F_eff - F_ref)      // range 0.005-0.02 kg per g;  +20 g fibre -> +0.2 kg ;  zero fibre -> ~ -0.15 kg
```
**Ownership:** dossier 13 already implements `M_gut`; use ONE of the two (recommended: 13's `M_gut` with the transit time shortened by 20-30 % at NSP >= 25 g/d, and set `W_gut,fibre = 0` here). Real "bloating" comes from gas/fluid and is not a weight effect. On any fibre change expect <= 0.6 kg within 2-4 days.

**Evidence grade: A** for the stool-fibre slope, **D** for the scale-weight translation.

---

### 4.4 Fermentation, SCFA, butyrate, microbiome, and zero-fibre intakes

**Mechanism.** Carbohydrate reaching the caecum is ~20-40 g/d on Western diets and up to 50 g/d on cereal- or fruit/vegetable-rich diets [7];
bacteria convert it to acetate:propionate:butyrate in ratios from 75:15:10 to 40:40:20 [11]; ~95 % of SCFA is absorbed, most butyrate is used by colonocytes,
propionate by the liver, acetate peripherally [11]; absorbed SCFA fraction is a saturating function of colonic transit time (earlier models assumed a constant 95 %) [8].
SCFA supply ~5-10 % of human energy needs [10][11] (~100-170 kcal/d in [8]).

Quantities: 15 g inulin -> ~137 mmol acetate + 11 propionate + 20 butyrate over 12 h (~11 mmol SCFA per g; stable-isotope estimate with assumed absorption fractions) [13];
colonic SCFA concentration 131 mmol/kg in the caecum falling to 80 mmol/kg in the descending colon (autopsy, sudden-death victims) [161]; UNVERIFIED conversion: ~8-11 mmol SCFA per g fermented carbohydrate.

**Dose-response with carbohydrate restriction (obese men, 4 wk per diet, protein ~130-140 g/d):** faecal SCFA 114 -> 74 -> 56 mM and butyrate 18 -> 9 -> 4 mM at
carbohydrate 399 -> 164 -> 24 g/d; Roseburia/E. rectale 11 -> 8 -> 3 % [16]; the very-low-carbohydrate diet also cut faecal ferulate/phenolic acids and raised
N-nitroso compounds and branched-chain fatty acids [17].

```
SCFA_raw = clamp( (0.65*F_eff + RS_g) / 14 , 0.3 , 1.8 )          // 14 g/d fermentable substrate = typical Western (0.65 x 16 g + 4 g RS)
SCFA_idx = SCFA_raw * s(c)                                        // c = carbohydrate g/d (7-day EMA)
BUT_idx  = SCFA_raw * b(c)
s(c) = 0.42 + 0.58*min(1, c/400)      // PROPOSED FIT to total SCFA 114/74/56 mM at c=399/164/24 -> 1.00/0.66/0.46 (observed 1.00/0.65/0.49)
b(c) = 0.20 + 0.80*min(1, c/400)      // PROPOSED FIT to butyrate 18/9/4 mM -> 1.00/0.53/0.25 (observed 1.00/0.50/0.22)
0.65 = assumed fermentable fraction of AOAC fibre in mixed diets (UNVERIFIED); RS_g default 3-5 g/d (not in databases)
```

**Microbiome time course.** Composition responds within 24-48 h to a switch between plant-only and animal-only diets and overwhelms inter-individual
differences in gene expression; the shift reverses when the diet stops [18]. A 17-week RCT of a high-fibre diet (n = 18 per arm) increased glycan-degrading CAZymes
without changing community diversity; a fermented-food diet raised diversity [19]. Therefore: **do not simulate "microbiome diversity"** (grade D); expose only `SCFA_idx`/`BUT_idx`.

**Zero / very low fibre.** Stool falls toward ~38 g/d at NSP-free intake [9]. In 63 patients with idiopathic constipation who *stopped* fibre for 2 weeks and then chose to stay
off (n = 41) or cut back (n = 16), bowel frequency improved from 1 per 3.75 d to 1 per 1.0 d and bloating/straining went 100 % -> 0 % (uncontrolled, self-selected; those who kept a high-fibre diet stayed at 1 per 6.8 d) [15].
A survey of 2,029 adults on carnivore diets for >= 6 months (median 14 mo) reported GI symptoms in 3.1-5.5 % and mean LDL-C 172 mg/dL [20] (self-selected, self-reported, no denominators).
Mechanistic downsides: lower butyrate/SCFA and fibre-derived phenolics, more protein-derived metabolites [16][17]. Verdict: constipation is *not* a predictable consequence of zero fibre; long-term colonic and
cardiometabolic consequences are unknown -> warning (c), no state.

**Tolerance when fibre is raised quickly.** Tolerable doses are fibre-specific in 103 trials (0.75-160 g/d): recommended ceilings ranged from 3.75 g/d (alginate) to 25 g/d (soy fibre) for isolated
fibres before bloating/flatulence/rumbling appear [22]; whole-food ramps have no trial-based rate. Implementation (`PROPOSED`, grade D): warn if `F` rises by > 10 g/d within 7 days or exceeds 50 g/d; assume transient GI symptoms 1-3 weeks.

**Evidence grade:** B for SCFA/butyrate vs carbohydrate (single controlled feeding series), C for SCFA-per-gram conversion, D for diversity/health claims.

---

### 4.5 Fibre -> satiety, adherence, glycaemia, LDL, health outcomes

| Output | Quantitative relationship | Source | Grade |
|---|---|---|---|
| Acute appetite / intake | Viscous fibre reduced appetite in 59 % vs 14 % of comparisons (non-viscous), acute EI in 69 % vs 30 %; acute EI cut 0.1-0.4 MJ (24-96 kcal) with viscous fibre | [23] | B |
| Long-term intake | Average -0.15 MJ/d (-2.6 % of intake) and -0.39 kg per 4 wk over 3-19 wk trials, not type-specific (as summarised in NNR 2023 review) | [23][32] | B |
| Body weight, trials | Reynolds 2019: 27 trials -0.37 kg for higher vs lower fibre; SBP -1.27 mmHg; total cholesterol -0.15 mmol/L | [30][32] | A |
| Soluble fibre supplements | Isolated soluble fibre without energy restriction -2.52 kg (95 % CI -4.25 to -0.79), BMI -0.84, fat -0.41 %, fasting glucose -0.17 mmol/L (12 RCTs, 2-17 wk, very heterogeneous); viscous fibre inside a calorie-restricted diet -0.81 kg (-1.20 to -0.41), 15 RCTs | [24][25] | B |
| Weight loss / adherence in a deficit | POUNDS Lost (n = 345, 6 mo, -750 kcal/d): fibre intake was the strongest predictor of weight loss (standardised beta -0.37) and of macronutrient-prescription adherence, independent of energy and macros | [26] | C (secondary analysis) |
| LDL | -0.057 mmol/L per g soluble fibre (95 % CI -0.070 to -0.044), 2-10 g/d, pectin/oat/psyllium similar; oat beta-glucan >= 3 g/d: LDL -0.25 mmol/L (-0.20 to -0.30), TC -0.30 | [27][28] | A (coordinate 06) |
| Glycaemia | In type 2 diabetes: fasting glucose -0.85 mmol/L, HbA1c -0.26 % (15 RCTs); for healthy people no simulated effect beyond 04 glycaemic index handling | [29] | B (T2D only) |
| Disease outcomes | Highest vs lowest intake: all-cause mortality -15 %, T2D RR 0.84 (0.78-0.90), CRC -16 %, CVD RR 0.91 per 7 g/d (0.88-0.94); best 25-29 g/d | [30][31][32] | A/B (observational) |

**Implementation for the appetite module (dossier 12):**
```
spont_intake_mult_fibre = 1 - 0.0013 * clamp(F_eff - F_ref, -10, +30)      // -2.6% at +20 g;  PROPOSED from [23] (grade C)
```
Effect is on *unrestricted (ad libitum)* intake or on a hunger/adherence score, not on the user-specified kcal target.
For diabetics the glycaemic coupling should be handled in dossier 04.

---

### 4.6 Food processing, energy density and eating rate -> spontaneous intake (hunger/adherence, coordinate 12)

**Mechanism.** Ultra-processed food (NOVA-4) is softer, more energy-dense (non-beverage), eaten faster and more palatable; participants do not report more hunger
but eat more (and gain fat) when food is freely available. All three RCTs used ad libitum access.

| Study | Design | Result |
|---|---|---|
| Hall 2019 [40] | 20 weight-stable adults, NIH ward, crossover 2 wk each, matched for *presented* kcal/macros/sugar/sodium/fibre | Intake +508 +/- 106 kcal/d on ultra-processed (carbohydrate +280, fat +230, protein -2); weight +0.9 +/- 0.3 kg (UP) vs -0.9 +/- 0.3 kg (unprocessed); fat mass +0.4 vs -0.3 kg; consumed energy density 1.36 vs 1.09 kcal/g (non-beverage 1.96 vs 1.06); eating rate +17 kcal/min (+7.4 g/min); VAS hunger/fullness/pleasantness not different; ghrelin lower and PYY higher on unprocessed |
| Hamano 2024 [41] | 9 overweight Japanese men, 1 wk each, crossover, matched energy/macros | +813 kcal/d (95 % CI 342-1285), weight +1.1 kg (0.2-2.0), fewer chews per kcal |
| Dicken 2025 (UPDATE) [42] | 50 ITT of 55 overweight UK adults (habitual UPF 67 % energy), 8-wk ad libitum crossover, both diets following the Eatwell Guide | Weight -2.06 % (MPF) vs -1.05 % (UPF), delta -1.01 % (-1.87 to -0.14); fat mass -1.59 vs -0.61 kg (delta -0.98, -1.62 to -0.33); self-reported intake -504 vs -290 kcal/d vs baseline (delta -327); body-composition-derived energy imbalance -290 vs -120 kcal/d (delta -170, i.e. ~half the self-report difference); energy density 1.25 vs 1.60 kcal/g (corrected 2025-12-15); craving control (CoEQ) +23.8 vs +12.1 (p = 0.019); hunger VAS unchanged; LDL fell more on UPF (-0.38 vs -0.13 mmol/L, p = 0.016) while triglycerides fell more on MPF (-0.25 mmol/L difference, p = 0.004); constipation 3 vs 11 events, fatigue 4 vs 16 (MPF vs UPF) |
| Rolls 2006 [44] | 24 women, 2-day ad libitum, portion size and energy density each 100 % vs 75 % | ED -25 % -> intake -24 % (-575 kcal/d); portion -25 % -> -10 % (-231 kcal/d); additive; no hunger difference |
| Ello-Martin 2007 [45] | 97 obese women, 1 y, no calorie goal | Reduced fat + more fruit/veg (lower ED): -7.9 vs -6.4 kg, less hunger |
| Robinson 2014 [46] | meta-analysis, 22 studies | Slower eating rate -> lower intake (SMD 0.45, 95 % CI 0.25-0.65), no hunger difference |
| Hall 2019 citing Forde | - | 20 % change in eating rate ~ 10-13 % change in intake (secondary citation) |

**Model (spontaneous-intake multiplier applied only in ad-libitum/"auto-intake" mode and to the adherence/craving score; user-fixed kcal are never altered):**
```
M_UPF = 1 + gamma_u * (ups_share - 0.55)            // gamma_u = 0.15 per unit share (0.10-0.25)
        fits: Hall 0 vs 83 % share -> ~ +20 % (gamma ~0.24); UPDATE ~0.1 vs ~0.8 -> +16 % self-reported (gamma ~0.22) or +8 % body-comp (gamma ~0.11)
ED_auto(u) = 1.15 + 0.35*u   kcal/g                 // PROPOSED: u=0 -> 1.15 ; u=0.83 -> 1.44 (Hall 1.09/1.36 incl. beverages; UPDATE 1.25/1.60)
M_ED  = ( ED / ED_auto(u) ) ^ eps,   eps = 0.5 (0.25-1.0) // only if the user overrides ED; avoids double counting with M_UPF
        elasticities: Rolls 0.95 (2 d, lab) ; Hall ~0.3 ; UPDATE 0.3-0.65
craving_control_penalty (dossier 12) = -11.7 CoEQ points per +0.7 UPF share (UPDATE)   // grade B, one trial
```
Sub-effects to expose as *explanations*, not as inputs: eating rate (Hall +17 kcal/min), chews per kcal [41], non-beverage ED.

**Time dynamics.** Intake difference is present from the first days (Hall: linear decline of intake over time on the UP diet [40]) and persisted over 8 weeks in [42];
reversal is immediate when food environment changes. Body-composition consequences follow the energy-balance model (dossier 01).

**Moderators.** Baseline BMI and sex not significant in [40]; habitual UPF share and weight not associated with response in [42]; the UPF arm in [42] used
"healthy" reformulated UPF and portion-size labels, so effects are probably conservative.

**Caveat (important for calibration).** Self-reported intake overstated the between-diet difference ~2x compared with the change in measured body composition in [42]; use the body-composition-derived deficit (-170 kcal/d) when calibrating M_UPF to weight outcomes and the self-reported one when calibrating to reported intake.

**Evidence grade: B** (three RCTs of increasing size, one metabolic-ward; consistent direction; magnitude uncertain by 2x).

---

### 4.7 Sodium, potassium, water: the water-weight sub-model (coordinate 13, 04, 05, 16)

**Mechanism.** Extracellular fluid (ECF) volume is set mainly by body sodium; the kidney matches sodium excretion to intake with a lag of ~3-4 days after an
abrupt change (classic Strauss 1958 data, quoted in [51]). Sodium is excreted with an anion, so anion-rich states force sodium loss: during fasting or
very-low-carbohydrate intake, ketone anions (beta-hydroxybutyrate, acetoacetate) and phosphate need cations; the "natriuresis of fasting" peaks in the first days
and fades as ammonium replaces sodium as the accompanying cation and tubular sensitivity to aldosterone falls [54]. Insulin does the opposite: it lowers urinary sodium
excretion by ~47 % (401 -> 213 mueq/min, supraphysiological insulin clamp) [55], which is one reason carbohydrate reintroduction retains sodium and water.
Glycogen carries water and potassium: 3-4 g water and 0.45 mmol K per g glycogen [59][60] (owned by dossier 04/13).

**Key human data**

| Study | Design | Result |
|---|---|---|
| Visser 2009 [162] / van den Bosch 2021 [163] / Krikken 2012 [164] | 70-78 healthy young men (median BMI 22.5), 1 wk at 50 vs 1 wk at 200 mmol Na/d, crossover, ward-controlled | Urinary Na 38 +/- 26 vs 230 +/- 67 mmol/24 h; **body weight 79.2 vs 80.6 kg (+1.4 kg on high sodium, p < 0.001)**; ECF volume +1.2 +/- 1.8 L (iothalamate space), 16.5 -> 17.4 L/1.73 m2; plasma Na +2 mmol/L; SBP +3 mmHg; urine volume not different (low-sodium 1,835 vs high-sodium 1,722 mL, p = 0.2); rise in ECFV larger at higher BMI (r = 0.36) |
| Heer 2000 [47] | 32 men, ward, NaCl 50 -> 200/400/550 meq/d | Plasma volume +315 +/- 37 mL at 550 meq/d, but **total body water and body mass did not increase** (interstitial -> intravascular shift) |
| Titze 2002 [48] | 3 men, 135-d Mir simulation | Total-body Na +2,973-7,324 mmol with weight +5.1-9.3 kg (= 1.3-1.7 g body mass per mmol Na retained, far below the isotonic 7.1 g/mmol); sodium sometimes gained without weight -> "osmotically inactive reservoir" hypothesis |
| Rakova 2017 [49] | 10 men, 105/205-d space-flight simulation at 12/9/6 g salt/d | +6 g salt/d raised urine osmolyte excretion but reduced free-water clearance (endogenous water gain), reducing drinking; weekly aldosterone/cortisol rhythms |
| He 2001 [50] | 104 hypertensives (5th day of high vs low salt) + 634 + INTERSALT | 24-h urine volume 2.2 L (277 mmol Na) vs 1.3 L (21 mmol): each 100 mmol/d of Na = +367-454 mL urine/d |
| Mihara 2019 [51] | 311 hospitalised CKD patients, 5 g salt/d diet | Median weight loss 0.7 kg (IQR 0-1.4) day 4, 1.0 kg (0.3-1.7) day 7; larger with high habitual urinary salt and high BMI (not healthy adults) |
| Mahler 2022 [52] | 40 healthy adults, +6 g salt/d capsule for 2 wk | Urinary Na +2.29 g/d; no significant change in body composition, fluid intake, hydration or urine volume; DIT -1.3 % |
| Hall 2016 [58] | 17 overweight men, 2,400 kcal, carbohydrate 300 -> 31 g/d, protein 91 g, Na 2.7 -> 4.9 g/d (chemical analysis) | Rapid additional weight loss of -1.6 +/- 0.2 kg after the switch (mainly water; fat -0.2 +/- 0.1 kg over the following 15 d; exact timing not extracted); total -2.2 kg (-0.5 kg fat) over the 28-d ketogenic period |
| Yang & Van Itallie 1976 [56] | 6 obese subjects, 10 d each on 800 kcal ketogenic vs mixed diet | Loss 467 vs 278 g/d; water 61 % vs 37 % of loss, fat 35 % vs 60 % |
| DeHaven 1980 [53] | 7 obese subjects, 400 kcal protein diet vs isocaloric mixed diet, 3-5.5 wk each | Net sodium loss -382 +/- 117 mmol (protein/ketotic) vs -25 +/- 105 mmol (mixed); orthostatic SBP fall -28 vs -18 mmHg with symptoms in all; norepinephrine -40 % (sodium intake in protocol UNVERIFIED) |
| Sigler 1975 [54] | 9 obese women, fasting with sodium intake maintained | Sodium diuresis matched by organic-acid anion + phosphate excretion (y = 0.73x + 19, r = 0.89); ammonium later substitutes; sodium excretion falls promptly on glucose refeeding |
| Phinney 1983 [57] | 9 lean men, eucaloric ketogenic diet 4 wk (<20 g CHO), supplemented | Weight and 40K whole-body potassium unchanged over 5 wk |

Interpretation: two lines of evidence disagree on how much *steady-state* body water accompanies a change in sodium intake (Visser/Krikken: ~+0.9 kg per +100 mmol/d after 7 days;
Heer: ~0 at up to +500 mmol/d; Titze: retained sodium carried 1.3-1.7 g of body mass per mmol instead of the isotonic 7.1 g). They also disagree on urine volume (He: +0.4 L per +100 mmol/d; Visser/van den Bosch: unchanged). The model therefore carries an explicit uncertain parameter `kappa` and the UI should show a range.

**Interface with dossier 13 (it already defines `S_na`, `Na_hab`, `E_cna`, `M_gut`; implement ONE sodium/water model).** Recommended merge:
(i) keep 13's `E_cna` for carbohydrate/insulin-sensitive natriuresis (E_max 0.6 L, tau 1.5 d down / 0.7 d up) and set `A_nat = 0` below - my `L_ket` is an equivalent stand-alone fallback and would double count;
(ii) keep 13's `S_na` state (`water_salt = S_na/140`) but soften its habituation: 13's `tau_hab = 5 d` forces total body water back to baseline, which the 7-day crossover of Visser/Krikken (+1.4 kg and +0.9-1.2 L ECF still present at day 7) does not support, whereas Heer's ward study (no TBW change) does.
Introduce partial habituation `h` (share of a sodium step to which the set-point adapts): `Na_hab_eff = Na_0 + h*(Na_hab - Na_0)`, steady-state water `= (1-h)*tau_Na*dNa/140` L. Default `h = 0.5`, `tau_Na = 1.5 d` -> 0.54 kg per +100 mmol/d (= `kappa` 0.0054 kg per mmol/d below); Visser/Krikken correspond to `h ~ 0`, Heer to `h ~ 1`.

**Sub-model (daily step; all other water sources are added by the master water-weight module)**

```
// sodium input, mmol/day.   1 g Na = 43.5 mmol ;  1 g NaCl = 17.1 mmol Na ; 100 mmol Na = 2.3 g Na = 5.8 g salt
I_Na  = sodium_g*1000/22.99 + supplement_Na
// non-dietary net losses (renal or sweat) that act like a lower effective intake
L_sweat = sweat_L * sweat_Na_mmolL      // sweat Na 10-70 mmol/L (whole-body), typical ~35; sweat 0.5-2.0 L/h [64]
L_ket   = A_nat * K_nat(t)              // natriuresis of ketosis/fasting, mmol/d (see below); set A_nat = 0 when dossier 13's E_cna is active
I_eff   = I_Na - L_sweat - L_ket
I_lag   = EMA(I_eff, tau_Na)            // tau_Na = 1.5 d (steady state in ~3-4 d [51])
W_Na    = kappa * (I_lag - I_0) / 1000  // kg ;  I_0 = habitual intake at simulation start (default 130 mmol = 3.0 g Na)
kappa   = 6 g body mass per (mmol/d)  = 0.006 kg per mmol/d     // range 0 - 12 ; Visser/Krikken 9.3 [162-164]; Heer ~0 [47]
                                                                //  -> +100 mmol/d (2.3 g Na) = +0.6 kg (range 0 - 1.2 kg)
kappa moderators: BMI (r = 0.36 with the ECF response [162]) -> use upper range (0.009-0.012) for BMI >= 30 (slope UNVERIFIED);
                  CKD / heart failure / salt-sensitive hypertension: larger, out of scope -> warn
// natriuresis in ketosis / fasting (PROPOSED FIT)
K_nat   : 0..1 carbohydrate-deficit / ketosis-onset signal from 04/05, rises with tau_on = 2 d, falls with tau_off = 0.5 d on carbohydrate refeed (Sigler [54])
A_nat   = 50 mmol/d (1.15 g Na), decays with tau_nat = 5 d after onset, tail 10 % while ketotic
          check: integrates to ~250 + 100 = ~350 mmol over 4 wk = DeHaven excess loss (-382 vs -25 mmol) [53]; with kappa this gives -0.3 kg peak (small)
// refeeding retention (grade D): for 2 d after carbohydrate rises by > 100 g/d, multiply renal excretion by 0.8 (insulin antinatriuresis -47% at clamp doses [55])
```

Expected magnitudes with the default kappa (0.006): a "salty day" (+3 g Na = +130 mmol for one day) -> ~+0.4 kg next morning (range 0-0.8), fading over 3-4 d; a sustained rise from 3 g to 6 g Na/d (+130 mmol/d) -> ~+0.8 kg after ~4-7 d (0-1.6; Visser/Krikken-type response is the top of this range);
going from 3 g to 1 g Na/d (-87 mmol/d) -> about -0.5 kg (-0.2 to -1.0) within a week. Most of the first-week scale drop on a low-carbohydrate diet is glycogen water (~1-2 kg [58][59]) with sodium contributing ~0.3-0.6 kg.

**Total water-weight sum (agreed interface with 13):**
```
W_water_excess = W_glycogen_water(04) + W_Na(15 or 13's S_na/E_cna) + W_Cr(15) + W_gut,fibre(15 or 13's M_gut, not both) - H_def(15) + W_cycle(16) + W_refeed_oedema(13)
scale_noise ~ N(0, 0.5 kg)  daily (first-morning body mass day-to-day variability 0.51 +/- 0.20 kg, CV 0.66 % in active men [69]);
weekly rhythm: higher Sun-Mon, falling to a minimum Fri-Sat (Orsama 2014, 80 adults, 4,657 measurements; amplitude not given in the abstract) [68]
```

**Potassium and magnesium.** NASEM 2019: sodium AI 1,500 mg/d, chronic-disease-risk-reduction limit 2,300 mg/d; potassium AI 3,400 mg (men) / 2,600 mg (women) [72] (the 2005 report's 4.7 g/d is superseded [73]).
US adults on food alone (NHANES 2009-2012, non-supplement users): magnesium 304 mg/d with 54.6 % below EAR [85]. Carbohydrate-restricted diets reduced magnesium and other intakes 10-70 % [80].
Eucaloric ketosis did not deplete whole-body potassium over 5 weeks [57]; magnesium supplements are not shown to prevent cramps [151] (Cochrane conclusion beyond the abstract UNVERIFIED).
Both are warnings (c): flag potassium < AI and magnesium < EAR when carbohydrate < 100 g/d or energy < 1,500 kcal; no separate state variable.

**Sodium needs in ketosis (the "3-5 g/day" advice).** Practitioner texts (Phinney/Volek) advise 3-5 g Na/d, 3-4 g K, 300-500 mg Mg in the keto-adaptation period. I found no controlled trial testing electrolyte supplementation for
"keto flu"; the mechanistic support is the natriuresis above [54][53][58]. **Grade D** for the numeric range; **B** for the existence of extra sodium loss.
Implementation: show "sodium below need" warning when `carbohydrate < 50 g/d` (first 3 weeks) and `sodium_g < 3.0 g`; do not cap sodium in the simulator.

**Evidence grade (sub-model): C** overall (steady-state size of the effect contested; direction certain; time constant from a 1958 classic and 2 modern crossover studies; natriuresis magnitude fitted to one study).

**Hyponatraemia with water-only fasting / very low solute intake.** Diluting capacity is limited by solute excretion; case series show hyponatraemia from high fluid with low solute intake ("potomania": 44 case reports) [70].
Supervised 4-21-day Buchinger fasts with ~200-250 kcal/d of broth/juice recorded adverse events in < 1 % of 1,422 people [71], so the risk applies to *plain-water*, very-low-solute fasts with large fluid volumes.
Exercise-associated hyponatraemia has its own international consensus statement [67] (full text not retrieved; the meta-analytic advice to drink to thirst is in [66]).
Rule (`PROPOSED`, grade C/D): during fasting or intake < 800 kcal without added sodium, warn when fluid > 3 L/d; hard-warn > 5 L/d; never simulate fluid loading as a strategy.

---

### 4.8 Hydration: needs, scale weight, performance

**Total water turnover** (isotope-tracking, 5,604 people aged 8 d to 96 y, 23 countries) [61]:
```
WT (mL/d) = 1076*PAL + 14.34*BW_kg + 374.9*Sex + 5.823*Humidity_% + 1070*Athlete + 104.6*HDI + 0.4726*Altitude_m
          - 0.3529*Age^2 + 24.78*Age + 1.865*Temp_C^2 - 19.66*Temp_C - 713.1
Sex: 0 female, 1 male; Athlete: 0/1; HDI: 0 high, 1 middle, 2 low; PAL = physical activity level (e.g. 1.75 sedentary, 2.5 very active). R2 = 0.47.
Example (paper): sedentary 70-kg man PAL 1.75, 10 C, sea level -> ~3.2 L/d; 60-kg woman -> ~2.7 L/d; means: men 20-30 y 4.3 L/d, women 20-55 y 3.4 L/d.
```
WT includes water from food (~19 % of intake; NASEM AI total water 3.7 L men / 2.7 L women, of which 3.0 / 2.2 L from beverages) [73] and metabolic water (~0.25-0.35 L/d, UNVERIFIED).
Drinking need ~ WT - food water - metabolic water. The "8 x 8 oz" rule has no objective support [61].

```
need_fluid_L = max(1.2, 0.81*WT/1000 - 0.3)          // PROPOSED (81 % from beverages [73])
H_def(t+1)   = H_def(t)*exp(-1/tau_H) + max(0, (need_fluid_L + sweat_L*(1-refill_fraction)) - fluid_L)*f_kidney
tau_H = 0.5 d (thirst-driven recovery), f_kidney = 0.6 (kidneys conserve water before mass falls), cap 2.5 kg (~3 % of 80 kg)   // grade D
default: fluid_L = need_fluid_L  -> H_def = 0
```
Rehydration after exercise: drink ~150 % of the mass lost (protocol of Shirreffs & Maughan, adopted in ACSM position [63][114]).

**Sweat.** Whole-body sweat rate typically 0.5-2.0 L/h (> 3 L/h in ~2 % of athletes); whole-body sweat Na 10-70 mmol/L (0.23-1.6 g Na/L; typical ~0.8 g/L) [64].
Each litre sweated = 1 kg body-mass change; sodium loss enters `L_sweat` above.

**Performance thresholds.** ACSM: keep exercise-induced dehydration < 2 % of body mass [63]. Meta-analysis: at fixed-intensity exercise a >= 2 % deficit reduced power by 1.91 +/- 1.53 %; in time-trial (ecologically valid) exercise a deficit <= 4 % did not impair
performance (+0.09 +/- 2.60 %, p = 0.9) [66]; a >= 2 % threshold is supported for endurance capacity via volume loss, but not for strength/power or cognition [65].
```
perf_mult_endurance_fixed = 1 - 0.0096*max(0, dehyd_pct)     // ~ -1.9% at 2%  (PROPOSED slope through [66]); time-trial: 1.0 up to 4%
strength/power/cognition: no hydration multiplier (grade C)
```

**Alcohol/caffeine and fluid.** Dilute alcohol (1-4 % ABV) after exercise dehydration has a negligible diuretic effect; 4 % delays plasma-volume recovery [114]; the diuretic action of 1 L of 4 % beer is blunted when hypohydrated [115]. No effect modelled.
Caffeine diuresis: no evidence retrieved -> not modelled (UNVERIFIED).

**Evidence grade:** A for turnover prediction (large isotope dataset), B for exercise thresholds (meta-analysis, but protocol-dependent), D for the H_def state parameters.

---

### 4.9 Micronutrient adequacy -> rule-based risk flags (no mechanistic depletion model)

**Position.** There is no human dose-response literature that would let the simulator predict blood levels of vitamins/minerals from a macro pattern. What *can* be done defensibly is (i) project nutrient
intake as `density x energy`, (ii) compare it with the Estimated Average Requirement (EAR), and (iii) flag patterns known to lower density (carbohydrate restriction, very low fat, animal-food exclusion, low energy).
Output = traffic-light flags + a probability of inadequacy, **not** a simulated deficiency. Functional consequences are narrated with time horizons, not simulated (except iron-fatigue as a small modifier).

**Baseline facts (US adults).**
- Usual intake from food + beverages below EAR (NHANES 2005-2016, n = 26,282): vitamin D 95 % (usual intake 4.7 ug = 188 IU vs EAR 10 ug), vitamin E 84 % (9 mg vs EAR 12 mg), vitamin A 45 % (639 ug; EAR 500-625 ug), vitamin C 46 % (83 mg; EAR 60-70 mg), zinc 15 % (12 mg; EAR 6.8-9.4 mg); with supplements: D 65 %, E 60 %, A 35 %, C 33 %, Zn 11 % [84].
- NHANES 2009-2012 non-multivitamin users (food only): Mg 304 mg/d with 54.6 % below EAR; Ca 986 mg/d, 40.5 %; vitamin A 620 ug, 47.8 %; C 83.9 mg, 46.3 %; D 4.8 ug, 95.6 %; E 8.3 mg, 86.9 %; Zn 11.7 mg, 15.1 %; folate 551 ug DFE, 10.5 %; thiamin 1.64 mg, 5.5 %; iron 15.3 mg, 4.3 %; B12 5.3 ug, 3.3 % [85]. Enrichment/fortification and supplements are large contributors; only 3 % of people exceeded the potassium AI and 35 % the vitamin K AI (NHANES 2003-2006) [86].
- Multivitamin/mineral users at >= 21 days/month: still 18.8 % below the Ca EAR and 19.3 % below the Mg EAR (a standard MVM contains little Ca/Mg) [85].

**Energy level.** Calton 2010 [78] analysed the suggested daily menus of four popular diet plans (Atkins for Life, South Beach, DASH and one more as listed in the abstract; mean 1,748 kcal): they met 100 % of the FDA Reference Daily Intake for only 11.75 of 27 micronutrients and were consistently low in
biotin, vitamin D, vitamin E, chromium, iodine, molybdenum (extrapolated "27,575 kcal to meet all 27" is an artefact of one nutrient; the paper does **not** identify a 1,200-kcal threshold). In the A TO Z trial (291 women analysed, randomised to Atkins/Zone/LEARN/Ornish, 8 wk; mean intake fell ~1,935 -> ~1,370-1,480 kcal/d) the share of women moving into a range of inadequacy rose for thiamin, folate, vitamin C, iron and magnesium on Atkins;
vitamin E, thiamin and Mg on LEARN; vitamin E, B12 and zinc on Ornish; the Zone diet (moderately low carbohydrate, nutrient-dense foods) *reduced* risk for A, E, K, C [79].

**Nutrient density of a typical Western diet -> the energy at which it reaches the EAR** (`PROPOSED` derivation from A TO Z baseline women, n = 291, mean 1,935 kcal, three 24-h recalls [79]; EARs from NASEM DRI tables - UNVERIFIED in this session except vitamins D/E/A/C and zinc which match [84]):

| Nutrient | Baseline intake (mean of 4 arms) | Density per 1000 kcal | EAR women 31-50 | Energy at which typical density = EAR (women) | EAR men | (men) |
|---|---|---|---|---|---|---|
| Magnesium | 298 mg | 154 mg | 265 mg | ~1,720 kcal | 350 mg | ~2,270 |
| Calcium | 859 mg | 444 mg | 800 mg | ~1,800 | 800 mg | ~1,800 |
| Vitamin A | 681 ug (as reported) | 352 ug | 500 ug RAE | ~1,420 | 625 ug RAE | ~1,775 |
| Zinc | 10.3 mg | 5.3 mg | 6.8 mg | ~1,280 | 9.4 mg | ~1,770 |
| Vitamin C | 96 mg | 50 mg | 60 mg | ~1,200 | 75 mg | ~1,500 |
| Folate | 532 ug ("folic acid", as reported) | 275 ug | 320 ug DFE | ~1,160 | 320 ug | ~1,160 |
| Thiamin | 1.6 mg | 0.83 mg | 0.9 mg | ~1,080 | 1.0 mg | ~1,200 |
| Iron | 14.9 mg | 7.7 mg | 8.1 mg | ~1,050 | 6 mg | ~780 |
| Vitamin B12 | 5.1 ug | 2.6 ug | 2.0 ug | ~770 | 2.0 ug | ~770 |
| Vitamin K (AI) | 124 ug | 64 ug | 90 ug (AI) | ~1,400 | 120 ug (AI) | ~1,875 |
| Vitamin E | 9.2 mg | 4.7 mg | 12 mg | ~2,550 (short at any energy) | 12 mg | ~2,550 |
| Vitamin D | 4.3 ug | 2.2 ug | 10 ug | ~4,550 (short at any energy from food alone) | 10 ug | ~4,550 |
| Fibre (AI 14 g/1000 kcal) | 7.6-8 g/1000 kcal [1][2] | 8 g | 14 g/1000 kcal | never met by a typical diet [160] | same | - |

Reading: a *typical-density* diet at <= ~1,700 kcal is short on Mg and Ca; at <= ~1,400 also vitamin A and K; at <= ~1,250 also zinc, vitamin C, folate; at <= ~1,100 also iron and thiamin. This agrees in direction with A TO Z (new inadequacy signals at ~1,400 kcal) [79].
Caveats: self-reported 24-h recalls (energy under-reporting), women only, US food supply (fortification), EAR = median requirement (50 % of people inadequate at that intake).

**Probability of inadequacy (IOM method; `UNVERIFIED` this session but standard):** `R = intake/EAR`, `P_inad = Phi((1 - R)/CV)`, CV of requirement = 0.10 (0.15 for iron, UNVERIFIED). R = 1.0 -> 50 %; R = 1.2 (~RDA) -> 2.3 %; R = 0.75 -> 99.4 % (CV 0.10) or 95 % (CV 0.15).

**Pattern modifiers on density** (`PROPOSED`, grade D; anchors are the cited studies; all with +/-30 % uncertainty):

| Pattern trigger | Multipliers applied to the typical density | Anchor evidence |
|---|---|---|
| Carbohydrate < 100 g/d or < 25 % E, food quality 1-2 | fibre x0.5; vitamin C x0.6; folate x0.65; thiamin x0.75; potassium x0.75; magnesium x0.8; iodine x0.85; iron x0.9; calcium x0.9; A/E/K x1.0 (inconsistent) | Systematic review of 10 studies: intakes of thiamin, folate, Mg, Ca, iron and iodine fell 10-70 % on carbohydrate-restricted diets, no clinical deficiency reported; Paleo-type diet at ~30 % CHO raised moderate iodine deficiency 15 -> 73 % at 6 mo [80]; A TO Z Atkins arm [79]; Hall 2016 diets: fibre 26 -> 12 g/d [58] |
| Same, but food quality 3 (non-starchy vegetables, nuts/seeds, fish, dairy or fortified alternatives) | all multipliers -> 1.0 | Modelled 7-day plans at 20/40/100 g net carbohydrate exceeded RDA/EAR for most micronutrients [96] (menu modelling, not intake) |
| Fat < 20 % E or < 30 g/d | E and fat-soluble vitamin absorption penalty; LA/ALA flag | Carotenoid absorption negligible with fat-free dressing, higher with 28 g than 6 g oil [91]; vitamin D3 peak 32 % higher with a 30 %-fat meal than fat-free [92]; vitamin E absorption low with 2.7 g fat or none vs 17.5 g [93]; A TO Z Ornish arm (21 % fat): E, B12, Zn risk [79] |
| Animal foods excluded (vegan), no fortified foods / supplement | vitamin B12 x0.1; Ca x0.75; iodine x0.6; Zn x0.8; vitamin D x0.8; EPA+DHA x0.05; iron intake x1.0 but absorption penalty (see below) | Systematic reviews: vegan B12 intake 0.24-0.49 ug/d vs 2.4 recommended; Ca below 750 mg/d in most; low B2, niacin, D, iodine, Zn, K, Se; NOT low A, B1, B6, C, E, Fe, P, Mg, Cu, folate [82]; plant-based diets lower B12, D, iron, zinc, iodine, Ca status, higher fibre, folate, C, E, Mg [81]; vegetarian ferritin -29.7 ug/L (95 % CI -39.7 to -19.7) [83] |
| Vegetarian (dairy/egg) | B12 x0.5; Zn x0.85; EPA+DHA x0.2; iron absorption penalty | [81][83] |
| Energy < 1,200 kcal (women) / < 1,500 kcal (men) | apply E* table above; force "add multivitamin" advice | [79][85] |

**Food quality / variety input (`food_quality` 1/2/3, default 2).** `QMULT` (PROPOSED): quality 3 = varied whole foods (>= 5 vegetable/fruit portions, legumes or wholegrains daily, nuts/seeds, fish or fortified alternatives) -> x1.35 on Mg, K, folate, vitamin C, A, K, fibre; x1.2 Ca, Zn; x1.5 D if fish, x1.5 E if nuts/seeds;
quality 1 = mostly refined/ultra-processed -> x0.8 on the same nutrients. Anchor: A TO Z Zone arm reduced inadequacy for A, E, K, C with nutrient-dense foods [79]; Hall's ultra-processed vs unprocessed diets were matched on presented fibre but differed in insoluble fibre share (16 % vs 77 %) [40].

**Supplements.** `multivitamin` = add 100 % of RDA of vitamins and ~ 30-50 % of Mg/Ca (NHANES adults taking an MVM >= 21 days/month: still 18.8 % below the Ca EAR and 19.3 % below the Mg EAR, but vitamin D 3.9 % vs 95.6 % in non-users) [85]; `vitD` = +20 ug (800 IU) (raises the D flag from red to green; effect on infections only in deficiency, [145]); `omega3` = g EPA+DHA; `iron`, `B12`, `iodine` as flagged.

**Iron and menstruating women (rule).** 9-11 % of US women 12-49 y are iron deficient (ferritin/transferrin saturation/protoporphyrin), 2-5 % anaemic [89]; premenopausal women are a main risk group [90]. RDA 18 mg/d premenopausal vs 8 mg men/post-menopausal, x1.8 for vegetarians (NIH-ODS, UNVERIFIED this session); menstrual loss ~30-40 mL blood/cycle (UNVERIFIED).
```
iron_risk = AMBER if menstruating AND (energy < 1,500 OR animal_level in {vegetarian, vegan} OR red-meat-free) AND no iron supplement/fortified cereal
          = RED   if the above AND (heavy periods flag OR endurance training >= 5 h/wk OR previously low ferritin)
```

**Functional consequences at a 2-6 month horizon (narrative + small modifiers only).**

| Deficit | When it can bite | Consequence and evidence | Modelled? |
|---|---|---|---|
| Iron (non-anaemic iron deficiency) | months (stores deplete slowly; UNVERIFIED) | Iron therapy lowers self-reported fatigue (SMD -0.38, 95 % CI -0.52 to -0.23; 4 trials, 714 people) but does not change VO2max (SMD 0.11) or timed exercise; Hb +4.0 g/L, ferritin up [88]; in women with unexplained fatigue 80 mg/d iron for 4 wk lowered fatigue 29 % vs 13 % on placebo, only in ferritin <= 50 ug/L [87] | small modifier on "energy/fatigue" score (dossier 19): -0.38 SD when RED flag persists > 8 wk |
| Vitamin B12 (vegan without supplement) | > 1 yr typical (liver stores; UNVERIFIED) | neuropathy, anaemia; intake far below need [82] | flag only |
| Thiamin | weeks if very low energy + carbohydrate + alcohol (UNVERIFIED) | fatigue, neuropathy; Wernicke risk; refeeding syndrome (coordinate 17) [79] | flag only |
| Vitamin C | ~10 mg/d prevents scurvy [95]; signs usually after >= 1-3 months at near-zero intake (Hodges; UNVERIFIED) | with near-zero fruit/vegetable and no fortified foods only; 46 % of adults below EAR without scurvy [84]; carnivore survey with 37 % no supplements reported few symptoms [20] | flag only |
| Vitamin D | months | food alone leaves 95 % below EAR [84]; supplementation cuts acute respiratory infection OR 0.88 (0.81-0.96), OR 0.30 if baseline 25-OH-D < 25 nmol/L [145]; no effect on fractures, falls or BMD in general adults [146] | flag; small infection modifier not simulated |
| Magnesium | months | 55 % below EAR [85]; magnesium supplements not shown to prevent cramps [151] | flag only |
| Iodine | 6 months (Paleo-type diet: moderate deficiency 15 -> 73 %) [80] | thyroid function (coordinate 12/16) | flag only |
| Essential fatty acids | months at near-zero fat; biochemical EFAD in TPN patients; weekly 500 mL 20 % lipid kept Holman index < 0.2 [94] | dermatitis; Holman index (triene:tetraene) > 0.2 | flag (fat < 15 g/d for > 4 wk) |
| Potassium, calcium, fibre | chronic | BP (06), bone (4.14/19) | flags |

**Rule table (implementable):**
```
E   = energy intake (kcal/d, EMA 7 d);  Q = food_quality;  A = animal_level;  c = carbohydrate g/d (EMA 7 d);  f = fat g/d
for n in nutrients: d_n = D_TYPICAL[n] * QMULT[Q][n] * PATTERN_MULT(n; c, f, A)
   intake_n = d_n*E/1000 + SUPP[n]
   R_n = intake_n / EAR_n(sex, age)                       // fibre: R = F / (14*E/1000); vit K, potassium: vs AI
   flag_n = RED if R_n < 0.75 ; AMBER if < 1.0 ; YELLOW if < 1.3 ; GREEN otherwise
add-on flags (independent of R):
   FAT_SOL_ABSORPTION  : RED if fat per meal < 5 g for most meals (very-low-fat) [91][93]
   EFA                 : AMBER if fat < 20 g/d ; RED if fat < 15 g/d for > 4 wk [94]
   B12                 : RED if animal_level == vegan and no B12 supplement/fortified
   IODINE              : AMBER if animal_level == vegan and no iodised salt/seaweed/supplement
   IRON                : as above
   FIBRE               : AMBER if F < 14 g/1000 kcal ; YELLOW if F < 25 g
   SODIUM/K/Mg         : per 4.7
overall_score = 100 - 6*#RED - 3*#AMBER   (UI only)
Default user (omnivore, Q=2, 2,000 kcal, no supplements): D and E RED/AMBER (as for 84-95 % of US adults), fibre AMBER, Mg YELLOW/AMBER -> keep tone informational ("typical of most diets").
```

**Evidence grade: C** for density-based projection (observational intake data, US, women-based), **D** for the pattern multipliers and quality multipliers; **A/B** for the individual facts cited in the anchor column.

---

### 4.10 Alcohol: how to model a drink

**Mechanism.** Ethanol has no storage pool and is oxidised in preference to other fuels. ~77 % of the ethanol cleared from plasma is converted in the liver to acetate that enters plasma; acetate raises fuel supply,
suppresses adipose lipolysis (plasma NEFA release -53 %) and cuts whole-body lipid oxidation by 73 % over 6 h after 24 g of alcohol; hepatic de novo lipogenesis accounts for < 5 % of the dose [97]. In a 24-h calorimeter,
adding 96 g/d ethanol (25 % of energy) lowered lipid oxidation by 49.4 g/d (-36 %) and substituting it isocalorically for fat/carbohydrate lowered it by 44.1 g/d (-31 %), with unchanged carbohydrate and protein oxidation, only during the daytime
hours when ethanol was being metabolised; 24-h EE rose 7 % (addition) or 4 % (substitution) [98]. Intravenous ethanol (21.8 g oxidised in 4 h) cut fat oxidation 79 %, protein oxidation 39 % and glucose disposal 36 % (insulin resistance) [100].
"Fat sparing" is therefore a *substrate-partitioning* effect: alcohol energy is fully counted; body fat rises only if total intake exceeds needs [101].

**Contested: is alcohol energy fully available?** Ethanol-induced thermogenesis was 22.5 % of ethanol energy with meals (17.1 % fasting) in 6 subjects -> ~80 % metabolisable [99]; diet-induced thermogenesis after a meal with 23 % of energy as ethanol was 27 % larger than after carbohydrate or fat meals (protein +17 %, n.s.; 19 subjects, 5 h) [104].
Against: 20 g ethanol had no effect on DIT [102]; alcohol's thermic effect was similar to carbohydrate with no evidence of futile cycling [101]; in 48 adults over 16 weeks, replacing carbohydrate with 5 % of energy as ethanol left total energy expenditure unchanged, i.e. equal efficiency [103].
Default: `TEF_alc = 0.10` (0.05-0.22).

**Appetite.** No compensation: in a meta-analysis of 22 studies (701 people, 18-37 y) an alcohol dose raised food energy intake by 343 kJ (+82 kcal; 95 % CI +38 to +125) and total energy by 1,072 kJ (+256 kcal; +196 to +316) vs a non-alcoholic comparator [105];
alcohol before/with meals tends to increase food intake by enhancing reward [106]; but a meal rich in ethanol did not change ad libitum intake in the next 5 h (n = 19) [104].

**Equations**
```
alc_g      = drinks * 14            // US standard drink 14 g [117]; UK unit 8 g; Australia 10 g (UNVERIFIED); 1 drink = 98 kcal (7 kcal/g)
ME_alc     = alc_g * 7 * (1 - TEF_alc)             // energy entering balance; TEF part booked to expenditure (dossier 02)
// clearance (zero-order, saturable at ~0.1 g/kg/h): population mean elimination 15 mg/100 mL/h, range 10-35 [113]
k_ox       = 0.10 g/kg/h (men) ; 0.085 g/kg/h (women)   // = 0.15 g/L/h x Widmark r 0.68 / 0.55 (Widmark r UNVERIFIED)
EtOH(t+dt) = EtOH(t) - min(EtOH(t), k_ox*BW*dt)       // queue; 14 g clears in ~1.75 h for an 80-kg man; 6 drinks in ~10 h
// fat-oxidation suppression while EtOH>0 (partitioning, not energy)
dFatOx_kcal(day) = - phi * min( 7*alc_g_oxidised_today , FatOx_base )      phi = 0.66 [98] (0.66-0.9 [97][100])
                                                                              i.e. ~ -4.6 kcal of fat oxidation per g ethanol (~ -0.5 g fat/g)
NEFA / lipolysis: x0.47 during the clearance window (Siler, 24 g) [97]
carbohydrate / protein oxidation: unchanged over 24 h [98]
// interactions
ketone production K_prod x (1 - 0.5*[EtOH>0]) (assumption, grade D); fasted > 16 h with low glycogen and >= 2 drinks -> hypoglycaemia warning (mechanism [116]; moderate-dose ketone data not retrieved)
passive intake (ad libitum / hunger module): +80 kcal food intake per drinking session (Kwok +82 kcal [105]) ; not applied to user-fixed kcal
```

**Muscle protein synthesis after training.** In 8 active men (resistance + concurrent cycling), 1.5 g/kg alcohol (12 +/- 2 standard drinks) in two doses 0 and 4 h post-exercise lowered myofibrillar MPS by 24 % when co-ingested with 25 g whey and by 37 % with carbohydrate, relative to whey alone
(MPS still rose 29-109 % above rest in all conditions; mTOR phosphorylation lower) [107].
```
MPS_mult (window: from training end until EtOH cleared, max 8 h) = 1 - 0.16*dose_gkg   (with >= 0.3 g/kg protein within 2 h)   floor -0.25
                                                    = 1 - 0.25*dose_gkg   (no protein)                                              floor -0.37
PROPOSED: linear through the origin from a single very high dose; no human dose-response below ~1 g/kg (grade C/D). Apply to dossier 03/09 MPS on the training day only.
```
**Hormones.** 40 g/d (men) or 30 g/d (women) of alcohol as beer with dinner for 3 wk, controlled diet: testosterone -6.8 % in men (95 % CI -1.0 to -12.5), no change in women; DHEAS +16.5 %; HDL-C +11.7 % [108]. Moderate doses: negligible for the simulator; acute high-dose data not retrieved. **Not modelled** (warning only).

**Sleep (coordinate 16).** Any dose shortens sleep latency and consolidates the first half (more slow-wave sleep), then disrupts the second half; REM reduced and delayed at moderate/high doses [109]. HRV-derived recovery state fell by 9.3, 24.0 and 39.2 percentage units after low (<= 0.25 g/kg), moderate (0.25-0.75) and high (> 0.75 g/kg) doses in 4,098 real-world subjects [110]
(0.25 g/kg ~ 1.4 drinks and 0.75 g/kg ~ 4.3 drinks for 80 kg).
```
recovery_penalty(next night) = 0.09 | 0.24 | 0.39 for dose_gkg <= 0.25 | <= 0.75 | > 0.75     // fraction of the HRV recovery scale; dossier 16 converts to sleep-quality multiplier
```
**Lipids and liver (dossier 06).** 30 g/d ethanol raised HDL-C +3.99 mg/dL, apoA-I +8.82 mg/dL and triglycerides +5.69 mg/dL (2.49-8.89) in a meta-analysis of 42 feeding studies (1-9 wk) [111].
Chronic heavy intake -> steatosis (no quantitative source retrieved; UNVERIFIED). Mortality risk rises above ~100 g/week (= 7 US drinks); hazard per additional 100 g/week: stroke 1.14 (1.10-1.17), heart failure 1.09 (1.03-1.15), fatal hypertensive disease 1.24 (1.15-1.33), 599,912 drinkers in 83 studies [112].

**Water/hydration.** Dilute alcohol (1-4 %) has little diuretic effect after exercise dehydration; 4 % delays plasma-volume recovery [114][115]. Not modelled.

**Input design.** `alcohol_drinks` per day (block/weekly patterns), `alcohol_pattern` in {with meal, evening, binge (>= 4 in 2 h)}. Warnings: > 7 drinks/week (100 g), > 3 drinks in a day, alcohol within 3 h before bed, alcohol on training day, alcohol while fasting > 16 h or VLED (hypoglycaemia; thiamin, dossier 17).
The Planner must default to zero alcohol and never prescribe it.

**Evidence grade:** B (fat-oxidation suppression: consistent small calorimetry/isotope studies), B (appetite meta-analysis, young adults), C (MPS: one small RCT with an extreme dose), C (TEF: contested), C (sleep quantification).

---

### 4.11 Caffeine (and green-tea catechins)

**Mechanism.** Adenosine-receptor antagonist; raises catecholamines, EE and lipolysis modestly; improves performance and vigilance; delays sleep and lowers sleep depth for hours (long half-life).
Pharmacokinetics: T_max 30-120 min; half-life typically 4-6 h (range 1.5-10 h in adults) [131]; metabolism (95 % by CYP1A2) varies with genotype, smoking, hormones, liver disease, obesity, diet [135].

```
C_caf(t) = C_caf(t-dt) * 2^(-dt/t_half) + dose(t)          t_half = 5.4 h (4-6 typical, 1.5-10 range [131]; dossier 16 adds x1.47 with combined oral contraceptive, x0.56 in smokers)
```
**Energy expenditure.** 100 mg raised RMR 3-4 % over 150 min in lean and post-obese volunteers; 100 mg every 2 h for 12 h (600 mg) raised daytime EE 8-11 % and 24-h EE by 150 kcal (lean) / 79 kcal (post-obese), no carry-over to the night [118].
Dose-dependent at 100/200/400 mg, related to plasma lactate and triglyceride rise [119]; 8 mg/kg (or coffee 4 mg/kg) raises metabolic rate, and fat oxidation only in lean subjects [120]. Chamber meta-analysis (6 studies, 18 conditions): caffeine-only +429 kJ (+4.8 %) 24-h EE, dose-response 0.44 kJ per mg (0.105 kcal/mg); catechin-caffeine mixture +428 kJ (+4.7 %) EE and +12.2 g/d (+16 %) fat oxidation (caffeine-only +9.5 g/d, +12.4 %, p = 0.11) [121].
During fasted exercise, acute caffeine (2-7 mg/kg; 19 crossover studies) raised the fat-oxidation rate (SMD 0.73, 95 % CI 0.19-1.27), needing > 3 mg/kg and working better in untrained people [125]; not modelled beyond the 24-h chamber figure. Weight trials are heterogeneous (13 RCTs, I2 91-94 %) [126]; effect on appetite is equivocal (caffeine 0.5-4 h before a meal may reduce acute intake; coffee 3-4.5 h before has minimal effect) [127].
```
dEE_day = kappa_c * (mg_today - mg_hab) * (1 - 0.5*Tol_caf)           kappa_c = 0.10 kcal/mg (0.05-0.25);  mg_hab = 150 mg (the level inside TDEE calibrations)
          e.g. 400 mg vs 150: +25 kcal/d (+12 kcal with full tolerance); 600 mg: +45 kcal/d.   Published upper bound +150 kcal/d at 600 mg in naive-to-moderate users [118].
Tol_caf : 0->1 with tau = 14 d of daily use >= 200 mg (Beaumont 28-d tolerance [134]); thermogenic tolerance itself unmeasured (grade D); Hursel: habitual caffeine > 300 mg/d non-significantly blunted the catechin effect (-0.27 vs -1.60 kg, p = 0.09) [122]
Conclusion: net EE effect <= 60 kcal/d for realistic intakes -> do NOT expose as a fat-loss lever; keep as a small modifier.
```
**Performance.** ISSN: 3-6 mg/kg ~60 min before exercise, minimum effective ~2 mg/kg, 9 mg/kg gives side effects without extra benefit [131]. Umbrella review of 21 meta-analyses: ergogenic for aerobic endurance, muscle strength, muscle endurance, power (moderate-quality evidence) [128];
endurance time-trial: time -2.22 +/- 2.59 % (ES 0.41), mean power +3.03 +/- 3.07 % (ES 0.23) at 3-6 mg/kg (46 studies) [129]; strength SMD 0.20 (0.03-0.36), power SMD 0.17 (0.00-0.34), upper-body only for strength [130].
```
perf_mult_endurance = 1 + 0.03 * min(1, (mg/kg)/3) * (1 - 0.6*Tol_perf)          // PROPOSED conversion; Tol_perf builds with tau 14-28 d in low-habitual users
perf_mult_strength  = 1 + 0.015 * min(1, (mg/kg)/3) * (1 - 0.6*Tol_perf)          // SMD 0.2 ~ 1.5-2% (conversion UNVERIFIED)
```
Tolerance: in 18 low-habitual consumers (< 75 mg/d), 4 weeks of 1.5-3 mg/kg/d removed the ergogenic benefit (external work 383 -> 358 kJ, vs placebo group unchanged) [134]; in habitual users benefits seem retained (mixed evidence) [131].

**Sleep interaction (coordinate 16).** Meta-analysis of 24 studies: caffeine reduced total sleep time by 45 min, sleep efficiency by 7 %, and increased sleep-onset latency by 9 min and wake-after-sleep-onset by 12 min; light sleep +6.1 min, deep sleep (N3+N4) -11.4 min. To avoid TST loss: coffee (107 mg per 250 mL) >= 8.8 h before bed, pre-workout (217.5 mg) >= 13.2 h before bed [132].
400 mg taken 6 h before habitual bedtime still disrupted objectively measured sleep [133].
```
A_bed = sum_i dose_i * 2^(-(t_bed - t_i)/t_half)                // residual body load at bedtime, t_half = 5.4 h
no-effect threshold R* ~ 37 mg: Gardiner's cut-offs leave 107 mg x 2^(-8.8/5.4) = 35 mg and 217.5 mg x 2^(-13.2/5.4) = 40 mg   (same fit as dossier 16)
TST_loss_min = min(120, 0.40 * max(0, A_bed - 37))            // OWNER: dossier 16 (slope chosen so a ~150 mg residual gives the pooled -45 min); 400 mg at 6 h before bed -> ~ -60 min
```
This module only supplies dose, clock time and `t_half` modifiers; the sleep equations live in dossier 16. Grade B (timing logic), C (slope).

**Green tea / catechins.** Meta-analysis (11 studies): catechins/EGCG-caffeine -1.31 kg (P < 0.001) on weight loss/maintenance, smaller with high habitual caffeine (-0.27 vs -1.60 kg) [122]; Cochrane (14 trials >= 12 wk): non-Japanese studies -0.04 kg (95 % CI -0.5 to 0.4), Japanese studies -0.2 to -3.5 kg heterogeneous [123].
Chamber trial (10 men): 90 mg EGCG + 50 mg caffeine three times daily raised 24-h EE 4 % (p < 0.01) and lowered RQ 0.88 -> 0.85, whereas 50 mg caffeine alone did nothing [124]. Verdict: treat as caffeine; no separate input; hepatotoxicity warning for high-dose extracts (EFSA ~800 mg EGCG/d, UNVERIFIED).

**Evidence grades:** B (EE: chamber studies, one meta-analysis of 6), A (performance, sleep), C (tolerance), C/D (green tea).

---

### 4.12 Creatine monohydrate

**Mechanism.** Creatine (~120 mmol/kg dry muscle, ceiling ~160 [138]) is taken up into muscle by a saturable transporter; supplementation raises intramuscular creatine/PCr by 20-40 % [138], increasing high-intensity capacity and training volume; it is osmotically active (extra intracellular water).
About 1-2 % of the muscle pool is degraded to creatinine daily, so the body needs ~1-3 g/d (half from diet/synthesis) [138]. 20-30 % of individuals show < 8 % increase (non-responders) [137].

**Kinetics (Hultman 1996, 31 men).** 20 g/d for 6 d -> muscle total creatine +~20 %; maintained with 2 g/d for 30 d; without maintenance it declined to baseline over ~30 d; 3 g/d reached the same ~20 % elevation in 28 d and is "likely as effective" long term [136].
ISSN: 0.3 g/kg/d (5 g x 4) for 5-7 d then 3-5 g/d [138].
```
x_target(D) = x_max * min(1, D/2.5)             // D = daily dose g; x_max = 0.20 (0.10-0.40; higher in low-baseline e.g. vegetarians, UNVERIFIED)
tau_up(D)   = clamp(30/D, 1.5, 15) d            // 20 g/d -> 1.5 d (95 % by ~5 d) ; 3 g/d -> 10 d (95 % by ~28 d)   PROPOSED FIT to [136]
tau_down    = 10 d                               // baseline by ~30 d after stopping [136]
dx/dt       = (x_target - x) / (x_target > x ? tau_up : tau_down)
responder   : x_max *= 0.25 for the 20-30 % non-responder phenotype (expose as a range, not a random draw)
```
**Water and scale weight.** 32 trained adults, 25 g/d x 7 d then 5 g/d x 21 d: muscle creatine and total body water rose during loading; body mass was +0.75 kg at day 7 (not significant) and significantly higher by day 28; extracellular/intracellular distribution unchanged [137].
ISSN: creatine loading produced fluid retention of about 0.5-1.0 L, proportional to the acute weight gain; weight gain is the only consistently reported side effect [138].
```
W_Cr = 0.9 kg * (x / x_max)        // range 0.5-1.5 kg;  appears with loading in ~1 wk, or ~4 wk at 3 g/d;  disappears ~30 d after stopping
```
**Lean mass and strength (with resistance training).**
| Meta-analysis | Population | Result |
|---|---|---|
| Desai 2024 [140] | 12 RCTs, adults < 50 y, RT +/- creatine | LBM +1.14 kg (0.69-1.59), fat mass -0.73 kg (-1.34 to -0.11), body fat -0.88 % (-1.66 to -0.11); "7 g/d or 0.3 g/kg" ~ +1 kg LBM; no effect of training status or carbohydrate co-ingestion |
| Chilibeck 2017 [139] | 22 RCTs, 721 adults aged 57-70 y, 7-52 wk | Lean tissue mass +1.37 kg (0.97-1.76); chest press SMD 0.35 (0.16-0.53); leg press SMD 0.24 (0.05-0.43) |
| Burke 2023 [141] | 10 RCTs, >= 6 wk, MRI/CT/ultrasound | Pooled SMD 0.11 (95 % CrI -0.02 to 0.25); muscle thickness +0.10-0.16 cm; slightly larger in young than old |
| Naddafha 2026 [142] | 7 RCTs, 608 postmenopausal women | LBM +0.37 kg (0.05-0.69), leg-press 1RM +7.5 kg (2.2-12.8), benefit with >= 5 g/d + RT, none with <= 3 g/d without RT; bone density unchanged |
Reconciliation (my synthesis, grade C): DXA "lean mass" gains of 1.1-1.4 kg contain ~0.5-1 kg of water (see above), while direct imaging shows a very small extra true hypertrophy (SMD 0.11, ~1-2 mm of muscle thickness). Model:
```
dLBM_DXA = W_Cr + m_true ;  m_true = 0.3 kg per 12 wk of resistance training * (x/x_max)   (0 - 0.6)
hypertrophy_rate_mult (dossier 09) = 1 + 0.05*(x/x_max)                                   (0 - 10 %)
strength: RT-trained users +SMD 0.24-0.35 on 1RM vs placebo (~ +3 to +8 % 1RM; conversion UNVERIFIED) scaled by x/x_max
```
**Safety.** Up to 30 g/d for 5 years was well tolerated in healthy people; dosages 0.3-0.8 g/kg/d for up to 5 years without adverse effects in healthy and clinical groups [138]. Serum creatinine rises modestly without loss of GFR (interpretation caveat, UNVERIFIED); recommend physician advice in kidney disease.
**Evidence grade:** A (strength and LBM effects), B (time course), C (water vs tissue partition and dose translation).

---

### 4.13 Other supplements (brief)

| Supplement | Verdict | Quantitative note | Grade |
|---|---|---|---|
| Omega-3 (EPA+DHA) | Useful for high triglycerides / CV risk | 4 g/d lowers triglycerides >= 30 % in very high TG (>= 500 mg/dL), LDL may rise with EPA+DHA [143]; meta-analysis of 40 trials (135,267 people): MI RR 0.87 (0.80-0.96), CHD events 0.90 (0.84-0.97), dose-dependent [144] | A (TG), A/B (CV) |
| Vitamin D | Only if deficient | Respiratory infections OR 0.88 (0.81-0.96), 0.30 if baseline < 25 nmol/L [145]; no effect on fractures RR 1.00 (0.93-1.07), hip fracture 1.11, falls 0.97 in 81 RCTs [146] | A |
| Protein powder | Just protein | count as protein (dossier 03) | - |
| Electrolytes (Na) | During heavy sweating or keto transition | 0.23-1.6 g Na per litre sweat; see 4.7 | C/D |
| MCT (C8/C10) | Small effect | vs LCT: body weight -0.51 kg (-0.80 to -0.23), waist -1.46 cm, visceral fat SMD -0.55 (13 trials, 749 people, > 3 wk; commercial bias noted); blood lipids unchanged [147] | B/C |
| Isolated viscous fibre (psyllium etc.) | Small effect | -0.81 kg inside calorie restriction [25]; -2.52 kg without restriction (very heterogeneous) [24] | B |
| Creatine, caffeine | see above | | A/B |
| BCAA | No benefit when protein adequate | No study shows oral BCAA alone stimulates MPS; IV BCAA lowered MPS and breakdown [148] | B (negative) |
| "Fat burners", thermogenic stimulants | No | Most supplements < 2 kg; stimulants carry adverse effects [149] | B (negative) |
| Exogenous ketones | No proven benefit for weight or performance | Ketone ester peaks 2.8 mM vs salts 1.0 mM, returns to baseline in 3-4 h, lowers glucose/FFA/TG; food lowers peak 33 % [150] | C |
| Green tea extract | ~0 | 4.11 | B (negative) |
| Magnesium for cramps | Not shown to help | Cochrane [151] | A (negative; details UNVERIFIED) |

---

### 4.14 Calcium, vitamin D and protein for bone during weight loss (coordinate 19); iron in women (see 4.9)

- Diet-induced weight loss (41 publications) lowers total-hip BMD by 0.010-0.015 g/cm2 at 6, 12, 24 mo (about 1-1.5 %), not lumbar spine or whole body (except total body -0.011 g/cm2 at 6 mo); bone-resorption markers rise at 2-3 mo (osteocalcin +0.26 nmol/L, CTX +4.72 nmol/L) [152].
- In obese older adults (>= 65 y, 1 y, ~10 % weight loss) hip BMD fell ~3 % with diet only vs ~1 % with diet + exercise; lean mass -5 % vs -3 % [153].
- Higher protein: lumbar-spine BMD +0.52 % (0.06-0.97), no change at hip/femoral neck/total body, no adverse effect (5 RCTs) [154]. Vitamin D supplements do not change fractures/falls/BMD in general adults [146].
- Rules: warn if calcium intake projection R < 1 (4.9), energy deficit > 25 % for > 12 wk, or low resistance-training load; "hip BMD -1 to -1.5 % over 6-24 mo" as an output range for dossier 19.
**Grade:** A for the weight-loss BMD effect (meta-analysis), B for exercise/protein mitigation.

### 4.15 Non-nutritive sweeteners (brief)

RCT meta-analysis (Rogers 2016): low-energy sweeteners vs sugar-sweetened food/drink cut energy intake by 94 kcal (-122 to -66) in short-term trials, no difference vs water (-2 kcal); sustained RCTs (4 wk-40 mo) reduced weight -1.35 kg (-2.28 to -0.42) vs sugar and -1.24 kg (-2.22 to -0.26) vs water (3 comparisons) [155].
Network meta-analysis (17 RCTs, 1,733 adults): replacing sugar-sweetened beverages with low-/no-calorie sweetened beverages -1.06 kg (-1.71 to -0.41), BMI -0.32, body fat -0.60 %; no effect vs water [156]. A 2017 meta-analysis found no significant BMI effect in RCTs (-0.37 kg/m2, -1.10 to 0.36) but positive associations in cohorts (likely reverse causation/confounding) [157].
Glycaemia/insulin: 28 clinical trials contradictory [158]; a 2-week RCT (n = 120) showed person-specific microbiome-dependent glycaemic impairment with saccharin and sucralose (not aspartame/stevia in the tested dose) [159]. **Decision:** treat as zero-kcal foods; the weight benefit is the displaced sugar energy; add a one-line note; no state. Grade B (weight), C (glycaemia).

### 4.16 Water intake and weight loss (brief)

500 mL of water 30 min before meals: acute meal energy -13 % (574 -> 500 kcal) in 24 obese adults aged 61 [76]; 12 wk with 500 mL before each main meal added to a hypocaloric diet gave ~2 kg more weight loss (n = 48, 55-75 y; test-meal reduction 498 vs 541 kcal at baseline, 480 vs 506 kcal at week 12, p = 0.07) [74];
in 84 adults with obesity: -1.3 kg (-2.4 to -0.1) at 12 wk [75]. No thermogenic effect of water (drinking 518 mL distilled water or 0.9 % saline raised EE 0 %; cold water +4.5 % over 60 min, less than the heat needed to warm it) [77].
Decision: behavioural tip only (c); if a user selects "pre-meal water", reduce spontaneous meal intake by 8 % (range 5-13 %) in the hunger module (grade C, older/overweight populations).

---

### 4.17 Engine wiring: daily step order for this module

```
step15(day d, state, inputs, ctx):
 1  INTAKE-SIDE ENERGY:  E_label from macros;  F_eff <- EMA(fibre_g excluding nut & supplement fibre, tau_F=3 d)
                          dME = dME_fibre + dME_nut + dME_supp + [ - alcohol TEF handled below ]           -> ME_adj (kcal/d) to dossier 01
                          extra expenditure: alcohol TEF (0.10*7*alc_g) + caffeine dEE + optional fibre thermic add-on  -> dossier 02
 2  GUT:                  S_stool = 38 + 4*F_eff ; W_gut,fibre ; SCFA_idx, BUT_idx (c = carbohydrate 7-d EMA)          -> outputs
 3  WATER:                I_Na, L_sweat, L_ket -> I_lag -> W_Na ; H_def ; creatine x, W_Cr                            -> sums into dossier 13
 4  ALCOHOL:              EtOH queue -> dFatOx (dossier 05), NEFA x0.47 (05), MPS_mult (03/09), recovery_penalty (16), passive intake (12)
 5  CAFFEINE:             C_caf, A_bed -> dTST (16); perf_mult (09/19); dEE (02)
 6  MICRONUTRIENTS:       flags from 7-d EMA of E, carbohydrate, fat + selectors                                        -> outputs, small fatigue modifier (19)
 7  APPETITE:             M_UPF, M_ED, fibre satiety, alcohol passive intake, water preload                              -> dossier 12 (only ad-libitum / adherence; never overrides user kcal)
```
All state updates are deterministic first-order filters, so days can be batched into weeks without numerical issues (all time constants >= 0.5 d; use exact exponential update `x <- x*exp(-dt/tau) + target*(1-exp(-dt/tau))`).

---

## 5. Interactions with other subsystems

| With | This module needs | This module gives |
|---|---|---|
| 01 / 02 energy balance & expenditure | E_label, sex, BW | ME_adj (fibre: ~-2 to -4 % of intake for high-fibre whole-food diets when fibre is credited 2 kcal/g; nuts -5 to -25 % of nut kcal); engine intake convention `E_eng = 4P + 9Fat + 4(C - fibre) + 2 fibre + 7 alcohol` (matches 02), alcohol TEF and energy, caffeine EE (+10-60 kcal/d), optional fibre RMR (+0-43 kcal/d); note Dicken: self-reported vs body-composition-derived energy differ 2x |
| 03 protein / MPS | training-day flag, protein timing | MPS multiplier after alcohol (-24 to -37 % at 1.5 g/kg); protein powder = protein only |
| 04 carbohydrate / glycogen | glycogen state, carbohydrate g | W_gut,fibre; SCFA/butyrate vs carbohydrate; viscous fibre -> GI/glycaemia; glycogen water 3-4 g/g, K 0.45 mmol/g (owned by 04); net carbs = carbohydrate - fibre |
| 05 fat oxidation / ketosis | ketone state K_nat | natriuresis L_ket; alcohol suppresses fat oxidation (-66 % of ethanol kcal) and lipolysis (-53 %); MCT small ketone add (05) |
| 06 lipids & BP | viscous fibre g, alcohol g, sodium & potassium | LDL: -0.057 mmol/L per g soluble fibre (2-10 g), beta-glucan >= 3 g -0.25 mmol/L; alcohol HDL +3.99 / TG +5.69 mg/dL per 30 g/d; sodium: SBP +3 mmHg for +150 mmol/d [163]; omega-3 TG effect |
| 07 fasting / timing | eating window, fasting hours | alcohol-fasting hypoglycaemia warning; fluid & hyponatraemia rules in fasts; caffeine timing relative to window |
| 09 / 10 training | sweat L/h, session time | hydration deficit and performance multipliers; caffeine ergogenic multiplier; creatine LBM/strength |
| 12 hormones & appetite | hunger state, deficit size | spontaneous-intake multipliers (UPF, energy density, fibre, alcohol, water preload); craving-control penalty; iodine/iron -> thyroid/fatigue flags |
| 13 transitions / water transients | glycogen water, refeed timing | W_Na, W_Cr, W_gut,fibre, H_def, natriuresis timing; sodium retention after carbohydrate refeed |
| 14 anthropometrics | TBW (Watson [62]), BMI | BMI moderator on sodium response; scale-noise SD 0.5 kg |
| 16 sleep / cycle / age | bedtime, sex, menstruation | caffeine residual and alcohol recovery penalty; iron flag for menstruating women; cycle water is 16's |
| 17 safety | - | list in section 9 |
| 19 performance / bone | - | caffeine/creatine/hydration multipliers; hip BMD range on weight loss; iron-fatigue modifier |

### 5.1 Reconciliation with parallel dossiers (read before merging)

| Topic | Other dossier says | This dossier says | Recommendation |
|---|---|---|---|
| Fibre energy | 02: fibre credited ME 2.0 kcal/g (`E_fib`), optional fibre TEF 0.30 of that energy (0.6 kcal/g) | Faecal energy +5.0 kcal/g; net ME correction 2.8 kcal/g at a 2 kcal/g credit; optional fibre RMR add-on +2.3 kcal/g (Karl, not robust) | Keep 02's `E_fib = 2.0`; apply this module's `dME_fibre`; keep only ONE fibre thermic term (02's 0.6 kcal/g by default; set this module's `dTEE_fibre = 0`) |
| Sodium steps / natriuresis / gut mass | 13: `S_na` (tau_Na 1 d, habituation 5 d, no steady-state change), `E_cna` (E_max 0.6 L), `M_gut` (stool x transit) | New 7-day crossover evidence of persistent +1.4 kg for +150 mmol/d; partial habituation; `L_ket` and `W_gut,fibre` are stand-alone fallbacks | 13 owns the states; adopt partial habituation `h = 0.5` and `tau_Na = 1.5 d`; set `A_nat = 0` and `W_gut,fibre = 0` here when 13 is active |
| Caffeine energy expenditure | 02: `dEE = 0.25 kcal/mg x min(mg, 600)` (lean; 0.13 post-obese), no habitual offset | Pooled chamber slope 0.105 kcal/mg (Hursel 2011, 6 studies); Dulloo's 0.25 is the single-study upper bound; TDEE equations already contain habitual intake | Suggest 02 adopt `0.10-0.15 kcal/mg x (mg - 150)` with tolerance; if 02 keeps 0.25 it should cap at +150 kcal/d and treat it as an upper bound |
| Alcohol thermic effect | 02: `TEF_alc = 0.20` (Suter), noting Weststrate and FAO NME/ME 6.3/7.0 | Contested: 0.05-0.22; FAO NME 6.3 kcal/g = 10 % | Use 0.10 as default (matches the FAO 6.3/7.0 figure quoted in 02), 0.20 as the upper band |
| Caffeine and sleep | 16: `t_half` 5.4 h (x1.47 combined OC, x0.56 smoker), R* ~ 37 mg, `TSTloss = 0.40 min/mg above R*` | Same anchors (Gardiner 2023 cut-offs 8.8 h / 13.2 h) | 16 owns the equations; 15 supplies dose/time only; numerical caffeine safety limits are in section 9 |
| Alcohol and sleep / HRV | 16: REM disruption at <= 0.5 g/kg (Gardiner 2025), `sleepQualityScore` term; 19: alcohol-HRV "UNVERIFIED, do not model" | Pietila 2018 (n = 4,098): HRV-derived recovery -9.3 / -24.0 / -39.2 percentage units at <= 0.25 / 0.25-0.75 / > 0.75 g/kg [110] | Use as the dose-response for the alcohol term in 16's score |
| Alcohol and testosterone | 12 lists alcohol -> testosterone | Sierksma 2004: 40 g/d for 3 wk -> -6.8 % (95 % CI -1.0 to -12.5) in men, none in women [108] | Apply linearly with dose (0 at 0 g/d), men only |
| Alcohol and MPS / hypertrophy | 09 has an `f_alcohol` hand-off (default 1) | `MPS_mult = 1 - 0.16 x g/kg` (with protein), floor -0.25, training day only (4.10) | Use as `f_alcohol` for the 8 h after the session |
| Hydration and performance | 19: `M_acute` includes hydration >= 2 % BM | 4.8 thresholds | Use `perf_mult_endurance_fixed` (4.8) for fixed-intensity tasks only |

---

## 6. Output metrics for the UI

| Metric | Unit | Good direction | How to compute | Grade |
|---|---|---|---|---|
| Absorbed-energy correction vs label | kcal/d | context (neutral) | `dME_fibre + dME_nut + dME_supp` (4.2) | B |
| Fibre adequacy | % of 14 g/1000 kcal; g vs 25-29 g | up to ~35-40 g | `F_eff / (14*E/1000)` | A (target), B (effect) |
| Stool output | g/d | 100-200 (context) | `38 + 4*F_eff` | A |
| Colonic fermentation index / butyrate index | 1 = typical | up | `SCFA_idx`, `BUT_idx` (4.4) | C |
| Sodium-related water | kg | neutral | `W_Na` | C |
| Total water weight (incl. glycogen, creatine, gut, hydration, cycle) | kg | neutral (explains scale noise) | sum in 4.7 | C |
| Hydration status | kg deficit | 0 | `H_def` | D |
| Daily fluid target | L/d | - | `need_fluid_L` (4.8) | A/D |
| Ultra-processed effect on intake | kcal/d (ad libitum) | down | `E_spont * (M_UPF - 1)` | B |
| Craving control | CoEQ points | up | baseline + penalty (4.6) | B (one trial) |
| Alcohol: clearance time, fat-oxidation suppressed, weekly grams | h, kcal or g, g/wk | down | 4.10; weekly vs 100 g threshold | B |
| Alcohol: MPS penalty, next-night recovery penalty | %, fraction | down | 4.10 | C |
| Caffeine: residual at bedtime, last-dose cut-off | mg, clock | residual < 30 mg | 4.11 | A |
| Caffeine EE add-on | kcal/d | (small) | 4.11 | B |
| Creatine saturation, creatine water, expected LBM/strength delta | % of x_max, kg, kg/% | up | 4.12 | A/B |
| Micronutrient flags, probability of inadequacy, completeness score | traffic light, %, 0-100 | green / low / high | 4.9 rule table | C/D |
| Iron-fatigue flag | flag | none | 4.9 | B (effect), D (rule) |
| Hip BMD change during weight loss | % (range) | small | 4.14 (dossier 19) | A |

Planner goals that should be exposed from this dossier: "minimise scale-weight volatility" (sodium, glycogen, alcohol), "keep micronutrient flags green", "sleep-protective caffeine schedule". Everything else here is a modifier, not a goal.

---

## 7. Validation targets (engine should reproduce within the stated tolerance)

| # | Source | Conditions in | Outcome out | Tolerance |
|---|---|---|---|---|
| V1 | Karl 2017 [2] | 81 adults, 6 wk, weight-maintenance; fibre 21 -> 40 g/d at ~2,550 kcal (whole grain vs refined) | Faecal energy +96 kcal/d (18 SE); stool +76 g/d; combined with RMR +43 -> net 92 kcal/d (CI 28-156) | faecal energy +60 to +130 kcal/d; `dME` (c_f = 2) -30 to -90 kcal/d (+ optional RMR up to +43); stool +45 to +105 g/d |
| V2 | Corbin 2023 [1] | 17 young adults, ward, ~2,000 kcal, matched ME; MBD vs Western diet | ME 89.5 % vs 95.4 %: -116 +/- 56 kcal/d; no change in EE/hunger/intake | faecal energy +60 to +170 kcal/d for a 20-25 g fibre difference (model 5 kcal/g x 20-25 g = 100-125; fibre values UNVERIFIED) |
| V3 | Novotny 2012 [33] | 18 adults, 84 g/d whole raw almonds (~510 label kcal) | Measured 4.6 kcal/g vs 6.0-6.1 (Atwater overestimates measured ME by 32 %, i.e. 24 % below label) | dME_nut = -120 to -140 kcal/d |
| V4 | Hall 2019 [40] | 20 adults, ward, ad libitum, ultra-processed (83 % energy) vs unprocessed (0 %) for 2 wk each | Intake +508 +/- 106 kcal/d; weight +0.9 vs -0.9 kg; fat mass +0.4 vs -0.3 kg; no hunger-VAS difference | ad-lib model gives +300 to +650 kcal/d; observed weight difference 1.8 kg over 14 d (a fat-only conversion of 508 kcal/d x 14 d is ~0.9 kg; the rest is glycogen/water/lean mass, dossier 01) |
| V5 | Dicken 2025 [42] | 50 adults, 8 wk ad libitum, MPF vs UPF (both Eatwell-Guide-compliant) | Weight -2.06 % vs -1.05 %; fat mass -1.59 vs -0.61 kg; body-composition-derived deficit -290 vs -120 kcal/d | difference in weight -0.5 to -1.5 % |
| V6 | Visser 2009 / van den Bosch 2021 / Krikken 2012 [162][163][164] | 70-78 healthy men, 7 d at 50 vs 7 d at 200 mmol Na/d | Body weight 79.2 vs 80.6 kg (+1.4 kg); ECFV +0.9-1.2 L; plasma Na +2 mmol/L | +0.5 to +1.6 kg for +150 mmol/d after 7 d (default kappa gives +0.9) |
| V7 | Hall 2016 [58] | 17 men, 2,400 kcal, carbohydrate 300 -> 31 g/d (Na 2.7 -> 4.9 g/d) | additional -1.6 +/- 0.2 kg (water) after switch; fat -0.2 kg / 15 d | joint test with dossiers 04/13: total -1.0 to -2.2 kg. Diagnostic: with default parameters the sodium module contributes about +0.2 to +0.5 kg (higher intake outweighs natriuresis); if the joint model overshoots, lower kappa to 0.003 or raise A_nat to 100 mmol/d |
| V8 | Yang & Van Itallie 1976 [56] | 800 kcal ketogenic vs mixed, 10 d | loss 467 vs 278 g/d; water 61 % vs 37 % | water fraction 50-70 % of loss on ketogenic |
| V9 | Siler 1999 [97] | 8 men, 24 g ethanol | lipid oxidation -73 %; NEFA release -53 %; DNL < 5 % of dose | fat oxidation -60 to -85 % during clearance |
| V10 | Suter 1992 [98] | 8 men, 96 g/d ethanol added (25 % of energy) | 24-h fat oxidation -49.4 g (-36 %), EE +7 %; substitution: -44.1 g (-31 %), +4 % | dFatOx -400 to -480 kcal/d at 96 g; EE +4-7 % |
| V11 | Parr 2014 [107] | 8 men, RT + cycling, 1.5 g/kg alcohol | MPS -24 % (with whey) / -37 % (with carbohydrate) vs whey | -15 to -30 % / -30 to -45 % |
| V12 | Dulloo 1989 [118]; Hursel 2011 [121] | 100 mg caffeine x 6 over 12 h (600 mg) in lean volunteers; chamber meta-analysis | 24-h EE +150 kcal (lean), +79 (post-obese); pooled +429 kJ (+4.8 %); slope 0.44 kJ/mg | for a caffeine-naive user (Tol = 0, mg_hab = 0), 600 mg gives +60 kcal by default: accept 50-170 kcal (default sits at the low end on purpose) |
| V13 | Gardiner 2023 [132] | coffee 107 mg / pre-workout 217.5 mg | last-dose cut-offs 8.8 h / 13.2 h before bed | A_bed at t_half = 5.4 h = 35 / 40 mg (threshold R* ~ 37 mg); TST_loss ~ 0 at these times |
| V14 | Hultman 1996 [136] | creatine 20 g/d x 6 d; 3 g/d x 28 d; stop | muscle total creatine +~20 %; +~20 %; baseline by ~30 d | x(6 d) = 0.19-0.20; x(28 d, 3 g) = 0.19; x(30 d after stopping) < 0.02 |
| V15 | Powers 2003 [137] | 25 g/d x 7 d then 5 g/d x 21 d, 32 adults | body mass +0.75 kg at d 7 (n.s.), higher by d 28 (> 0.88 kg); TBW up | W_Cr(7 d) 0.5-1.0 kg; W_Cr(28 d) 0.7-1.2 kg |
| V16 | Desai 2024 [140]; Burke 2023 [141] | RT +/- creatine 7 g/d | LBM +1.14 kg (0.69-1.59), fat -0.73 kg; imaging SMD 0.11 | dLBM_DXA over 12 wk 0.7-1.6 kg of which water 0.5-1.0 |
| V17 | Gardner 2010 (A TO Z) [79] | Atkins (carbohydrate 17 %, 1,373 kcal), LEARN (49 %, 1,478 kcal), Ornish (63 % carbohydrate, 21 % fat, 1,412 kcal), Zone (42 %, 1,469 kcal) | new inadequacy for: Atkins - thiamin, folate, C, iron, Mg; LEARN - E, thiamin, Mg; Ornish - E, B12, Zn; Zone - none (A, E, K, C improved) | rule engine at Q=2 should raise amber/red on >= 60 % of those nutrient/arm pairs and none new in the Zone arm |
| V18 | Verdon 2003 [87]; Houston 2018 [88] | non-anaemic iron-deficient women, iron 4 wk | fatigue -29 % vs -13 %; pooled SMD -0.38 | RED iron flag -> -0.3 to -0.4 SD "energy" score |
| V19 | Cheuvront 2004 [69] | 65 active men, daily first-morning mass | day-to-day SD 0.51 +/- 0.20 kg (CV 0.66 %) | scale-noise SD 0.4-0.7 kg |
| V20 | Cummings 1992 [9] | pooled controlled diets, NSP 4-32 g/d | stool = 38 + 5.3 x NSP (n = 206) | slope within 3.5-5.5 g/g AOAC fibre |

---

## 8. Myths / contested claims

1. **"Alcohol calories don't count / are wasted."** False at moderate intakes: substituting 5 % of energy as ethanol for carbohydrate left energy expenditure unchanged over 16 weeks [103]; thermic effect similar to carbohydrate with no futile cycling [101]. (A 20 % thermic effect was reported in one study [99]; contested.)
2. **"Alcohol is converted to body fat."** Hepatic DNL took < 5 % of a 24-g dose; the effect is fat-oxidation suppression plus extra eating [97][105].
3. **"A calorie is a calorie" (label kcal).** Whole raw almonds deliver ~24-27 % fewer kcal than labelled (Atwater overestimates measured ME by 32 %), walnuts 21 %, cashews 16 %; ground almonds/almond butter ~0 % [33]-[37]; high-fibre whole-food diets deliver ~2-4 % less than labels that credit fibre 2 kcal/g (Atwater-type systems overestimated ME by up to 4 % on refined and up to 11 % on low-fat high-fibre diets) [1][2][3]. Fibre is not 0 kcal *and* not 4 kcal: relative to a 2 kcal/g credit, whole-food fibre still over-credits ~2.8 kcal per gram (net effect of an extra gram at constant digestible energy is about -0.8 kcal) [2].
4. **"Ultra-processed food is just about calories/macros."** In two matched-macro trials people ate ~500-800 kcal/d more with unchanged hunger ratings [40][41]; even "healthy" reformulated UPF produced half the weight loss [42]. Self-reported intake exaggerated the difference ~2x [42].
5. **"Salt makes you gain water weight permanently."** Transient and modest for most people: ~+0.9 kg for +150 mmol Na/d after a week in healthy men [162][163], ~0 in a controlled ward study [47]; reversible within days.
6. **"Low-carb weight loss is fat."** First-week loss is mostly water: 61 % of loss on an 800-kcal ketogenic diet vs 37 % on an isocaloric mixed diet [56]; -1.6 kg in a week at constant 2,400 kcal with only -0.2 kg fat [58].
7. **"Salt/electrolytes fix keto flu."** Plausible (natriuresis is real [53][54]) but no controlled trial; do not present as proven.
8. **"Water boosts metabolism / flushes fat."** 518 mL of water at room temperature did not raise EE [77]; pre-meal water reduces the next meal by ~8-13 % in older/overweight adults and adds ~1-2 kg over 12 weeks [74][75][76].
9. **"Green tea burns fat."** Cochrane: -0.04 kg outside Japan [123]; the EE effect is essentially the caffeine [121][124].
10. **"Caffeine tolerance means no benefit."** Low-habitual users lose the ergogenic effect after 4 weeks [134]; habitual users generally keep some benefit [131]; sleep effects persist regardless of habit (dose-timing rule).
11. **"Creatine is just water."** Partly: +0.5-1.0 kg water, but also +1.1-1.4 kg lean mass and small strength gains in RCTs [139][140]; direct imaging shows only a very small extra hypertrophy (SMD 0.11) [141].
12. **"BCAAs build muscle."** No oral-BCAA-alone MPS data; IV BCAA lowered MPS [148].
13. **"Artificial sweeteners raise insulin and make you fat."** RCTs show weight equal or lower when they replace sugar [155][156]; cohort associations are confounded [157]; person-specific glycaemic impairments with saccharin/sucralose were shown in one 2-week RCT [159].
14. **"Zero fibre = constipation."** In self-selected constipated patients, stopping fibre improved bowel frequency [15]; but butyrate and fibre-derived phenolics fall [16][17] and long-term consequences are unknown.
15. **"Diverse microbiome = high fibre."** A 17-week high-fibre diet changed glycan-degrading enzymes but not diversity; fermented foods raised diversity [19].
16. **"Everyone needs 3-4 L of water."** Mean turnover 2.7-4.3 L/d includes food and metabolic water; predicted by size, activity, climate, humidity, altitude [61]; "8 glasses" has no objective support [61].
17. **"Calorie-restricted diets are automatically deficient."** Only if food quality is poor; typical-density diets fall short in Mg/Ca below ~1,700 kcal, but nutrient-dense choices and an MVM close most gaps [79][85][96].

---

## 9. Safety bounds relevant to this topic

- **Energy/micronutrients:** flag any plan < 1,200 kcal (women) / 1,500 kcal (men) as "needs multivitamin + calcium/vitamin D review"; < 800 kcal/d (VLED) requires supervision, electrolytes and thiamin (dossier 17; refeeding risk). Do not let the Planner select a regimen with RED flags on B12, iron (menstruating), EFA or fat-soluble-vitamin absorption without a supplement recommendation.
- **Sodium/fluids:** warn at sodium < 1.5 g/d (AI) for > 2 wk (orthostatic hypotension seen in a natriuretic protein-sparing protocol [53]) and at > 5 g/d in hypertension; warn at fluid > 3 L/d during fasting/VLED and > ~1 L/h during exercise (approximate maximal renal water excretion, UNVERIFIED); potassium supplements only with medical advice (ACE-inhibitor interaction UNVERIFIED). No sodium/fluid "loading" strategies.
- **Alcohol:** planner default 0; warn > 7 drinks (100 g)/week [112], > 3 in a day, binge (>= 4 in 2 h), within 3 h of bed, after training, during fasting > 16 h/VLED (hypoglycaemia [116]) and with any thiamin-poor intake. Never simulate alcohol as a calorie-neutral or "fat-loss" tool.
- **Caffeine:** residual body load at bedtime < 30 mg; single dose <= 3 mg/kg (ISSN range 3-6 mg/kg; 9 mg/kg gives side effects [131]); daily total warn > 400 mg (EFSA; UNVERIFIED this session) and lower in pregnancy (200 mg; UNVERIFIED).
- **Creatine:** 3-5 g/d is well tolerated; long-term use up to 0.8 g/kg/d has been studied [138]; advise physician input in kidney disease (serum creatinine interpretation) - UNVERIFIED nuance.
- **Fibre:** ramp <= +10 g/d per week; > 50 g/d flagged; isolated fibres have specific ceilings (3.75-25 g/d) [22].
- **Iron supplements:** do not recommend routinely to men/post-menopausal women; ferritin testing first (iron overload risk; UNVERIFIED).
- **Green-tea extract / thermogenic "fat burners":** discourage; stimulants have more adverse effects than benefit [149].

---

## 10. Open questions / weakest assumptions

1. **Linear fibre slope** (faecal energy +5.0 kcal/g; net ME correction 2.8 kcal/g at a 2 kcal/g credit) is fitted to one 2-arm study (21 vs 40 g) and consistent with one ward study whose fibre intake I could not verify; the label-credit convention `c_f` changes the correction by 1 kcal per 1 kcal/g of credit; extrapolation to 60+ g/d, isolated fibres, or fibre swaps within low-carbohydrate diets is untested. Adaptation time of the microbial community (weeks?) is unmeasured for energy.
2. **Label-credit convention `c_f`.** Whether typed kcal credit fibre at 0, 2 or 4 kcal/g shifts the net ME correction between 0.8, 2.8 and 4.8 kcal per gram of fibre; the engine adopts 2.0 (as dossier 02) and recomputes kcal from macros, but user-entered label kcal may differ; the assumption that Karl's/Corbin's diets were designed at c_f ~ 2 is inferred from the authors' fibre-adjustment, not stated.
3. **Sodium-water coefficient** `kappa`: 0.009 (Visser/Krikken, n = 70-78) vs ~0 (Heer, n = 32) - contradictory well-controlled datasets; both differ from the "sodium reservoir" story. The natriuresis parameters (50 mmol/d, tau 5 d) rest on a single 1980 study and mechanism papers.
4. **UPF multiplier** `gamma_u`: self-reported intake vs body-composition-derived energy differ 2x; three RCTs with different populations and UPF definitions; long-term persistence beyond 8 weeks unknown; hunger scores do not change, so the mechanism (eating rate, energy density, palatability, texture) is not separable.
5. **Micronutrient densities** derive from 291 US women with 24-h recalls; EAR values (except D, E, A, C, Zn) not re-verified this session; pattern and quality multipliers are expert-style scalings anchored to direction-of-effect only; time-to-deficiency numbers are largely UNVERIFIED.
6. **Alcohol:** TEF (5-22 %) contested; MPS effect from one small RCT at ~12 drinks; dose-response for typical intakes, and effects on ketone levels in ketogenic dieters, not retrieved.
7. **Caffeine:** EE dose-response inconsistent (0.105 kcal/mg meta-analytic slope vs 0.25 kcal/mg in the 600-mg Dulloo study); thermogenic tolerance unmeasured; sleep dose-response shape is my interpolation.
8. **Creatine:** water vs tissue partition of DXA lean mass; whether women/older adults follow the same kinetics; non-responder phenotype prevalence (20-30 %, from a secondary quote).
9. **Hydration state parameters** (`f_kidney`, `tau_H`) are placeholders; the water-turnover equation predicts population means (R2 = 0.47), not individual needs.
10. **Cooking/raw and food-matrix effects beyond nuts** (starch gelatinisation, protein denaturation, cold-chain RS) are not quantified in human trials I found.
11. Several primary sources (NIH-ODS iron/magnesium, NASEM DRI tables, EFSA caffeine opinion, Dietary Guidelines PDF, Heer 2000 full text) were unreachable; statements marked UNVERIFIED should be re-checked before release.

---

## 11. References
(PMIDs verified through Europe PMC metadata at compile time; "accessed via WebFetch" entries are web pages.)

1. Corbin KD, Carnero EA, Dirks B, et al.. Host-diet-gut microbiome interactions influence human energy balance: a randomized clinical trial. Nature communications 2023;14:3161. PMID 37258525. DOI 10.1038/s41467-023-38778-x. https://pubmed.ncbi.nlm.nih.gov/37258525/
2. Karl JP, Meydani M, Barnett JB, et al.. Substituting whole grains for refined grains in a 6-wk randomized trial favorably affects energy-balance metrics in healthy men and postmenopausal women. The American journal of clinical nutrition 2017;105:589-599. PMID 28179223. DOI 10.3945/ajcn.116.139683. https://pubmed.ncbi.nlm.nih.gov/28179223/
3. Zou ML, Moughan PJ, Awati A, et al.. Accuracy of the Atwater factors and related food energy conversion factors with low-fat, high-fiber diets when energy intake is reduced spontaneously. The American journal of clinical nutrition 2007;86:1649-1656. PMID 18065582. DOI 10.1093/ajcn/86.5.1649. https://pubmed.ncbi.nlm.nih.gov/18065582/
4. Baer DJ, Rumpler WV, Miles CW, et al.. Dietary fiber decreases the metabolizable energy content and nutrient digestibility of mixed diets fed to humans. The Journal of nutrition 1997;127:579-586. PMID 9109608. DOI 10.1093/jn/127.4.579. https://pubmed.ncbi.nlm.nih.gov/9109608/
5. Miles CW, Kelsay JL, Wong NP. Effect of dietary fiber on the metabolizable energy of human diets. The Journal of nutrition 1988;118:1075-1081. PMID 2843615. DOI 10.1093/jn/118.9.1075. https://pubmed.ncbi.nlm.nih.gov/2843615/
6. Livesey G. Energy values of unavailable carbohydrate and diets: an inquiry and analysis. The American journal of clinical nutrition 1990;51:617-637. PMID 2138862. DOI 10.1093/ajcn/51.4.617. https://pubmed.ncbi.nlm.nih.gov/2138862/
7. Elia M, Cummings JH. Physiological aspects of energy metabolism and gastrointestinal effects of carbohydrates. European journal of clinical nutrition 2007;61 Suppl 1:S40-74. PMID 17992186. DOI 10.1038/sj.ejcn.1602938. https://pubmed.ncbi.nlm.nih.gov/17992186/
8. Davis TL, Dirks B, Carnero EA, et al.. Modeling the microbial contribution to human energy balance using the Digestion, Absorption, and Microbial Metabolism (DAMM) model. PloS one 2026;21:e0347668. PMID 42201874. DOI 10.1371/journal.pone.0347668. https://pubmed.ncbi.nlm.nih.gov/42201874/
9. Cummings JH, Bingham SA, Heaton KW, et al.. Fecal weight, colon cancer risk, and dietary intake of nonstarch polysaccharides (dietary fiber). Gastroenterology 1992;103:1783-1789. PMID 1333426. DOI 10.1016/0016-5085(92)91435-7. https://pubmed.ncbi.nlm.nih.gov/1333426/
10. McNeil NI. The contribution of the large intestine to energy supplies in man. The American journal of clinical nutrition 1984;39:338-342. PMID 6320630. DOI 10.1093/ajcn/39.2.338. https://pubmed.ncbi.nlm.nih.gov/6320630/
11. Bergman EN. Energy contributions of volatile fatty acids from the gastrointestinal tract in various species. Physiological reviews 1990;70:567-590. PMID 2181501. DOI 10.1152/physrev.1990.70.2.567. https://pubmed.ncbi.nlm.nih.gov/2181501/
12. Topping DL, Clifton PM. Short-chain fatty acids and human colonic function: roles of resistant starch and nonstarch polysaccharides. Physiological reviews 2001;81:1031-1064. PMID 11427691. DOI 10.1152/physrev.2001.81.3.1031. https://pubmed.ncbi.nlm.nih.gov/11427691/
13. Boets E, Deroover L, Houben E, et al.. Quantification of in Vivo Colonic Short Chain Fatty Acid Production from Inulin. Nutrients 2015;7:8916-8929. PMID 26516911. DOI 10.3390/nu7115440. https://pubmed.ncbi.nlm.nih.gov/26516911/
14. Pritchard SE, Marciani L, Garsed KC, et al.. Fasting and postprandial volumes of the undisturbed colon: normal values and changes in diarrhea-predominant irritable bowel syndrome measured using serial MRI. Neurogastroenterology and motility 2014;26:124-130. PMID 24131490. DOI 10.1111/nmo.12243. https://pubmed.ncbi.nlm.nih.gov/24131490/
15. Ho KS, Tan CY, Mohd Daud MA, et al.. Stopping or reducing dietary fiber intake reduces constipation and its associated symptoms. World journal of gastroenterology 2012;18:4593-4596. PMID 22969234. DOI 10.3748/wjg.v18.i33.4593. https://pubmed.ncbi.nlm.nih.gov/22969234/
16. Duncan SH, Belenguer A, Holtrop G, et al.. Reduced dietary intake of carbohydrates by obese subjects results in decreased concentrations of butyrate and butyrate-producing bacteria in feces. Applied and environmental microbiology 2007;73:1073-1078. PMID 17189447. DOI 10.1128/aem.02340-06. https://pubmed.ncbi.nlm.nih.gov/17189447/
17. Russell WR, Gratz SW, Duncan SH, et al.. High-protein, reduced-carbohydrate weight-loss diets promote metabolite profiles likely to be detrimental to colonic health. The American journal of clinical nutrition 2011;93:1062-1072. PMID 21389180. DOI 10.3945/ajcn.110.002188. https://pubmed.ncbi.nlm.nih.gov/21389180/
18. David LA, Maurice CF, Carmody RN, et al.. Diet rapidly and reproducibly alters the human gut microbiome. Nature 2014;505:559-563. PMID 24336217. DOI 10.1038/nature12820. https://pubmed.ncbi.nlm.nih.gov/24336217/
19. Wastyk HC, Fragiadakis GK, Perelman D, et al.. Gut-microbiota-targeted diets modulate human immune status. Cell 2021;184:4137-4153.e14. PMID 34256014. DOI 10.1016/j.cell.2021.06.019. https://pubmed.ncbi.nlm.nih.gov/34256014/
20. Lennerz BS, Mey JT, Henn OH, et al.. Behavioral Characteristics and Self-Reported Health Status among 2029 Adults Consuming a "Carnivore Diet". Current developments in nutrition 2021;5:nzab133. PMID 34934897. DOI 10.1093/cdn/nzab133. https://pubmed.ncbi.nlm.nih.gov/34934897/
21. Jumpertz R, Le DS, Turnbaugh PJ, et al.. Energy-balance studies reveal associations between gut microbes, caloric load, and nutrient absorption in humans. The American journal of clinical nutrition 2011;94:58-65. PMID 21543530. DOI 10.3945/ajcn.110.010132. https://pubmed.ncbi.nlm.nih.gov/21543530/
22. Mysonhimer AR, Holscher HD. Gastrointestinal Effects and Tolerance of Nondigestible Carbohydrate Consumption. Advances in nutrition (Bethesda, Md.) 2022;13:2237-2276. PMID 36041173. DOI 10.1093/advances/nmac094. https://pubmed.ncbi.nlm.nih.gov/36041173/
23. Wanders AJ, van den Borne JJ, de Graaf C, et al.. Effects of dietary fibre on subjective appetite, energy intake and body weight: a systematic review of randomized controlled trials. Obesity reviews : an official journal of the International Association for the Study of Obesity 2011;12:724-739. PMID 21676152. DOI 10.1111/j.1467-789x.2011.00895.x. https://pubmed.ncbi.nlm.nih.gov/21676152/
24. Thompson SV, Hannon BA, An R, et al.. Effects of isolated soluble fiber supplementation on body weight, glycemia, and insulinemia in adults with overweight and obesity: a systematic review and meta-analysis of randomized controlled trials. The American journal of clinical nutrition 2017;106:1514-1528. PMID 29092878. DOI 10.3945/ajcn.117.163246. https://pubmed.ncbi.nlm.nih.gov/29092878/
25. Jovanovski E, Mazhar N, Komishon A, et al.. Effect of viscous fiber supplementation on obesity indicators in individuals consuming calorie-restricted diets: a systematic review and meta-analysis of randomized controlled trials. European journal of nutrition 2021;60:101-112. PMID 32198674. DOI 10.1007/s00394-020-02224-1. https://pubmed.ncbi.nlm.nih.gov/32198674/
26. Miketinas DC, Bray GA, Beyl RA, et al.. Fiber Intake Predicts Weight Loss and Dietary Adherence in Adults Consuming Calorie-Restricted Diets: The POUNDS Lost (Preventing Overweight Using Novel Dietary Strategies) Study. The Journal of nutrition 2019;149:1742-1748. PMID 31174214. DOI 10.1093/jn/nxz117. https://pubmed.ncbi.nlm.nih.gov/31174214/
27. Brown L, Rosner B, Willett WW, et al.. Cholesterol-lowering effects of dietary fiber: a meta-analysis. The American journal of clinical nutrition 1999;69:30-42. PMID 9925120. DOI 10.1093/ajcn/69.1.30. https://pubmed.ncbi.nlm.nih.gov/9925120/
28. Whitehead A, Beck EJ, Tosh S, et al.. Cholesterol-lowering effects of oat β-glucan: a meta-analysis of randomized controlled trials. The American journal of clinical nutrition 2014;100:1413-1421. PMID 25411276. DOI 10.3945/ajcn.114.086108. https://pubmed.ncbi.nlm.nih.gov/25411276/
29. Post RE, Mainous AG, King DE, et al.. Dietary fiber for the treatment of type 2 diabetes mellitus: a meta-analysis. Journal of the American Board of Family Medicine : JABFM 2012;25:16-23. PMID 22218620. DOI 10.3122/jabfm.2012.01.110148. https://pubmed.ncbi.nlm.nih.gov/22218620/
30. Reynolds A, Mann J, Cummings J, et al.. Carbohydrate quality and human health: a series of systematic reviews and meta-analyses. Lancet (London, England) 2019;393:434-445. PMID 30638909. DOI 10.1016/s0140-6736(18)31809-9. https://pubmed.ncbi.nlm.nih.gov/30638909/
31. Threapleton DE, Greenwood DC, Evans CE, et al.. Dietary fibre intake and risk of cardiovascular disease: systematic review and meta-analysis. BMJ (Clinical research ed.) 2013;347:f6879. PMID 24355537. DOI 10.1136/bmj.f6879. https://pubmed.ncbi.nlm.nih.gov/24355537/
32. Carlsen H, Pajari AM. Dietary fiber - a scoping review for Nordic Nutrition Recommendations 2023. Food & nutrition research 2023;67. PMID 37920675. DOI 10.29219/fnr.v67.9979. https://pubmed.ncbi.nlm.nih.gov/37920675/
33. Novotny JA, Gebauer SK, Baer DJ. Discrepancy between the Atwater factor predicted and empirically measured energy values of almonds in human diets. The American journal of clinical nutrition 2012;96:296-301. PMID 22760558. DOI 10.3945/ajcn.112.035782. https://pubmed.ncbi.nlm.nih.gov/22760558/
34. Gebauer SK, Novotny JA, Bornhorst GM, et al.. Food processing and structure impact the metabolizable energy of almonds. Food & function 2016;7:4231-4238. PMID 27713968. DOI 10.1039/c6fo01076h. https://pubmed.ncbi.nlm.nih.gov/27713968/
35. Baer DJ, Gebauer SK, Novotny JA. Measured energy value of pistachios in the human diet. The British journal of nutrition 2012;107:120-125. PMID 21733319. DOI 10.1017/s0007114511002649. https://pubmed.ncbi.nlm.nih.gov/21733319/
36. Baer DJ, Gebauer SK, Novotny JA. Walnuts Consumed by Healthy Adults Provide Less Available Energy than Predicted by the Atwater Factors. The Journal of nutrition 2016;146:9-13. PMID 26581681. DOI 10.3945/jn.115.217372. https://pubmed.ncbi.nlm.nih.gov/26581681/
37. Baer DJ, Novotny JA. Metabolizable Energy from Cashew Nuts is Less than that Predicted by Atwater Factors. Nutrients 2018;11:E33. PMID 30586843. DOI 10.3390/nu11010033. https://pubmed.ncbi.nlm.nih.gov/30586843/
38. Koebnick C, Strassner C, Hoffmann I, et al.. Consequences of a long-term raw food diet on body weight and menstruation: results of a questionnaire survey. Annals of nutrition & metabolism 1999;43:69-79. PMID 10436305. DOI 10.1159/000012770. https://pubmed.ncbi.nlm.nih.gov/10436305/
39. Carmody RN, Wrangham RW. The energetic significance of cooking. Journal of human evolution 2009;57:379-391. PMID 19732938. DOI 10.1016/j.jhevol.2009.02.011. https://pubmed.ncbi.nlm.nih.gov/19732938/
40. Hall KD, Ayuketah A, Brychta R, et al.. Ultra-Processed Diets Cause Excess Calorie Intake and Weight Gain: An Inpatient Randomized Controlled Trial of Ad Libitum Food Intake. Cell metabolism 2019;30:67-77.e3. PMID 31105044. DOI 10.1016/j.cmet.2019.05.008. https://pubmed.ncbi.nlm.nih.gov/31105044/
41. Hamano S, Sawada M, Aihara M, et al.. Ultra-processed foods cause weight gain and increased energy intake associated with reduced chewing frequency: A randomized, open-label, crossover study. Diabetes, obesity & metabolism 2024;26:5431-5443. PMID 39267249. DOI 10.1111/dom.15922. https://pubmed.ncbi.nlm.nih.gov/39267249/
42. Dicken SJ, Jassil FC, Brown A, et al.. Ultraprocessed or minimally processed diets following healthy dietary guidelines on weight and cardiometabolic health: a randomized, crossover trial. Nature medicine 2025;31:3297-3308. PMID 40760353. DOI 10.1038/s41591-025-03842-0. https://pubmed.ncbi.nlm.nih.gov/40760353/
43. Rolls BJ. The relationship between dietary energy density and energy intake. Physiology & behavior 2009;97:609-615. PMID 19303887. DOI 10.1016/j.physbeh.2009.03.011. https://pubmed.ncbi.nlm.nih.gov/19303887/
44. Rolls BJ, Roe LS, Meengs JS. Reductions in portion size and energy density of foods are additive and lead to sustained decreases in energy intake. The American journal of clinical nutrition 2006;83:11-17. PMID 16400043. DOI 10.1093/ajcn/83.1.11. https://pubmed.ncbi.nlm.nih.gov/16400043/
45. Ello-Martin JA, Roe LS, Ledikwe JH, et al.. Dietary energy density in the treatment of obesity: a year-long trial comparing 2 weight-loss diets. The American journal of clinical nutrition 2007;85:1465-1477. PMID 17556681. DOI 10.1093/ajcn/85.6.1465. https://pubmed.ncbi.nlm.nih.gov/17556681/
46. Robinson E, Almiron-Roig E, Rutters F, et al.. A systematic review and meta-analysis examining the effect of eating rate on energy intake and hunger. The American journal of clinical nutrition 2014;100:123-151. PMID 24847856. DOI 10.3945/ajcn.113.081745. https://pubmed.ncbi.nlm.nih.gov/24847856/
47. Heer M, Baisch F, Kropp J, et al.. High dietary sodium chloride consumption may not induce body fluid retention in humans. American journal of physiology. Renal physiology 2000;278:F585-95. PMID 10751219. DOI 10.1152/ajprenal.2000.278.4.f585. https://pubmed.ncbi.nlm.nih.gov/10751219/
48. Titze J, Maillet A, Lang R, et al.. Long-term sodium balance in humans in a terrestrial space station simulation study. American journal of kidney diseases : the official journal of the National Kidney Foundation 2002;40:508-516. PMID 12200802. DOI 10.1053/ajkd.2002.34908. https://pubmed.ncbi.nlm.nih.gov/12200802/
49. Rakova N, Kitada K, Lerchl K, et al.. Increased salt consumption induces body water conservation and decreases fluid intake. The Journal of clinical investigation 2017;127:1932-1943. PMID 28414302. DOI 10.1172/jci88530. https://pubmed.ncbi.nlm.nih.gov/28414302/
50. He FJ, Markandu ND, Sagnella GA, et al.. Effect of salt intake on renal excretion of water in humans. Hypertension (Dallas, Tex. : 1979) 2001;38:317-320. PMID 11566897. DOI 10.1161/01.hyp.38.3.317. https://pubmed.ncbi.nlm.nih.gov/11566897/
51. Mihara Y, Kado H, Yokota I, et al.. Rapid weight loss with dietary salt restriction in hospitalized patients with chronic kidney disease. Scientific reports 2019;9:8787. PMID 31217504. DOI 10.1038/s41598-019-45341-6. https://pubmed.ncbi.nlm.nih.gov/31217504/
52. Mähler A, Klamer S, Maifeld A, et al.. Increased Salt Intake Decreases Diet-Induced Thermogenesis in Healthy Volunteers: A Randomized Placebo-Controlled Study. Nutrients 2022;14:253. PMID 35057434. DOI 10.3390/nu14020253. https://pubmed.ncbi.nlm.nih.gov/35057434/
53. DeHaven J, Sherwin R, Hendler R, et al.. Nitrogen and sodium balance and sympathetic-nervous-system activity in obese subjects treated with a low-calorie protein or mixed diet. The New England journal of medicine 1980;302:477-482. PMID 7351972. DOI 10.1056/nejm198002283020901. https://pubmed.ncbi.nlm.nih.gov/7351972/
54. Sigler MH. The mechanism of the natriuresis of fasting. The Journal of clinical investigation 1975;55:377-387. PMID 236328. DOI 10.1172/jci107941. https://pubmed.ncbi.nlm.nih.gov/236328/
55. DeFronzo RA, Cooke CR, Andres R, et al.. The effect of insulin on renal handling of sodium, potassium, calcium, and phosphate in man. The Journal of clinical investigation 1975;55:845-855. PMID 1120786. DOI 10.1172/jci107996. https://pubmed.ncbi.nlm.nih.gov/1120786/
56. Yang MU, Van Itallie TB. Composition of weight lost during short-term weight reduction. Metabolic responses of obese subjects to starvation and low-calorie ketogenic and nonketogenic diets. The Journal of clinical investigation 1976;58:722-730. PMID 956398. DOI 10.1172/jci108519. https://pubmed.ncbi.nlm.nih.gov/956398/
57. Phinney SD, Bistrian BR, Wolfe RR, et al.. The human metabolic response to chronic ketosis without caloric restriction: physical and biochemical adaptation. Metabolism: clinical and experimental 1983;32:757-768. PMID 6865775. DOI 10.1016/0026-0495(83)90105-1. https://pubmed.ncbi.nlm.nih.gov/6865775/
58. Hall KD, Chen KY, Guo J, et al.. Energy expenditure and body composition changes after an isocaloric ketogenic diet in overweight and obese men. The American journal of clinical nutrition 2016;104:324-333. PMID 27385608. DOI 10.3945/ajcn.116.133561. https://pubmed.ncbi.nlm.nih.gov/27385608/
59. Kreitzman SN, Coxon AY, Szaz KF. Glycogen storage: illusions of easy weight loss, excessive weight regain, and distortions in estimates of body composition. The American journal of clinical nutrition 1992;56:292S-293S. PMID 1615908. DOI 10.1093/ajcn/56.1.292s. https://pubmed.ncbi.nlm.nih.gov/1615908/
60. Fernández-Elías VE, Ortega JF, Nelson RK, et al.. Relationship between muscle water and glycogen recovery after prolonged exercise in the heat in humans. European journal of applied physiology 2015;115:1919-1926. PMID 25911631. DOI 10.1007/s00421-015-3175-z. https://pubmed.ncbi.nlm.nih.gov/25911631/
61. Yamada Y, Zhang X, Henderson MET, et al.. Variation in human water turnover associated with environmental and lifestyle factors. Science (New York, N.Y.) 2022;378:909-915. PMID 36423296. DOI 10.1126/science.abm8668. https://pubmed.ncbi.nlm.nih.gov/36423296/
62. Watson PE, Watson ID, Batt RD. Total body water volumes for adult males and females estimated from simple anthropometric measurements. The American journal of clinical nutrition 1980;33:27-39. PMID 6986753. DOI 10.1093/ajcn/33.1.27. https://pubmed.ncbi.nlm.nih.gov/6986753/
63. American College of Sports Medicine, Sawka MN, Burke LM, et al.. American College of Sports Medicine position stand. Exercise and fluid replacement. Medicine and science in sports and exercise 2007;39:377-390. PMID 17277604. DOI 10.1249/mss.0b013e31802ca597. https://pubmed.ncbi.nlm.nih.gov/17277604/
64. Baker LB. Sweating Rate and Sweat Sodium Concentration in Athletes: A Review of Methodology and Intra/Interindividual Variability. Sports medicine (Auckland, N.Z.) 2017;47:111-128. PMID 28332116. DOI 10.1007/s40279-017-0691-5. https://pubmed.ncbi.nlm.nih.gov/28332116/
65. Cheuvront SN, Kenefick RW. Dehydration: physiology, assessment, and performance effects. Comprehensive Physiology 2014;4:257-285. PMID 24692140. DOI 10.1002/cphy.c130017. https://pubmed.ncbi.nlm.nih.gov/24692140/
66. Goulet ED. Effect of exercise-induced dehydration on endurance performance: evaluating the impact of exercise protocols on outcomes using a meta-analytic procedure. British journal of sports medicine 2013;47:679-686. PMID 22763119. DOI 10.1136/bjsports-2012-090958. https://pubmed.ncbi.nlm.nih.gov/22763119/
67. Hew-Butler T, Rosner MH, Fowkes-Godek S, et al.. Statement of the Third International Exercise-Associated Hyponatremia Consensus Development Conference, Carlsbad, California, 2015. Clinical journal of sport medicine : official journal of the Canadian Academy of Sport Medicine 2015;25:303-320. PMID 26102445. DOI 10.1097/jsm.0000000000000221. https://pubmed.ncbi.nlm.nih.gov/26102445/
68. Orsama AL, Mattila E, Ermes M, et al.. Weight rhythms: weight increases during weekends and decreases during weekdays. Obesity facts 2014;7:36-47. PMID 24504358. DOI 10.1159/000356147. https://pubmed.ncbi.nlm.nih.gov/24504358/
69. Cheuvront SN, Carter R, Montain SJ, et al.. Daily body mass variability and stability in active men undergoing exercise-heat stress. International journal of sport nutrition and exercise metabolism 2004;14:532-540. PMID 15673099. DOI 10.1123/ijsnem.14.5.532. https://pubmed.ncbi.nlm.nih.gov/15673099/
70. Micoanski KS, Soriano JM, Gozalbo MM. Potomania and Beer Potomania: A Systematic Review of Published Case Reports. Nutrients 2025;17:2012. PMID 40573123. DOI 10.3390/nu17122012. https://pubmed.ncbi.nlm.nih.gov/40573123/
71. Wilhelmi de Toledo F, Grundler F, Bergouignan A, et al.. Safety, health improvement and well-being during a 4 to 21-day fasting period in an observational study including 1422 subjects. PloS one 2019;14:e0209353. PMID 30601864. DOI 10.1371/journal.pone.0209353. https://pubmed.ncbi.nlm.nih.gov/30601864/
72. National Academies of Sciences, Engineering, and Medicine. Dietary Reference Intakes for Sodium and Potassium. Washington DC: The National Academies Press; 2019. (sodium AI 1,500 mg/d, CDRR 2,300 mg/d; potassium AI 3,400 mg men / 2,600 mg women). https://www.nationalacademies.org/read/25353/chapter/2 (accessed via WebFetch 2026-09-30).
73. Institute of Medicine. Dietary Reference Intakes for Water, Potassium, Sodium, Chloride, and Sulfate. Washington DC: The National Academies Press; 2005. (total water AI 3.7 L men / 2.7 L women; potassium AI 4.7 g, superseded by [72]). https://www.nationalacademies.org/read/10925/chapter/2 (accessed via WebFetch 2026-09-30).
74. Dennis EA, Dengo AL, Comber DL, et al.. Water consumption increases weight loss during a hypocaloric diet intervention in middle-aged and older adults. Obesity (Silver Spring, Md.) 2010;18:300-307. PMID 19661958. DOI 10.1038/oby.2009.235. https://pubmed.ncbi.nlm.nih.gov/19661958/
75. Parretti HM, Aveyard P, Blannin A, et al.. Efficacy of water preloading before main meals as a strategy for weight loss in primary care patients with obesity: RCT. Obesity (Silver Spring, Md.) 2015;23:1785-1791. PMID 26237305. DOI 10.1002/oby.21167. https://pubmed.ncbi.nlm.nih.gov/26237305/
76. Davy BM, Dennis EA, Dengo AL, et al.. Water consumption reduces energy intake at a breakfast meal in obese older adults. Journal of the American Dietetic Association 2008;108:1236-1239. PMID 18589036. DOI 10.1016/j.jada.2008.04.013. https://pubmed.ncbi.nlm.nih.gov/18589036/
77. Brown CM, Dulloo AG, Montani JP. Water-induced thermogenesis reconsidered: the effects of osmolality and water temperature on energy expenditure after drinking. The Journal of clinical endocrinology and metabolism 2006;91:3598-3602. PMID 16822824. DOI 10.1210/jc.2006-0407. https://pubmed.ncbi.nlm.nih.gov/16822824/
78. Calton JB. Prevalence of micronutrient deficiency in popular diet plans. Journal of the International Society of Sports Nutrition 2010;7:24. PMID 20537171. DOI 10.1186/1550-2783-7-24. https://pubmed.ncbi.nlm.nih.gov/20537171/
79. Gardner CD, Kim S, Bersamin A, et al.. Micronutrient quality of weight-loss diets that focus on macronutrients: results from the A TO Z study. The American journal of clinical nutrition 2010;92:304-312. PMID 20573800. DOI 10.3945/ajcn.2010.29468. https://pubmed.ncbi.nlm.nih.gov/20573800/
80. Churuangsuk C, Griffiths D, Lean MEJ, et al.. Impacts of carbohydrate-restricted diets on micronutrient intakes and status: A systematic review. Obesity reviews : an official journal of the International Association for the Study of Obesity 2019;20:1132-1147. PMID 31006978. DOI 10.1111/obr.12857. https://pubmed.ncbi.nlm.nih.gov/31006978/
81. Neufingerl N, Eilander A. Nutrient Intake and Status in Adults Consuming Plant-Based Diets Compared to Meat-Eaters: A Systematic Review. Nutrients 2021;14:29. PMID 35010904. DOI 10.3390/nu14010029. https://pubmed.ncbi.nlm.nih.gov/35010904/
82. Bakaloudi DR, Halloran A, Rippin HL, et al.. Intake and adequacy of the vegan diet. A systematic review of the evidence. Clinical nutrition (Edinburgh, Scotland) 2021;40:3503-3521. PMID 33341313. DOI 10.1016/j.clnu.2020.11.035. https://pubmed.ncbi.nlm.nih.gov/33341313/
83. Haider LM, Schwingshackl L, Hoffmann G, et al.. The effect of vegetarian diets on iron status in adults: A systematic review and meta-analysis. Critical reviews in food science and nutrition 2018;58:1359-1374. PMID 27880062. DOI 10.1080/10408398.2016.1259210. https://pubmed.ncbi.nlm.nih.gov/27880062/
84. Reider CA, Chung RY, Devarshi PP, et al.. Inadequacy of Immune Health Nutrients: Intakes in US Adults, the 2005-2016 NHANES. Nutrients 2020;12:E1735. PMID 32531972. DOI 10.3390/nu12061735. https://pubmed.ncbi.nlm.nih.gov/32531972/
85. Blumberg JB, Frei BB, Fulgoni VL, et al.. Impact of Frequency of Multi-Vitamin/Multi-Mineral Supplement Intake on Nutritional Adequacy and Nutrient Deficiencies in U.S. Adults. Nutrients 2017;9:E849. PMID 28792457. DOI 10.3390/nu9080849. https://pubmed.ncbi.nlm.nih.gov/28792457/
86. Fulgoni VL, Keast DR, Bailey RL, et al.. Foods, fortificants, and supplements: Where do Americans get their nutrients?. The Journal of nutrition 2011;141:1847-1854. PMID 21865568. DOI 10.3945/jn.111.142257. https://pubmed.ncbi.nlm.nih.gov/21865568/
87. Verdon F, Burnand B, Stubi CL, et al.. Iron supplementation for unexplained fatigue in non-anaemic women: double blind randomised placebo controlled trial. BMJ (Clinical research ed.) 2003;326:1124. PMID 12763985. DOI 10.1136/bmj.326.7399.1124. https://pubmed.ncbi.nlm.nih.gov/12763985/
88. Houston BL, Hurrie D, Graham J, et al.. Efficacy of iron supplementation on fatigue and physical capacity in non-anaemic iron-deficient adults: a systematic review of randomised controlled trials. BMJ open 2018;8:e019240. PMID 29626044. DOI 10.1136/bmjopen-2017-019240. https://pubmed.ncbi.nlm.nih.gov/29626044/
89. Looker AC, Dallman PR, Carroll MD, et al.. Prevalence of iron deficiency in the United States. JAMA 1997;277:973-976. PMID 9091669. DOI 10.1001/jama.1997.03540360041028. https://pubmed.ncbi.nlm.nih.gov/9091669/
90. Pasricha SR, Tye-Din J, Muckenthaler MU, et al.. Iron deficiency. Lancet (London, England) 2021;397:233-248. PMID 33285139. DOI 10.1016/s0140-6736(20)32594-0. https://pubmed.ncbi.nlm.nih.gov/33285139/
91. Brown MJ, Ferruzzi MG, Nguyen ML, et al.. Carotenoid bioavailability is higher from salads ingested with full-fat than with fat-reduced salad dressings as measured with electrochemical detection. The American journal of clinical nutrition 2004;80:396-403. PMID 15277161. DOI 10.1093/ajcn/80.2.396. https://pubmed.ncbi.nlm.nih.gov/15277161/
92. Dawson-Hughes B, Harris SS, Lichtenstein AH, et al.. Dietary fat increases vitamin D-3 absorption. Journal of the Academy of Nutrition and Dietetics 2015;115:225-230. PMID 25441954. DOI 10.1016/j.jand.2014.09.014. https://pubmed.ncbi.nlm.nih.gov/25441954/
93. Jeanes YM, Hall WL, Ellard S, et al.. The absorption of vitamin E is influenced by the amount of fat in a meal and the food matrix. The British journal of nutrition 2004;92:575-579. PMID 15522126. DOI 10.1079/bjn20041249. https://pubmed.ncbi.nlm.nih.gov/15522126/
94. Jeppesen PB, Høy CE, Mortensen PB. Essential fatty acid deficiency in patients receiving home parenteral nutrition. The American journal of clinical nutrition 1998;68:126-133. PMID 9665106. DOI 10.1093/ajcn/68.1.126. https://pubmed.ncbi.nlm.nih.gov/9665106/
95. Carr AC, Rowe S. Factors Affecting Vitamin C Status and Prevalence of Deficiency: A Global Health Perspective. Nutrients 2020;12:E1963. PMID 32630245. DOI 10.3390/nu12071963. https://pubmed.ncbi.nlm.nih.gov/32630245/
96. Banner L, Rice Bradley BH, Clinthorne J. Nutrient analysis of three low-carbohydrate diets differing in carbohydrate content. Frontiers in nutrition 2024;11:1449109. PMID 39279895. DOI 10.3389/fnut.2024.1449109. https://pubmed.ncbi.nlm.nih.gov/39279895/
97. Siler SQ, Neese RA, Hellerstein MK. De novo lipogenesis, lipid kinetics, and whole-body lipid balances in humans after acute alcohol consumption. The American journal of clinical nutrition 1999;70:928-936. PMID 10539756. DOI 10.1093/ajcn/70.5.928. https://pubmed.ncbi.nlm.nih.gov/10539756/
98. Suter PM, Schutz Y, Jequier E. The effect of ethanol on fat storage in healthy subjects. The New England journal of medicine 1992;326:983-987. PMID 1545851. DOI 10.1056/nejm199204093261503. https://pubmed.ncbi.nlm.nih.gov/1545851/
99. Suter PM, Jéquier E, Schutz Y. Effect of ethanol on energy expenditure. The American journal of physiology 1994;266:R1204-12. PMID 8184963. DOI 10.1152/ajpregu.1994.266.4.r1204. https://pubmed.ncbi.nlm.nih.gov/8184963/
100. Shelmet JJ, Reichard GA, Skutches CL, et al.. Ethanol causes acute inhibition of carbohydrate, fat, and protein oxidation and insulin resistance. The Journal of clinical investigation 1988;81:1137-1145. PMID 3280601. DOI 10.1172/jci113428. https://pubmed.ncbi.nlm.nih.gov/3280601/
101. Sonko BJ, Prentice AM, Murgatroyd PR, et al.. Effect of alcohol on postmeal fat storage. The American journal of clinical nutrition 1994;59:619-625. PMID 8116538. DOI 10.1093/ajcn/59.3.619. https://pubmed.ncbi.nlm.nih.gov/8116538/
102. Weststrate JA, Wunnink I, Deurenberg P, et al.. Alcohol and its acute effects on resting metabolic rate and diet-induced thermogenesis. The British journal of nutrition 1990;64:413-425. PMID 2121268. DOI 10.1079/bjn19900042. https://pubmed.ncbi.nlm.nih.gov/2121268/
103. Rumpler WV, Rhodes DG, Baer DJ, et al.. Energy value of moderate alcohol consumption by humans. The American journal of clinical nutrition 1996;64:108-114. PMID 8669405. DOI 10.1093/ajcn/64.1.108. https://pubmed.ncbi.nlm.nih.gov/8669405/
104. Raben A, Agerholm-Larsen L, Flint A, et al.. Meals with similar energy densities but rich in protein, fat, carbohydrate, or alcohol have different effects on energy expenditure and substrate metabolism but not on appetite and energy intake. The American journal of clinical nutrition 2003;77:91-100. PMID 12499328. DOI 10.1093/ajcn/77.1.91. https://pubmed.ncbi.nlm.nih.gov/12499328/
105. Kwok A, Kwok A, Dordevic AL, et al.. Effect of alcohol consumption on food energy intake: a systematic review and meta-analysis. The British journal of nutrition 2019;121:481-495. PMID 30630543. DOI 10.1017/s0007114518003677. https://pubmed.ncbi.nlm.nih.gov/30630543/
106. Yeomans MR. Alcohol, appetite and energy balance: is alcohol intake a risk factor for obesity?. Physiology & behavior 2010;100:82-89. PMID 20096714. DOI 10.1016/j.physbeh.2010.01.012. https://pubmed.ncbi.nlm.nih.gov/20096714/
107. Parr EB, Camera DM, Areta JL, et al.. Alcohol ingestion impairs maximal post-exercise rates of myofibrillar protein synthesis following a single bout of concurrent training. PloS one 2014;9:e88384. PMID 24533082. DOI 10.1371/journal.pone.0088384. https://pubmed.ncbi.nlm.nih.gov/24533082/
108. Sierksma A, Sarkola T, Eriksson CJ, et al.. Effect of moderate alcohol consumption on plasma dehydroepiandrosterone sulfate, testosterone, and estradiol levels in middle-aged men and postmenopausal women: a diet-controlled intervention study. Alcoholism, clinical and experimental research 2004;28:780-785. PMID 15166654. DOI 10.1097/01.alc.0000125356.70824.81. https://pubmed.ncbi.nlm.nih.gov/15166654/
109. Ebrahim IO, Shapiro CM, Williams AJ, et al.. Alcohol and sleep I: effects on normal sleep. Alcoholism, clinical and experimental research 2013;37:539-549. PMID 23347102. DOI 10.1111/acer.12006. https://pubmed.ncbi.nlm.nih.gov/23347102/
110. Pietilä J, Helander E, Korhonen I, et al.. Acute Effect of Alcohol Intake on Cardiovascular Autonomic Regulation During the First Hours of Sleep in a Large Real-World Sample of Finnish Employees: Observational Study. JMIR mental health 2018;5:e23. PMID 29549064. DOI 10.2196/mental.9519. https://pubmed.ncbi.nlm.nih.gov/29549064/
111. Rimm EB, Williams P, Fosher K, et al.. Moderate alcohol intake and lower risk of coronary heart disease: meta-analysis of effects on lipids and haemostatic factors. BMJ (Clinical research ed.) 1999;319:1523-1528. PMID 10591709. DOI 10.1136/bmj.319.7224.1523. https://pubmed.ncbi.nlm.nih.gov/10591709/
112. Wood AM, Kaptoge S, Butterworth AS, et al.. Risk thresholds for alcohol consumption: combined analysis of individual-participant data for 599 912 current drinkers in 83 prospective studies. Lancet (London, England) 2018;391:1513-1523. PMID 29676281. DOI 10.1016/s0140-6736(18)30134-x. https://pubmed.ncbi.nlm.nih.gov/29676281/
113. Jones AW. Evidence-based survey of the elimination rates of ethanol from blood with applications in forensic casework. Forensic science international 2010;200:1-20. PMID 20304569. DOI 10.1016/j.forsciint.2010.02.021. https://pubmed.ncbi.nlm.nih.gov/20304569/
114. Shirreffs SM, Maughan RJ. Restoration of fluid balance after exercise-induced dehydration: effects of alcohol consumption. Journal of applied physiology (Bethesda, Md. : 1985) 1997;83:1152-1158. PMID 9338423. DOI 10.1152/jappl.1997.83.4.1152. https://pubmed.ncbi.nlm.nih.gov/9338423/
115. Hobson RM, Maughan RJ. Hydration status and the diuretic action of a small dose of alcohol. Alcohol and alcoholism (Oxford, Oxfordshire) 2010;45:366-373. PMID 20497950. DOI 10.1093/alcalc/agq029. https://pubmed.ncbi.nlm.nih.gov/20497950/
116. FIELD JB, WILLIAMS HE, MORTIMORE GE. Studies on the mechanism of ethanol-induced hypoglycemia. The Journal of clinical investigation 1963;42:497-506. PMID 13945055. DOI 10.1172/jci104738. https://pubmed.ncbi.nlm.nih.gov/13945055/
117. National Institute on Alcohol Abuse and Alcoholism (NIAAA). What is a standard drink? (14 g pure alcohol: 12 fl oz beer 5 %, 5 fl oz wine 12 %, 1.5 fl oz spirits 40 %). https://www.niaaa.nih.gov/alcohols-effects-health/overview-alcohol-consumption/what-standard-drink (accessed 2026-09-30).
118. Dulloo AG, Geissler CA, Horton T, et al.. Normal caffeine consumption: influence on thermogenesis and daily energy expenditure in lean and postobese human volunteers. The American journal of clinical nutrition 1989;49:44-50. PMID 2912010. DOI 10.1093/ajcn/49.1.44. https://pubmed.ncbi.nlm.nih.gov/2912010/
119. Astrup A, Toubro S, Cannon S, et al.. Caffeine: a double-blind, placebo-controlled study of its thermogenic, metabolic, and cardiovascular effects in healthy volunteers. The American journal of clinical nutrition 1990;51:759-767. PMID 2333832. DOI 10.1093/ajcn/51.5.759. https://pubmed.ncbi.nlm.nih.gov/2333832/
120. Acheson KJ, Zahorska-Markiewicz B, Pittet P, et al.. Caffeine and coffee: their influence on metabolic rate and substrate utilization in normal weight and obese individuals. The American journal of clinical nutrition 1980;33:989-997. PMID 7369170. DOI 10.1093/ajcn/33.5.989. https://pubmed.ncbi.nlm.nih.gov/7369170/
121. Hursel R, Viechtbauer W, Dulloo AG, et al.. The effects of catechin rich teas and caffeine on energy expenditure and fat oxidation: a meta-analysis. Obesity reviews : an official journal of the International Association for the Study of Obesity 2011;12:e573-81. PMID 21366839. DOI 10.1111/j.1467-789x.2011.00862.x. https://pubmed.ncbi.nlm.nih.gov/21366839/
122. Hursel R, Viechtbauer W, Westerterp-Plantenga MS. The effects of green tea on weight loss and weight maintenance: a meta-analysis. International journal of obesity (2005) 2009;33:956-961. PMID 19597519. DOI 10.1038/ijo.2009.135. https://pubmed.ncbi.nlm.nih.gov/19597519/
123. Jurgens TM, Whelan AM, Killian L, et al.. Green tea for weight loss and weight maintenance in overweight or obese adults. The Cochrane database of systematic reviews 2012;12:CD008650. PMID 23235664. DOI 10.1002/14651858.cd008650.pub2. https://pubmed.ncbi.nlm.nih.gov/23235664/
124. Dulloo AG, Duret C, Rohrer D, et al.. Efficacy of a green tea extract rich in catechin polyphenols and caffeine in increasing 24-h energy expenditure and fat oxidation in humans. The American journal of clinical nutrition 1999;70:1040-1045. PMID 10584049. DOI 10.1093/ajcn/70.6.1040. https://pubmed.ncbi.nlm.nih.gov/10584049/
125. Collado-Mateo D, Lavín-Pérez AM, Merellano-Navarro E, et al.. Effect of Acute Caffeine Intake on the Fat Oxidation Rate during Exercise: A Systematic Review and Meta-Analysis. Nutrients 2020;12:E3603. PMID 33255240. DOI 10.3390/nu12123603. https://pubmed.ncbi.nlm.nih.gov/33255240/
126. Tabrizi R, Saneei P, Lankarani KB, et al.. The effects of caffeine intake on weight loss: a systematic review and dos-response meta-analysis of randomized controlled trials. Critical reviews in food science and nutrition 2019;59:2688-2696. PMID 30335479. DOI 10.1080/10408398.2018.1507996. https://pubmed.ncbi.nlm.nih.gov/30335479/
127. Schubert MM, Irwin C, Seay RF, et al.. Caffeine, coffee, and appetite control: a review. International journal of food sciences and nutrition 2017;68:901-912. PMID 28446037. DOI 10.1080/09637486.2017.1320537. https://pubmed.ncbi.nlm.nih.gov/28446037/
128. Grgic J, Grgic I, Pickering C, et al.. Wake up and smell the coffee: caffeine supplementation and exercise performance-an umbrella review of 21 published meta-analyses. British journal of sports medicine 2020;54:681-688. PMID 30926628. DOI 10.1136/bjsports-2018-100278. https://pubmed.ncbi.nlm.nih.gov/30926628/
129. Southward K, Rutherfurd-Markwick KJ, Ali A. The Effect of Acute Caffeine Ingestion on Endurance Performance: A Systematic Review and Meta-Analysis. Sports medicine (Auckland, N.Z.) 2018;48:1913-1928. PMID 29876876. DOI 10.1007/s40279-018-0939-8. https://pubmed.ncbi.nlm.nih.gov/29876876/
130. Grgic J, Trexler ET, Lazinica B, et al.. Effects of caffeine intake on muscle strength and power: a systematic review and meta-analysis. Journal of the International Society of Sports Nutrition 2018;15:11. PMID 29527137. DOI 10.1186/s12970-018-0216-0. https://pubmed.ncbi.nlm.nih.gov/29527137/
131. Guest NS, VanDusseldorp TA, Nelson MT, et al.. International society of sports nutrition position stand: caffeine and exercise performance. Journal of the International Society of Sports Nutrition 2021;18:1. PMID 33388079. DOI 10.1186/s12970-020-00383-4. https://pubmed.ncbi.nlm.nih.gov/33388079/
132. Gardiner C, Weakley J, Burke LM, et al.. The effect of caffeine on subsequent sleep: A systematic review and meta-analysis. Sleep medicine reviews 2023;69:101764. PMID 36870101. DOI 10.1016/j.smrv.2023.101764. https://pubmed.ncbi.nlm.nih.gov/36870101/
133. Drake C, Roehrs T, Shambroom J, et al.. Caffeine effects on sleep taken 0, 3, or 6 hours before going to bed. Journal of clinical sleep medicine : JCSM : official publication of the American Academy of Sleep Medicine 2013;9:1195-1200. PMID 24235903. DOI 10.5664/jcsm.3170. https://pubmed.ncbi.nlm.nih.gov/24235903/
134. Beaumont R, Cordery P, Funnell M, et al.. Chronic ingestion of a low dose of caffeine induces tolerance to the performance benefits of caffeine. Journal of sports sciences 2017;35:1920-1927. PMID 27762662. DOI 10.1080/02640414.2016.1241421. https://pubmed.ncbi.nlm.nih.gov/27762662/
135. Nehlig A. Interindividual Differences in Caffeine Metabolism and Factors Driving Caffeine Consumption. Pharmacological reviews 2018;70:384-411. PMID 29514871. DOI 10.1124/pr.117.014407. https://pubmed.ncbi.nlm.nih.gov/29514871/
136. Hultman E, Söderlund K, Timmons JA, et al.. Muscle creatine loading in men. Journal of applied physiology (Bethesda, Md. : 1985) 1996;81:232-237. PMID 8828669. DOI 10.1152/jappl.1996.81.1.232. https://pubmed.ncbi.nlm.nih.gov/8828669/
137. Powers ME, Arnold BL, Weltman AL, et al.. Creatine Supplementation Increases Total Body Water Without Altering Fluid Distribution. Journal of athletic training 2003;38:44-50. PMID 12937471. https://pubmed.ncbi.nlm.nih.gov/12937471/
138. Kreider RB, Kalman DS, Antonio J, et al.. International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine. Journal of the International Society of Sports Nutrition 2017;14:18. PMID 28615996. DOI 10.1186/s12970-017-0173-z. https://pubmed.ncbi.nlm.nih.gov/28615996/
139. Chilibeck PD, Kaviani M, Candow DG, et al.. Effect of creatine supplementation during resistance training on lean tissue mass and muscular strength in older adults: a meta-analysis. Open access journal of sports medicine 2017;8:213-226. PMID 29138605. DOI 10.2147/oajsm.s123529. https://pubmed.ncbi.nlm.nih.gov/29138605/
140. Desai I, Wewege MA, Jones MD, et al.. The Effect of Creatine Supplementation on Resistance Training-Based Changes to Body Composition: A Systematic Review and Meta-analysis. Journal of strength and conditioning research 2024;38:1813-1821. PMID 39074168. DOI 10.1519/jsc.0000000000004862. https://pubmed.ncbi.nlm.nih.gov/39074168/
141. Burke R, Piñero A, Coleman M, et al.. The Effects of Creatine Supplementation Combined with Resistance Training on Regional Measures of Muscle Hypertrophy: A Systematic Review with Meta-Analysis. Nutrients 2023;15:2116. PMID 37432300. DOI 10.3390/nu15092116. https://pubmed.ncbi.nlm.nih.gov/37432300/
142. Naddafha S, Antonio J, Kreider RB, et al.. Creatine monohydrate for lean mass, strength, and bone density in postmenopausal women: a systematic review and meta-analysis. Journal of the International Society of Sports Nutrition 2026;23:2668435. PMID 42141930. DOI 10.1080/15502783.2026.2668435. https://pubmed.ncbi.nlm.nih.gov/42141930/
143. Skulas-Ray AC, Wilson PWF, Harris WS, et al.. Omega-3 Fatty Acids for the Management of Hypertriglyceridemia: A Science Advisory From the American Heart Association. Circulation 2019;140:e673-e691. PMID 31422671. DOI 10.1161/cir.0000000000000709. https://pubmed.ncbi.nlm.nih.gov/31422671/
144. Bernasconi AA, Wiest MM, Lavie CJ, et al.. Effect of Omega-3 Dosage on Cardiovascular Outcomes: An Updated Meta-Analysis and Meta-Regression of Interventional Trials. Mayo Clinic proceedings 2021;96:304-313. PMID 32951855. DOI 10.1016/j.mayocp.2020.08.034. https://pubmed.ncbi.nlm.nih.gov/32951855/
145. Martineau AR, Jolliffe DA, Hooper RL, et al.. Vitamin D supplementation to prevent acute respiratory tract infections: systematic review and meta-analysis of individual participant data. BMJ (Clinical research ed.) 2017;356:i6583. PMID 28202713. DOI 10.1136/bmj.i6583. https://pubmed.ncbi.nlm.nih.gov/28202713/
146. Bolland MJ, Grey A, Avenell A. Effects of vitamin D supplementation on musculoskeletal health: a systematic review, meta-analysis, and trial sequential analysis. The lancet. Diabetes & endocrinology 2018;6:847-858. PMID 30293909. DOI 10.1016/s2213-8587(18)30265-1. https://pubmed.ncbi.nlm.nih.gov/30293909/
147. Mumme K, Stonehouse W. Effects of medium-chain triglycerides on weight loss and body composition: a meta-analysis of randomized controlled trials. Journal of the Academy of Nutrition and Dietetics 2015;115:249-263. PMID 25636220. DOI 10.1016/j.jand.2014.10.022. https://pubmed.ncbi.nlm.nih.gov/25636220/
148. Wolfe RR. Branched-chain amino acids and muscle protein synthesis in humans: myth or reality?. Journal of the International Society of Sports Nutrition 2017;14:30. PMID 28852372. DOI 10.1186/s12970-017-0184-9. https://pubmed.ncbi.nlm.nih.gov/28852372/
149. Manore MM. Dietary supplements for improving body composition and reducing body weight: where is the evidence?. International journal of sport nutrition and exercise metabolism 2012;22:139-154. PMID 22465867. DOI 10.1123/ijsnem.22.2.139. https://pubmed.ncbi.nlm.nih.gov/22465867/
150. Stubbs BJ, Cox PJ, Evans RD, et al.. On the Metabolism of Exogenous Ketones in Humans. Frontiers in physiology 2017;8:848. PMID 29163194. DOI 10.3389/fphys.2017.00848. https://pubmed.ncbi.nlm.nih.gov/29163194/
151. Garrison SR, Korownyk CS, Kolber MR, et al.. Magnesium for skeletal muscle cramps. The Cochrane database of systematic reviews 2020;9:CD009402. PMID 32956536. DOI 10.1002/14651858.cd009402.pub3. https://pubmed.ncbi.nlm.nih.gov/32956536/
152. Zibellini J, Seimon RV, Lee CM, et al.. Does Diet-Induced Weight Loss Lead to Bone Loss in Overweight or Obese Adults? A Systematic Review and Meta-Analysis of Clinical Trials. Journal of bone and mineral research : the official journal of the American Society for Bone and Mineral Research 2015;30:2168-2178. PMID 26012544. DOI 10.1002/jbmr.2564. https://pubmed.ncbi.nlm.nih.gov/26012544/
153. Villareal DT, Chode S, Parimi N, et al.. Weight loss, exercise, or both and physical function in obese older adults. The New England journal of medicine 2011;364:1218-1229. PMID 21449785. DOI 10.1056/nejmoa1008234. https://pubmed.ncbi.nlm.nih.gov/21449785/
154. Shams-White MM, Chung M, Du M, et al.. Dietary protein and bone health: a systematic review and meta-analysis from the National Osteoporosis Foundation. The American journal of clinical nutrition 2017;105:1528-1543. PMID 28404575. DOI 10.3945/ajcn.116.145110. https://pubmed.ncbi.nlm.nih.gov/28404575/
155. Rogers PJ, Hogenkamp PS, de Graaf C, et al.. Does low-energy sweetener consumption affect energy intake and body weight? A systematic review, including meta-analyses, of the evidence from human and animal studies. International journal of obesity (2005) 2016;40:381-394. PMID 26365102. DOI 10.1038/ijo.2015.177. https://pubmed.ncbi.nlm.nih.gov/26365102/
156. McGlynn ND, Khan TA, Wang L, et al.. Association of Low- and No-Calorie Sweetened Beverages as a Replacement for Sugar-Sweetened Beverages With Body Weight and Cardiometabolic Risk: A Systematic Review and Meta-analysis. JAMA network open 2022;5:e222092. PMID 35285920. DOI 10.1001/jamanetworkopen.2022.2092. https://pubmed.ncbi.nlm.nih.gov/35285920/
157. Azad MB, Abou-Setta AM, Chauhan BF, et al.. Nonnutritive sweeteners and cardiometabolic health: a systematic review and meta-analysis of randomized controlled trials and prospective cohort studies. CMAJ : Canadian Medical Association journal = journal de l'Association medicale canadienne 2017;189:E929-E939. PMID 28716847. DOI 10.1503/cmaj.161390. https://pubmed.ncbi.nlm.nih.gov/28716847/
158. Romo-Romo A, Aguilar-Salinas CA, Brito-Córdova GX, et al.. Effects of the Non-Nutritive Sweeteners on Glucose Metabolism and Appetite Regulating Hormones: Systematic Review of Observational Prospective Studies and Clinical Trials. PloS one 2016;11:e0161264. PMID 27537496. DOI 10.1371/journal.pone.0161264. https://pubmed.ncbi.nlm.nih.gov/27537496/
159. Suez J, Cohen Y, Valdés-Mas R, et al.. Personalized microbiome-driven effects of non-nutritive sweeteners on human glucose tolerance. Cell 2022;185:3307-3328.e19. PMID 35987213. DOI 10.1016/j.cell.2022.07.016. https://pubmed.ncbi.nlm.nih.gov/35987213/
160. Mullins AP, Arjmandi BH. Health Benefits of Plant-Based Nutrition: Focus on Beans in Cardiometabolic Diseases. Nutrients 2021;13:519. PMID 33562498. DOI 10.3390/nu13020519. https://pubmed.ncbi.nlm.nih.gov/33562498/
161. Cummings JH, Pomare EW, Branch WJ, et al.. Short chain fatty acids in human large intestine, portal, hepatic and venous blood. Gut 1987;28:1221-1227. PMID 3678950. DOI 10.1136/gut.28.10.1221. https://pubmed.ncbi.nlm.nih.gov/3678950/
162. Visser FW, Krikken JA, Muntinga JH, et al.. Rise in extracellular fluid volume during high sodium depends on BMI in healthy men. Obesity (Silver Spring, Md.) 2009;17:1684-1688. PMID 19282825. DOI 10.1038/oby.2009.61. https://pubmed.ncbi.nlm.nih.gov/19282825/
163. van den Bosch JJJON, Hessels NR, Visser FW, et al.. Plasma sodium, extracellular fluid volume, and blood pressure in healthy men. Physiological reports 2021;9:e15103. PMID 34921521. DOI 10.14814/phy2.15103. https://pubmed.ncbi.nlm.nih.gov/34921521/
164. Krikken JA, Dallinga-Thie GM, Navis G, et al.. Short term dietary sodium restriction decreases HDL cholesterol, apolipoprotein A-I and high molecular weight adiponectin in healthy young men: relationships with renal hemodynamics and RAAS activation. Nutrition, metabolism, and cardiovascular diseases : NMCD 2012;22:35-41. PMID 20678904. DOI 10.1016/j.numecd.2010.03.010. https://pubmed.ncbi.nlm.nih.gov/20678904/
