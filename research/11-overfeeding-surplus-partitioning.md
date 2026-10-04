# 11 — Energy Surplus: Where the Extra Energy Goes (overfeeding, "bulking", refeeds, cheat days)

> Dossier for the Vitals mechanistic engine. Owner topic: partitioning of **positive** energy balance
> by macronutrient, surplus size, duration and resistance-training (RT) status; short surpluses inside a diet;
> post-diet fat overshoot. Plugs into the energy-balance core of dossier 01 (Hall-type model).
> Cross-references: 01 (core energy-balance ODEs), 02 (TEF/NEAT/adaptive thermogenesis), 03 (protein/MPS),
> 04 (glycogen, DNL, insulin), 05 (fat oxidation), 06 (lipids, liver fat), 09 (hypertrophy rates),
> 12 (leptin, appetite, refeeds), 13 (transitions, water/glycogen transients), 14 (regional fat), 15 (alcohol,
> sodium, gut), 16 (sex/age), 17 (safety), 19 (performance).

**Ten numbers to remember**

| # | Finding | Value | Source |
|---|---------|-------|--------|
| 1 | Long mixed-diet overfeeding, sedentary young men: fraction of excess energy stored | 63 % (range ≈ 40–100 %) over 100 d | Bouchard 1990 [1] |
| 2 | Pooled across controlled mixed overfeeding studies | 60–90 % stored | Joosen & Westerterp 2006 [15] |
| 3 | Composition of weight gained, sedentary | 60–67 % fat / 33–40 % FFM (Forbes pooled: 38–44 % LBM) | [14][15] |
| 4 | Excess energy needed per kg gained | 8.05 kcal/g (33.7 kJ/g), pooled n = 48 | Forbes 1986 [14] |
| 5 | CHO vs fat overfeeding (+50 %, 14 d): energy stored | CHO 75–85 %, fat 90–95 % | Horton 1995 [4] |
| 6 | Dietary fat intake does not raise fat oxidation; fat balance tracks energy balance | r = 0.96 | Schutz 1989 [17] |
| 7 | Glycogen capacity before net DNL; max DNL | ≈15 g/kg BW, ≈500 g gain; ≈150 g fat/d from ≈475 g CHO/d | Acheson 1988 [5] |
| 8 | Protein content of surplus (5/15/25 % E, +954 kcal/d, 8 wk) | same fat gain (3.4–3.7 kg); LBM −0.7 / +2.9 / +3.2 kg | Bray 2012 [8] |
| 9 | Adaptive (unexplained) EE rise after 8 wk +40 % | SMR +43 ± 123, 24-h EE +23 ± 139 kcal/d | Johannsen 2019 [13] |
| 10 | NEAT response variance to +1000 kcal/d × 8 wk | NEAT −98 to +692 kcal/d; fat gain 0.36–4.23 kg (10-fold) | Levine 1999 [9] |

---

## 1. Scope

This dossier quantifies the fate of energy eaten above maintenance: how much is dissipated (TEF, tissue-synthesis
cost, higher RMR/activity cost of a heavier body, facultative/adaptive thermogenesis incl. NEAT), and how the
stored remainder is split between glycogen (+ bound water), fat (incl. de novo lipogenesis, DNL) and lean tissue,
as a function of the macronutrient that supplies the surplus, surplus size and duration, protein intake,
resistance training (novice/trained), initial fatness, sex and age. It also covers short surpluses (1–7 d,
cheat days, refeeds inside a diet), the scale-weight transient, rapid insulin-sensitivity changes, regional
(visceral/liver) deposition, post-diet fat overshoot, and a complete **daily surplus-partitioning rule set** that
plugs into the energy-balance model of dossier 01.

---

## 2. State variables

| Name | Unit | Typical range | Represents | Initial-value rule |
|------|------|---------------|------------|--------------------|
| `FM` | kg | 3–80 | Fat mass = stored triglyceride (lipid), as measured by DXA/4C | From 14 (body-composition estimate) |
| `LT` | kg | 30–90 | Lean *tissue* excluding glycogen, glycogen-bound water and transient ECF (muscle, organs, adipose non-lipid matrix) | FFM₀ − G₀·(1+w_G) − ECF_excess₀ |
| `G` | kg | 0.15–1.2 | Whole-body glycogen (liver + muscle) | 0.5 kg on mixed diet (Hall 2011 [30]); lower after low-CHO/deficit (04) |
| `W_G` | kg | 0.4–4 | Water bound to glycogen = w_G·G | w_G·G₀ |
| `ECF_x` | kg | −2 to +2 | Extracellular fluid deviation from sodium/CHO changes | 0 (owned by 13/15) |
| `GUT` | kg | 0.2–1.5 | Gut content mass (food/stool in transit) | 0 deviation (UNVERIFIED model; owned by 15) |
| `AT_OF` | kcal/d | −150 to +700 | Adaptive/facultative thermogenesis in surplus (incl. NEAT rise) | 0 |
| `EI_ref` | kcal/d | 1200–4500 | Reference (weight-stable) intake used to define "surplus" | 14-day EMA of intake while weight-stable, or computed TDEE (02) |
| `CHO_ref` | g/d | 50–600 | Habitual CHO intake at energy balance (for facultative CHO thermogenesis) | 14-day EMA of CHO intake |
| `EB7` | kcal/d | −1500 to +2500 | 7-day EMA of energy balance (EI − EE before tissue deposition) — drives RT-lean modulation h(EB) | 0 |
| `CEB3` | kcal | −6000 to +9000 | 3-day cumulative energy balance (leptin short-term signal, → 12) | 0 |
| `DNL_net` | g fat/d | 0–200 | Net whole-body lipogenesis (CHO overflow) | 0 |
| `VAT`, `UBSQ`, `LBSQ` | kg | — | Regional fat pools (visceral, upper-body SC, lower-body SC) | From 14 |
| `IHTG` | % liver fat | 0.5–30 | Intrahepatic triglyceride | From 06/14 |
| `IS_rel` | ratio | 0.4–1.3 | Insulin sensitivity relative to personal baseline (acute-surplus component only; chronic part from 04/06) | 1.0 |
| `FM_pre`, `FFM_pre`, `pctFat_pre` | kg, kg, % | — | Body composition at start of the most recent deficit phase (memory for overshoot rule) | Set when a deficit phase starts |
| `Pm_SS` | fraction | 0.1–0.8 | Mass partition ratio of the last loss: ΔFFM_loss/ΔW_loss | Updated during deficit |
| `D_F` | fraction | 0–0.8 | Fractional fat depletion vs FM_pre | (FM_pre − FM)/FM_pre |

Body (scale) weight: `BW = FM + LT + G·(1 + w_G) + ECF_x + GUT` (GUT, ECF_x as deviations).

---

## 3. Inputs that drive it

| Input | Unit | How it enters |
|-------|------|---------------|
| Protein intake `P` | g/d (and g/kg) | Energy; TEF 20–30 %; oxidation-first; sets sedentary lean fraction m_P; RT lean via 03/09 |
| Net digestible carbohydrate `C` (with sugar, fructose split) | g/d | Energy; TEF 5–10 %; glycogen filling; CHO overflow → DNL; facultative thermogenesis; fructose → hepatic DNL/liver fat, VAT modifier |
| Fat `F` with SFA/MUFA/PUFA fractions | g/d | Energy; TEF 0–3 %; stored almost 1:1 when surplus; fat type modifies liver fat, VAT, lean fraction (Rosqvist) |
| Alcohol `A` | g/d | Oxidised first; TEF ≈ 10–30 %; suppresses fat oxidation (→ 15) |
| Energy intake `EI` vs `EI_ref` | kcal/d | Surplus size S_raw = EI − EE (defines everything below) |
| Resistance-training stimulus `s_RT` | 0–1 | From 09 (volume/intensity/frequency); switches lean accretion from "sedentary surplus" mode to "RT" mode |
| Training status | novice/intermediate/advanced | From 09 → G_RT (max lean gain rate) |
| Steps / aerobic exercise | steps/d, kcal | EE (10); acute exercise protects insulin sensitivity in surplus (Walhin 2013) |
| Sex, age | — | Regional deposition (women more leg uptake), post-overfeeding compensation (older men do not compensate), lean regain in older women |
| Sodium | mg/d | ECF transient on high-intake days (→ 15/13) |
| Prior deficit history | — | Overshoot memory (FM_pre, Pm_SS, D_F) |

---

## 4. Mechanisms & equations

### 4.1 Energy-accounting frame and the classic controlled-overfeeding dataset

**Mechanism.** Energy eaten above expenditure cannot vanish: it is either dissipated as heat (TEF, cost of
synthesising new tissue, the higher maintenance cost of a larger body, facultative/adaptive thermogenesis incl.
NEAT) or stored (glycogen, triglyceride, protein-containing lean tissue). Across well-controlled studies the
dissipated part is modest on average (≈10–40 %) but varies several-fold between individuals.

**Master balance (extends Hall 2011 eq. 3/5 [30]; all terms kcal/d):**

```
EI − [EE_base(FM, LT, BW) + TEF + TH_C + AT_OF + C_DNL]
      = ρG·dG/dt + (ρF + ηF)·dFM/dt + (ρL + ηL)·dLT/dt
```

`EE_base = K + γF·FM + γL·LT + δ·BW (+ exercise EE from 10)`. The left bracket before tissue terms is
`EE_pre`; the right side is the stored energy `S`.

| Symbol | Value | Unit | Uncertainty | Source |
|--------|-------|------|-------------|--------|
| ρF (energy density of fat) | 39.5 MJ/kg = 9 441 kcal/kg | kcal/kg | Bouchard used 9 300 | Hall 2011 appendix [30]; [1] |
| ρL (energy density of lean tissue) | 7.6 MJ/kg = 1 816 kcal/kg | kcal/kg | Bouchard used 1 020 | [30] |
| ηF (biochemical cost of fat deposition) | 750 kJ/kg = 179 kcal/kg | kcal/kg | ≈2 % of ρF | [30][31] |
| ηL (cost of lean/protein deposition) | 960 kJ/kg = 229 kcal/kg | kcal/kg | Joosen quotes 29.4 MJ/kg *protein* | [30][31][15] |
| ρG (energy density of glycogen) | 17.6 MJ/kg = 4 207 kcal/kg | kcal/kg | — | [30] |
| γF, γL (RMR per kg fat / lean) | 13 and 92 kJ/kg/d = 3.1 and 22 kcal/kg/d | kcal/kg/d | ±20 % | [30] (owned by 02) |
| δ (activity cost per kg BW) | ≈30 kJ/kg/d ≈ 7 kcal/kg/d (sedentary) | kcal/kg/d | PAL-dependent | [30] (owned by 02/10) |

**Classic overfeeding studies (calibration set).** "Stored %" is as reported, or *derived* here from reported
ΔFM/ΔFFM with Hall densities (marked d). "kcal/kg" = total excess energy ÷ weight gained.

| Study | Subjects | Surplus / duration / diet (P/F/C %E) | ΔBW kg | ΔFM kg | ΔFFM kg | % excess stored | kcal excess per kg gained |
|-------|----------|--------------------------------------|--------|--------|---------|-----------------|---------------------------|
| Bouchard 1990 [1] | 24 M (12 MZ pairs), BMI 19.7, FM₀ 6.9 kg | +1000 kcal/d, 84 of 100 d (84 000 kcal); 15/35/50 | 8.1 ± 2.4 (4.3–13.3) | 5.4 | 2.7 | 63 (body energy 497 → 719 MJ of 353 MJ excess); ≈40–100 % individually | 10 370 |
| Levine 1999 [9][15] | 12 M + 4 F nonobese | +1000 kcal/d × 56 d; 20/40/40 | 4.7 ± 1.8 | 0.36–4.23 (range) | — | 45 (432 stored vs 531 kcal/d dissipated) | 11 900 |
| Diaz 1992 [11] | 9 M (6 lean, 3 overweight) | +50 % (6.2 ± 1.9 MJ/d) × 42 d, total 265 ± 45 MJ; 12/42/46 | 7.6 ± 1.6 | ≈4.4 (58 ± 18 % fat) | ≈3.2 | 75 (d) | 8 340 |
| Johannsen 2019 [13] | 29 M + 6 F, BMI 25.6 | +1158 ± 205 kcal/d (+40 %) × 56 d; 15/44/41 | 7.5 ± 1.9 | 4.2 ± 1.4 | ≈3.3 | ≈70 (d) | 8 650 |
| Bray 2012, 5 % P [8] | 25 M/F, BMI 19–30 (8/grp) | +954 kcal/d × 56 d, inpatient | 3.16 | 3.66 | LBM −0.70 | — | 16 900 |
| Bray 2012, 15 % P | " | " (139 g P/d) | 6.05 | 3.45 | LBM +2.87 | ≈71 (d) | 8 830 |
| Bray 2012, 25 % P | " | " (228 g P/d) | 6.51 | 3.44 | LBM +3.18 | ≈72 (d) | 8 210 |
| Roberts 1990 [19] | 7 young M | +1011 kcal/d × 21 d | 2.5 | — | — | 85–90 (87 % of stored energy as fat, 13 % protein) | — |
| Ravussin 1985 [18] | 5 young M | ×1.6 (+8 010 kJ/d) × 9 d; 15/40/45 | 3.2 | ≈1.8 (56 % fat) | ≈1.4 | 75 | ≈5 380 |
| Horton 1995 [4] | 9 lean + 7 obese M | +50 % as pure CHO or pure fat, 14 d each | ≈2.7 | — | — | CHO 75–85; fat 90–95 | — |
| Lammert 2000 [12] | 10 M pairs | +5 MJ/d × 21 d CHO-rich vs fat-rich | 1.5 | 0.9 | 0.6 | no CHO vs fat difference in fat gain | — |
| Jebb 1996 [16] | 3 lean M (chamber) | +33 % (16.5 MJ/d) × 12 d | 2.90 | — | — | fat balance = 74.1 % of imbalance; TEE +6.2 % | — |
| Siervo 2008 [21] | 6 lean M | 3 wk each at +20, +40, +60 % (17-wk protocol) | 5.98 | 3.31 | — | "no effective dissipation": 11.6–13.1 % unaccounted | — |
| Forbes 1986 [14] | 13 F + 2 M (own) + 33 literature | 79–159 MJ over ≈3 wk (own) | 4.4 ± 0.6 (own) | — | ≈50 % of gain (own, ⁴⁰K) | — | 6 700 (own, 3 wk); 8 050 pooled n = 48 |
| Pasquet 1992 [22] | 9 lean Cameroonian M | Guru Walla, 955 ± 252 MJ, 61–65 d, mostly CHO | 17 ± 4 | 64–75 % of gain | — | TEE unchanged (activity fell) | ≈13 400 |
| Tchoukalova 2010 / Votruba 2012 [69][70] | 15 M + 13 F, BMI < 26 | 8 wk ad-lib snack supplements | 4.6 ± 2.2 | 3.8 ± 1.7 | small | — | — |

**Regularities used for calibration.**
- Mean fraction of excess stored in long (≥ 6 wk) mixed-diet studies ≈ 0.70 (range of study means 0.45–0.75),
  pooled range 60–90 % [15]; shorter studies store more (75–90 %) because tissue-driven EE rise is still small.
- Excess energy per kg gained: ≈ 6.7 kcal/g at 3 wk (more water/glycogen) and 8–12 kcal/g at 6–14 wk; **the
  "3 500 kcal per lb (7 700 kcal/kg)" rule under-states the excess needed for chronic gain** (Forbes pooled
  8 050 kcal/kg [14]; Bouchard 10 370 kcal/kg [1]).
- Weight-gain CV between people 20–40 % (Bouchard SD 2.4 on 8.1 kg; Johannsen 1.9 on 7.5; Levine 1.8 on 4.7).
- Genotype: within-MZ-pair ICC ≈ 0.5 for ΔBW/ΔFM (≈0.4 for ΔFFM), ≈0.7 for visceral fat after adjusting for fat gain [1].

**Evidence grade: A** (multiple metabolic-ward overfeeding studies, a systematic review [15], and a validated
model [30]). Individual-level prediction is poor (grade C).

### 4.2 Oxidative hierarchy: substrate oxidation during a surplus

**Mechanism.** The body oxidises what it cannot store well first: alcohol (no storage) > protein (limited
storage) > carbohydrate (glycogen buffer ~0.3–1 kg) > fat (practically unlimited storage). Adding carbohydrate
or protein raises their own oxidation within days and displaces fat oxidation; adding fat does **not** raise fat
oxidation. Hence, whatever macronutrient supplies the surplus, the day-to-day surplus ends up as a positive
**fat** balance (after the glycogen buffer fills), mainly by *sparing* fat oxidation rather than by DNL.

**Quantitative anchors.**
- +106 ± 6 g fat/d (987 ± 55 kcal) for 36 h: 24-h EE 2 783 vs 2 820 kcal (ns); fat oxidation 1 032 vs
  1 042 kcal/d; fat balance vs energy balance r = 0.96, CHO balance vs energy balance r = −0.12 (Schutz 1989 [17]).
- +33 % mixed, 12-d continuous calorimetry: CHO intake 540 g/d → CHO oxidation 551 g/d at day 12, "close to
  balance by day 5"; fat oxidation 59 g/d despite 150 g/d intake; protein-oxidation changes small; fat balance
  = 74.1 % of the energy imbalance (Jebb 1996 [16]).
- 5-d phases from −50 % to +50 % CHO energy: whole-body CHO oxidation ×6 and fat oxidation −>90 % on surplus
  CHO; +50 % **fat** had no effect on HGP, DNL or fuel selection (Schwarz 1995 [35]).
- +50 % mixed, 42 d: fat oxidation suppressed 37 % in lean vs 64 % in overweight (Diaz 1992, via [15]).
- 3 d at 1.4 × basal (mixed): 24-h RER 0.857 → 0.893 (obesity-prone) and 0.852 → 0.886 (obesity-resistant);
  protein oxidation increased in both (Schmidt 2013 [25]).
- CHO at ≈2.5 × EE: RER 0.81 → 0.99 (day 1) → 1.15 (day 4) (Aarsland 1997 [36]).
- Alcohol +25 % of energy (96 ± 4 g/d): 24-h lipid oxidation −49.4 ± 6.7 g/d (−36 %); CHO and protein
  oxidation unchanged; 24-h EE +7 ± 1 % (Suter 1992 [100]).

**Equations (energy units, kcal/d; substrate split is used by 04/05 for RQ/ketones):**

```
A_ox  = 7.0·A                                  (all alcohol oxidised same day; clearance cap from 15)
P_ox  = 4·(P − 1000·f_prot·dLT/dt)             (protein not deposited is oxidised; dLT in kg/d;
                                                f_prot ≈ 0.20 kg protein per kg lean tissue — UNVERIFIED, 03 owns)
C_ox  = 4·C − ρG·dG/dt − 4·C_over              (CHO not stored as glycogen or converted by DNL is oxidised)
F_ox  = max(0, EE_total − A_ox − P_ox − C_ox)  (fat oxidation is the residual — NOT a function of fat intake)
```

Fat balance (g/d) = F + DNL_net − F_ox/9.44. Consistency check: summing all balances reproduces S of §4.1.

**Time dynamics.** CHO oxidation converges to CHO intake with an effective time constant of ≈1–1.7 d (≈95 %
by day 3–5, Jebb [16]); protein oxidation adjusts within ≈1–3 d (03 owns); fat oxidation responds only
indirectly (residual). Alcohol effect confined to the drinking period (Suter [100]).

**Moderators.** Obesity-prone / overweight: greater suppression of fat oxidation (Diaz, via [15]; Schmidt 2013
nocturnal RER rose only in obesity-prone [25]).

**Evidence grade: A** (multiple whole-room calorimetry studies agree).

### 4.3 Glycogen buffer and carbohydrate overflow

**Mechanism.** The first few hundred grams of surplus CHO go to glycogen (with ≈3 g water/g), which is why the
scale jumps after a high-CHO day. Glycogen can expand to ≈15 g/kg BW before the body must either oxidise the
rest (RQ → 1) or convert it to fat (DNL, RQ > 1).

**Equations** (glycogen dynamics owned by 04; reproduced so the overflow rule is well defined):

```
ρG·dG/dt = 4·C·(1 − (G/G_max)^8) − kG·G²         kG = 4·C_b / G₀²     (Hall 2011 form [30] + saturation term)
G_max    = 0.015 kg/kg · BW                        (Acheson 1988 [5])
W_G      = w_G · G,  w_G = 2.7 (Hall/McBride [30]); 3–4 (Kreitzman [86])
C_room   = (EE_total − A_ox − P_ox)/4              (max CHO that can be oxidised at RQ ≈ 1, g/d)
C_over   = max(0, C − C_room − ρG·(dG/dt)/4)       (g/d of CHO that must go to DNL)
```

The saturation factor `(1 − (G/G_max)^8)` is a **PROPOSED** addition (exponent chosen so storage is unimpeded
below ≈0.75·G_max and stops at G_max); Hall's quadratic alone reproduces "3 × CHO intake → ≈1.8 × glycogen" [30].
Integrate with sub-daily steps (≤ 2 h) — a 1-day Euler step overshoots. Linearised time constant
`τ_G = ρG·G₀/(2·4·C_b)` ≈ 0.9 d for G₀ = 0.5 kg, C_b = 300 g/d (derived); observed approach to CHO balance
(Jebb [16]) is somewhat slower (3–5 d), so 04 should calibrate kG dynamics.

| Parameter | Value | Unit | Uncertainty | Source |
|-----------|-------|------|-------------|--------|
| G₀ (mixed diet) | 0.5 | kg | 0.3–0.6 | [30] |
| G_max | 15 | g/kg BW | n = 3 men | Acheson 1988 [5] |
| Glycogen gain before net lipogenesis | ≈500 | g | — | [5] |
| Glycogen gain after a single 479 g starch meal | +408 ± 19 g at 5 h; +346 ± 12 g at 10 h; no net lipogenesis; TEF 5.9 % | g | n = 6 | Acheson 1982 [6] |
| Glycogen stored from 500 g CHO after 3–6 d high-fat / mixed / high-CHO diet | 278 ± 6 / 197 ± 11 / 170 ± 2 g; net lipogenesis 0.8 / 3.4 / 9 g; TEF 5.2 / 6.5 / 8.6 % | g | — | Acheson 1984 [7] |
| Water per g glycogen | 2.7 (3–4) | g/g | — | [30][86] |

**Moderators.** Prior low-CHO diet or deficit (low G) → more storage room, less DNL from a CHO load [7].
Overweight subjects: less whole-body DNL and more glycogen synthesis after CHO overfeeding [38].

**Evidence grade: B** (few, small but precise balance studies; mechanism uncontested).

### 4.4 De novo lipogenesis (DNL): quantitatively minor except in extreme CHO excess

**Mechanism.** Hepatic and adipose DNL convert glucose (and fructose) carbon to fatty acids at a large energy
cost (~25 %). In humans DNL is "not the pathway of first resort": until CHO energy intake exceeds total energy
expenditure, surplus CHO is simply oxidised in place of fat [34]. DNL matters (a) for whole-body fat balance only
under massive CHO overfeeding with full glycogen stores, and (b) qualitatively for **liver fat and VLDL-TG**
(sugar/fructose surpluses) even when its mass contribution is small (→ 06).

**Quantitative anchors.**
- Massive CHO overfeeding after glycogen depletion (3 men; 7 d; 11/3/86 % P/F/C; 3 642 → 4 930 kcal/d): once
  stores saturate, ≈150 g lipid/d synthesised from ≈475 g CHO/d, without post-absorptive hyperglycaemia [5].
  → empirical yield **0.32 g fat per g CHO**; energy efficiency ≈ 150·9.44/(475·4) ≈ 0.75 (cost ≈25 %).
- CHO ≈2.5 × EE, day 4: large whole-body net fat synthesis; hepatic secretion of DNL fat rose ≈35-fold yet was
  a small share → adipose tissue is the main site [36]. (Abstract gives day-4 net synthesis 2 243 ± 253 in units
  printed "mg·kg⁻¹·min⁻¹"; only a per-day unit is physiologically plausible, ≈157 g/d at 70 kg, consistent
  with [5] — unit **UNVERIFIED**.)
- +50 % CHO for 5 d: fractional hepatic DNL >10-fold higher but absolute hepatic DNL < 5 g FA/d [35].
- +50 % as sucrose or glucose for 96 h: DNL 2–3-fold ↑; VLDL-DNL 2 → ≤ 10 g/d vs a fat balance of ≈275 g over
  96 h; sucrose = glucose [37].
- +5 MJ/d CHO-rich for 21 d: fractional hepatic DNL 0.20 (vs 0.03 fat-rich); absolute hepatic DNL 211 g/21 d
  (≈10 g/d); whole-body DNL 332 (SEM 191) g/21 d (≈16 g/d), positive in 6/10; fat gain not different from
  fat-rich overfeeding [12].
- 4 d at 175 % energy, 71 % CHO: glucose-stimulated net DNL 35 → 156 mg/kg FFM/5 h (lean) vs 49 → 64
  (overweight) [38].
- Sugar surplus +1 000 kcal/d × 3 wk: DNL +98 %, IHTG +33 % [62]; fructose 4 g/kg/d × 6 d (143 % E): IHCL
  +102 ± 36 %, HGP +16 %, fasting lipid oxidation −100 % [68].

**Equations:**

```
DNL_net   = y_DNL · C_over                     g fat/d,  y_DNL = 0.32   (Acheson 1988)
C_DNL     = 4·C_over − 9.44·DNL_net            kcal/d heat (≈ 0.98 kcal per g overflow CHO; ≈24.5 %)
x_C       = max(0, 4·(C − CHO_ref)) / EI_ref   (CHO surplus as a fraction of maintenance energy)
DNL_hep   = DNL_hep0 · (1 + 3·x_C) · m_fruc      g FA/d (signal for 06, not an extra FM term)
            DNL_hep0 ≈ 1–2 g/d; m_fruc = 1 + 1.0·(fructose share of the CHO surplus)  — PROPOSED, grade C
```

The hepatic-DNL signal is a PROPOSED FIT to: ×2–3 at +50 % sugar (x_C ≈ 0.5 → ×2.5) [37], ×2 (+98 %) at +1 000 kcal sugar (x_C ≈ 0.4 → ×2.2) [62],
≈10 g/d at +5 MJ/d CHO [12]; it feeds liver fat/VLDL-TG in 06 and must **not** be double-counted in FM (it is
already inside the energy balance).

**Evidence grade: B** (tracer studies consistent; whole-body DNL magnitude only from small balance studies).

### 4.5 Storage efficiency and dissipation by macronutrient

**Mechanism.** Storing dietary fat as body fat costs ≈2 % of its energy; storing glucose as glycogen ≈5–7 %;
converting CHO or protein to fat ≈25 % [15][29]. Measured TEF: fat 0–3 %, CHO 5–10 %, protein 20–30 %,
alcohol 10–30 % [28][29]. A CHO surplus also raises 24-h EE beyond TEF (glycogen cycling, sympathetic
"facultative" thermogenesis [29]), whereas a fat surplus does not [39][17]. Protein surpluses raise REE
(protein turnover/lean deposition) [8], and very low-protein surpluses blunt the EE rise [8][23].

**Quantitative anchors.**
- Isoenergetic +50 % CHO vs +50 % fat, 14 d: CHO → progressive ↑ CHO oxidation and TEE, 75–85 % stored;
  fat → minimal change in fat oxidation/TEE, 90–95 % stored; difference largest early [4]. Lammert (21 d,
  +5 MJ/d) found **no** difference in fat gain and unchanged sleeping heat production [12] → the CHO-vs-fat
  difference in *fat gained* is small beyond ~2 weeks.
- +40 % as CHO for 3 d (10 lean women): 24-h EE +7 %, leptin +28 %; +40 % as fat: no change [39][107].
- 1-day 200 % overfeeding: 24-h EE +10.7 ± 5.7 % (range 2.9–18.8 %) and sleeping EE +14.4 ± 11.3 % with 20 %
  protein regardless of CHO/fat split; attenuated with 3 % protein; TEF inversely related to % body fat
  (r = −0.53) [23].
- 8 wk +954 kcal/d: REE −86 (5 % P), +160 (15 % P), +227 (25 % P) kcal/d; TEE (DLW, wk 7–8) +176 / +2 186 /
  +1 898 kJ/d as extracted from [8] (≈ +42 / +522 / +454 kcal/d; unit as reported in the paper's table —
  verify before use).

**Equations:**

```
TEF   = 0.25·(4P) + 0.075·(4C) + 0.025·(9F) + 0.20·(7A)                     kcal/d  (02 owns values)
TH_C  = φ_C · max(0, 4·(C − CHO_ref)) · 1[EI > EI_ref]                       kcal/d  (facultative CHO thermogenesis)
ΔREE_P (optional) = k_P · max(0, P − P_ref)                                   kcal/d
```

| Parameter | Value | Unit | Uncertainty | Source |
|-----------|-------|------|-------------|--------|
| TEF_P, TEF_C, TEF_F, TEF_A | 0.25, 0.075, 0.025, 0.20 | fraction | ranges 0.20–0.30, 0.05–0.10, 0–0.03, 0.10–0.30 | [28][29] |
| φ_C | 0.10 | fraction of CHO energy above habitual | 0.05–0.15 | **PROPOSED FIT**: Dirlewanger +7 % EE on +40 % CHO ≈ 17 % of CHO excess, minus TEF_C 7.5 % [39]; reproduces Horton's ≈10-point storage gap [4] |
| k_P | 0.7–1.8 (default 1.0) | kcal/d per g/d protein above reference | wide | **PROPOSED FIT** to Bray REE after removing LBM effect (22 kcal/kg): (160+86−79)/92 g = 1.8; (227−160−7)/89 g = 0.67 [8]; grade C |
| Cost of CHO → fat via DNL | 0.245 | fraction | 0.20–0.28 | [5] (empirical), [15] (theoretical ≈0.25) |

**Time dynamics.** TEF: same day. TH_C appears within 1–3 days of CHO surplus [39][4] and stops when CHO intake
returns to habitual. Horton's CHO–fat difference is largest in week 1 (glycogen filling) [4].

**Evidence grade: B** (direction robust; magnitude of TH_C from 2 small studies; Lammert discordant on fat gain).

### 4.6 Energy-expenditure response to a sustained surplus; stored vs dissipated fraction; variance

**Mechanism.** EE rises in a surplus because of (i) TEF on the extra food, (ii) synthesis costs, (iii) the RMR
of added tissue, (iv) the higher cost of moving a heavier body — all *obligatory* — and (v) a variable
*adaptive* component (NEAT/fidgeting, SNS-driven thermogenesis). On average (v) is small, but between people it
ranges from ≈0 to > 60 % of the surplus.

**Quantitative anchors.**
- Obligatory terms explain the EE rise in Diaz (BMR +0.9 ± 0.4 MJ/d; calorimeter EE +1.8 ± 0.5 MJ/d;
  "no evidence of any active energy-dissipating mechanisms") [11], Ravussin 1985 (BMR +622 kJ/d = ⅓ of the
  +2 038 kJ/d 24-h EE rise; rest TEF + cost of activity of a heavier body) [18], Roberts 1990 (no ↑ in activity
  EE or thermoregulation) [19], and Siervo 2008 (calorimeter EE +11.4 %, TEE +16.2 %, only 11.6–13.1 %
  unaccounted) [21].
- Johannsen 2019 (8 wk, +40 %): after adjustment for ΔFFM and ΔFM, SMR +43 ± 123 kcal/d (P = 0.05) and 24-h
  EE +23 ± 139 kcal/d (P = 0.34) above prediction; steps 9 601 → 9 081/d (ns); TDEE +280 ± 495 kcal/d [13].
- Levine 1999 (8 wk, +1 000 kcal/d, free-living): BMR +0.33 ± 0.53, TEF +0.58 ± 0.35, NEAT +1.38 ± 1.08 MJ/d
  (≈ +79, +139, +330 kcal/d); NEAT range −98 to +692 kcal/d; ΔNEAT vs fat gain r = 0.77 [9][15].
- Review of 16 controlled studies: 5 claimed adaptive thermogenesis, 11 did not [15]. Systematic review of PA in
  overfeeding (14 trials): EE parameters +7 to +50 %; PA parameters increased, decreased or unchanged
  inconsistently [27]. Obesity-prone adults *reduced* walking time (−2.0 % of time) after 3 d of overfeeding [26].
  Guru Walla: TEE did not rise because spontaneous activity fell 40–59 % [22][27].
- "Thrifty" phenotype: larger EE fall with fasting ↔ smaller EE rise with 200 % overfeeding (r = 0.27) [24];
  lower-than-predicted SMR after overfeeding → more fat retained 6 mo later [13].

**Equation (adaptive component; coordinate with 02 which owns deficit-side AT):**

```
dAT_OF/dt = ( β_OF,i · max(0, EI − EI_ref) − AT_OF ) / τ_OF
β_OF,i ~ Normal(0.12, 0.15²) truncated to [−0.10, 0.70]      (individual draw; population default 0.12)
τ_OF   = 14 d
```

`β_OF = 0.12` and `τ_OF = 14 d` are a **PROPOSED FIT**: with the obligatory terms of §4.1/4.5 they reproduce
the stored fractions of Bouchard (63 %), Johannsen (≈70 %), Diaz (≈75 %), Ravussin (75 %) and Roberts (85–90 %)
(see prototype check, §4.15). They are numerically close to Hall's symmetric βAT = 0.14, τ = 14 d [30]; if 02
adopts Hall's AT term for both directions, do **not** add AT_OF on top. Levine's cohort requires β ≈ 0.35–0.40
(NEAT responders); a low-NEAT individual ≈ −0.05. SD 0.15 reproduces the observed 20–40 % CV of weight gain.

**Predicted stored fraction vs duration (population default, mixed diet, sedentary; prototype):**
≈80 % at 1 wk, ≈77 % at 3 wk, ≈71 % at 8 wk, ≈65 % at 14 wk (falls because tissue-driven EE grows).

**Compensation after the surplus ends** (for 12/planner, ad-libitum mode): young men spontaneously reduced intake
by 1 991 ± 824 kJ/d after 21 d of overfeeding and lost the gain; older men did not (+1.55 ± 2.11 vs
−2.11 ± 2.18 MJ/d, P = 0.006) [19][20]. Bouchard twins lost ≈7 of 8 kg by 4 months [2]; Johannsen subjects
retained 43 ± 63 % of the gain at 6 months [13]. Free-living compensation can be large: inactive men given
≈14 500 kcal of doughnuts over 4 wk did not gain weight or fat, partly because self-reported habitual intake fell
by 239 kcal/d [102]. NEAT is the leading candidate regulatory response to overfeeding but its determinants are
unknown [106].

**Evidence grade: A** for the average (small adaptive component), **B** for the variance model, **C** for
predicting any individual.

### 4.7 Lean vs fat partitioning of a surplus WITHOUT resistance training

**Mechanism.** Even without training, a surplus adds some lean mass: the non-lipid matrix of new adipose tissue
(water, protein, stroma), larger organs and blood volume, weight-bearing muscle growth, and positive nitrogen
balance when protein intake is adequate. The lean share is roughly constant at ≈⅓–0.45 of the weight gained
(DXA/densitometry FFM, which also contains glycogen water) across studies, falls when protein intake is low, and
is lower in fatter people (Forbes' law, weaker in overfeeding than in weight loss).

**Data (lean share of weight gained, sedentary overfeeding).**

| Study | Method | FFM / ΔBW | Notes |
|-------|--------|-----------|-------|
| Bouchard 1990 [1] | hydrodensitometry | 2.7/8.1 = 0.33 | very lean young men (FM₀ 6.9 kg); CT: skeletal-muscle and adipose tissue mass rose, non-muscle LBM did not [3] |
| Forbes 1986 [14] | ⁴⁰K; pooled literature n = 48 | own ≈0.50 (3 wk); pooled 0.436 (means) / 0.384 (regression) | not explained by sex, initial weight or fat, duration, food type |
| Diaz 1992 [11] | multi-method | 0.42 | 58 ± 18 % fat |
| Ravussin 1985 [18] | densitometry | 0.44 | 9 d (includes glycogen water) |
| Roberts 1990 [19] | balance | 13 % of *stored energy* as protein | ≈0.4 of mass using ρ values of §4.1 |
| Johannsen 2019 [13] | DXA | ≈0.44 | 15 % protein |
| Siervo 2008 [21] | 4-compartment | 0.45 | lean men |
| Bray 2012 [8] | DXA | −0.22 / 0.47 / 0.49 | 5 / 15 / 25 % protein |
| Tchoukalova 2010 [69] | DXA | ≈0.17 ("FFM unchanged") | ad-lib snacks (≈15 % protein) |
| Rosqvist 2014 [59][60] | MRI (lean tissue volume) | SFA 0.32 L of 1.5 kg; PUFA 0.80 L of 1.2 kg | PUFA surplus ≈2.5 × more lean tissue |
| Pasquet 1992 [22] | — | 0.25–0.36 | massive CHO overfeeding |

Pooled mean ≈0.40 ± 0.09 (FFM incl. glycogen/fluids). After removing ≈0.3–0.8 kg of glycogen water/ECF, the
lean *tissue* share is ≈0.30–0.38.

**Equations (rule used when S > 0; RT part in §4.8):**

```
r_L   = r_AT + r_S · m_P(p) · φ_F(FM) · (1 − s_RT) · m_FA          [kg LT per kg FM deposited]
m_P(p)= clamp( (1 − exp(−(p − 0.75)/0.35)) / 0.95 , −0.3, 1.05 )   p = protein g/kg BW/d
φ_F   = min( 1, [10.4/(10.4 + FM)] / 0.45 )                          (Forbes shape, capped)
dFM/dt = S_sed / (ρF + ηF + r_L·(ρL + ηL))       dLT_sed/dt = r_L · dFM/dt
```

| Parameter | Value | Unit | Uncertainty | Source |
|-----------|-------|------|-------------|--------|
| r_AT (adipose non-lipid mass per kg lipid) | 0.20 | kg/kg | 0.15–0.25 | **UNVERIFIED** (adipose tissue ≈80–85 % lipid; 14 may refine) |
| r_S (sedentary lean tissue per kg FM at adequate protein, FM ≤ 12.7 kg) | 0.45 | kg/kg | 0.35–0.55 | **PROPOSED FIT** to table above (lean-tissue share ≈0.36–0.39 of tissue gained, excl. glycogen water). 0.45 is a compromise: fits Johannsen/Diaz/Bray FFM within ≈1 kg but over-predicts Bouchard's densitometric FFM by ≈1 kg; 0.35 does the reverse (mean abs. error 0.75 vs 0.89 kg across 5 cohorts, prototype) |
| m_P shape (0.75, 0.35) | — | g/kg | — | **PROPOSED FIT** to Bray 2012: ΔLBM ≈ 3.2·(1 − e^{−(p−0.75)/0.35}) kg gives −0.71 / +3.04 / +3.19 kg at p = 0.68 / 1.79 / 3.0 vs observed −0.70 / +2.87 / +3.18 [8] |
| φ_F cap 0.45 | — | — | — | Forbes C = 10.4 kg [30][32]; cap because overfeeding composition was not related to initial fat in Forbes' pooled data [14] |
| m_FA (fat type of surplus) | 1.0 default; PUFA-rich 1.5; SFA-rich 0.7 | — | — | Rosqvist 2014 lean young adults [59][60]; not reported in LIPOGAIN-2 [61]; grade C/D |

Note: when `p < 0.75 g/kg`, m_P < 0 shrinks lean accretion to little more than the adipose matrix
(r_L ≥ 0.2 − 0.45·0.3 ≈ 0.07). The *net* lean loss seen with 5 % protein (−0.70 kg LBM while gaining 3.66 kg fat
[8]) additionally requires 03's protein-deficiency catabolism term.

**Moderators.** Sex: no sex effect on composition of gain in Forbes' pooled data [14]; women's higher FM lowers
φ_F automatically. Age: no age effect on body-composition change with 21 d overfeeding (young vs older men) [20].
Initial fatness: via φ_F (weak). Fat type: m_FA (weak evidence).

**Time dynamics.** Fat deposition tracks daily S; lean-tissue accretion lags (protein synthesis responds over
days; 03). For simplicity apply r_L to 7-day EMA of dFM to avoid day-to-day noise in LT.

**Evidence grade: B** for the average lean share (many studies); **C** for moderators (protein effect rests
mainly on one inpatient RCT [8]; fat-type effect on one trial [59]).

### 4.8 Partitioning WITH resistance training; surplus size; training status

**Mechanism.** RT sets a ceiling on how fast muscle protein can be accreted (training status-, volume-,
protein-, sex- and age-dependent; dossier 09/03). Energy availability modulates how much of that potential is
realised: a deficit of ≈500 kcal/d abolishes lean gains on average [58], maintenance supports most of it, and a
surplus adds only a small further increment. Beyond the energy needed to build that lean tissue, extra energy is
stored as fat; larger surpluses mainly add fat, especially in trained lifters. Novices have a higher ceiling,
so more of a given surplus can be used for lean tissue.

**Trials (surplus size × RT).**

| Study | Population | Intervention | Duration | Lean outcome | Fat outcome |
|-------|-----------|--------------|----------|--------------|-------------|
| Helms 2023 [47] | 17 trained lifters (2 F), ≥ 1.8 g/kg P, RT 3×/wk | Target maintenance / +5 % / +15 %; reported intake change +169 / +489 / +719 kcal/d | 8 wk | Muscle thickness: no group effect (biceps +0.25 / +0.19 / +0.34 cm, MAIN/MOD/HIGH); ΔBM predicted biceps ΔMT weakly (R² = 0.24) | ΔBM +0.4 / +3.3 / +3.3 kg; sum 8 skinfolds −1.4 / +10.0 / +12.4 mm; ΔBM predicted Δskinfold (R² = 0.49); bench 1RM +5.7 / +7.3 / +13.4 kg |
| Garthe 2013 [49] | 39 elite athletes (≈19 y), + 4 RT sessions/wk | Dietitian-guided surplus (3 585 ± 601 kcal/d) vs ad libitum (2 964 ± 884) | 8–12 wk | LBM gain not different | BW +3.9 ± 0.6 % vs +1.5 ± 0.4 %; FM +15 ± 4 % vs +3 ± 3 % |
| Ribeiro 2019 [48] | 11 male bodybuilders (90 kg), RT 6 d/wk | 67.5 vs 50.1 kcal/kg/d (P 1.8 vs 2.0 g/kg) | 4 wk | "Muscle mass" (anthropometric equation) +1.0 kg (+2.7 %) vs +0.4 kg (+1.1 %) | body fat +7.4 % vs +0.8 % (relative) |
| Gavanda 2026 [55] | 23 resistance-trained, RT 3×/wk | Prescribed +300–500 kcal; TRE group under-ate (31.9 vs 37.5 kcal/kg target) | 12 wk | FFM +1.34 vs +1.38 kg (BIA) — no difference | BW +2.19 vs +3.90 kg; FM +2.00 vs +4.36 kg |
| Blake 2025 [56] | 17 well-trained (7 F), 2.2 g/kg P, RT 4×/wk | +10 % surplus, TRE vs normal | 8 wk | FFM +2.67 (TRE) vs +1.82 kg | FED +1.4 ± 0.6 kg more fat |
| Henselmans 2026 [57] | 20 trained men (9.7 y training) | +54 g CHO supplement (+485 kcal/d measured) vs protein-only, crossover | 8 wk × 2 | No difference in DXA lean mass, MT, CSA, strength | — |
| Spillane 2016 [54] | 21 trained men | Daily overfeeding with protein + CHO vs CHO supplement | 8 wk | Lean mass not significantly ↑ (P = 0.068), no group difference | FM ↑ in both |
| Smith 2021 [52] | 21 trained men, 4C model | High-calorie P + CHO supplement, target ≥ 0.45 kg/wk | 6 wk | FFM +4.8 ± 2.6 %; ΔBM ≈ 0.55 %/wk ↔ "all gain as FFM" (Bayes R² 0.18–0.40) | large inter-individual variability |
| Rozenek 2002 [50] | 73 untrained men, RT 4×/wk | +2 010 kcal/d supplement (CHO + P or CHO only) vs none | 8 wk | FFM +2.9 ± 3.4 / +3.4 ± 2.5 kg (vs control) | BM +3.1 kg ≈ all FFM — but +2 010 kcal/d × 56 d would predict ≈10–12 kg; intake/compensation unverifiable (weak) |
| Murphy & Koehler 2022 [58] | Meta-analysis/regression of RT in energy deficit | — | ≥ 3 wk | Lean gain ES −0.57 vs energy-sufficient control; ≈ −500 kcal/d prevents lean gain; strength unaffected | — |

Guidelines: Slater 2019 recommends a conservative surplus of ≈1 500–2 000 kJ/d (≈360–480 kcal/d) with
monitoring [51]; Iraki 2019: +10–20 % energy for ≈0.25–0.5 % BW/wk gain in novice/intermediate natural
bodybuilders, less for advanced [53].

**Equations (daily; S > 0 case; deficit case owned by 03/09):**

```
EB7   = 7-day EMA of (EI − EE_pre)                                   kcal/d
h(EB) = 1 + h_s · (1 − exp(−EB7/E_half))          if EB7 ≥ 0
      = max(0, 1 + EB7/500)                         if EB7 < 0          (Murphy & Koehler 2022 [58]; 09 may override)
L_RT  = G_RT(status, stimulus, protein, sex, age; from 09) · s_RT · h(EB)                 kg LT/d
e_RT  = L_RT · (ρL + ηL);   if e_RT > S then L_RT = S/(ρL + ηL)
S_sed = S − e_RT            → allocated by §4.7 with the (1 − s_RT) factor (only r_AT survives full training)
```

| Parameter | Value | Unit | Uncertainty | Source |
|-----------|-------|------|-------------|--------|
| h_s (max surplus bonus on RT lean gain) | 0.20 | fraction | 0–0.5 (novices possibly higher) | **PROPOSED FIT**: small/no lean benefit of +300–700 kcal in trained [47][49][55][57]; Ribeiro/Smith suggest some [48][52]; grade C |
| E_half | 300 | kcal/d | 200–500 | PROPOSED (saturation of benefit by ≈+500 kcal/d, [51][53]) |
| Deficit slope (h = 0 at) | −500 | kcal/d | ±200 | [58] meta-regression |
| G_RT placeholders (until 09 is merged) | novice 0.25, intermediate 0.10, advanced 0.05 | kg LT/wk | wide | **UNVERIFIED** placeholders; 09 owns and must replace |

**Consistency with 09.** G_RT is 09's maximal lean-accretion rate at maintenance energy and adequate protein;
this dossier only adds the energy-availability modulation h(EB) and routes the remaining surplus. With the
placeholders the prototype gives, over 8 wk at +500 kcal/d: novice ΔLT_total ≈ +2.8 kg / ΔFM +1.4 kg;
intermediate +1.5 / +1.8; advanced +1.1 / +1.9 kg (FFM includes adipose matrix and glycogen; §4.15). The
intermediate +500 kcal case gives ΔBW 3.3 kg, matching Helms' MOD/HIGH groups (+3.3 kg) [47].

**Surplus-size rule of thumb derived from the model** (2 g/kg protein): the energy *content* of the lean tissue
itself is small — 0.25 kg/wk × 2 045 kcal/kg ≈ 73 kcal/d (novice placeholder) down to ≈15 kcal/d (advanced).
Above maintenance, the h(EB) bonus is ≈+12 % at +300 kcal/d and ≈+16 % at +500 kcal/d, i.e. going from +250 to
+500 kcal/d buys ≈0.04 kg extra lean tissue per 8 wk (intermediate), whereas every additional 100 kcal/d adds
≈0.4 kg fat per 8 wk (≈71 % stored ÷ ≈10 030 kcal per kg FM incl. adipose matrix). This reproduces the trial
pattern "larger surplus → more fat, not clearly more muscle" [47][49][55][57].

**Moderators.** Training status (via G_RT). Protein: below ≈1.6 g/kg lowers G_RT (03/09). Sex/age: 09 (anabolic
resistance with age). Energy-deficit side: novices with high body fat can gain lean even in deficit
(recomposition; 03/09).

**Evidence grade: C** (small, heterogeneous trials; body-composition methods of varying validity; direction —
"bigger surplus mostly adds fat in trained lifters" — is consistent, magnitude of any lean bonus is not).

### 4.9 Where the fat goes: subcutaneous vs visceral vs liver, by macronutrient and sex

**Mechanism.** In lean adults, new fat is stored mostly subcutaneously: upper-body depots expand by adipocyte
hypertrophy, lower-body depots by hyperplasia [69]. About 10 % of fat gained goes to visceral fat on average,
but the visceral response varies from ≈0 to > 200 % between people and is strongly genetic [1]. Liver fat rises
proportionally far more than body weight and is macronutrient-sensitive: saturated fat and sugars raise it,
n-6 PUFA prevents the rise [59][61][62][67]. Women take up more meal fat into leg subcutaneous fat, especially
with high-fat meals [71][72].

**Quantitative anchors.**
- 8-wk overfeeding, 28 normal-weight adults: FM +3.8 ± 1.7 kg → upper-body SC +1.9 ± 1.0, lower-body SC
  +1.6 ± 0.8, visceral +0.4 ± 0.3 kg (shares 0.50 / 0.42 / 0.10); no significant sex difference in proportional
  regional gains; baseline meal-fat trafficking did not predict regional gain [69][70].
- CT abdominal area with ≈4–5 kg weight gain: Covassin +3.7 kg → visceral +13.8, SC +32.4 cm² (visceral 30 %
  of abdominal area gain) [73]; Gentile +4.9 kg → visceral 63 → 79, SC 158 → 187 cm² (36 %) [74]; Orr +5.1 kg
  → visceral +15, SC +30 cm² (33 %) [75]. Siervo: relative visceral increase 32.6 % vs abdominal SC 13.3 % [21].
- Bouchard twins: after adjusting for fat gained, visceral fat gain ICC ≈ 0.7 (≈6 × more variance between than
  within pairs); trunk skinfolds +85 % vs limbs +50 % [1].
- SFA vs n-6 PUFA muffins (≈750 kcal/d added [105]), 7 wk, lean young adults (subset n = 35): BW +1.5 vs +1.2 kg; liver fat +0.5 vs
  +0.03 %-points; VAT +0.21 vs +0.09 L; total body fat +1.43 vs +0.72 L; lean tissue +0.32 vs +0.80 L [59][60].
- Same design, overweight adults, 8 wk (LIPOGAIN-2): BW +2.31 vs +2.01 kg; liver fat +53 % (+1.54 %-points,
  +30 mL) with SFA vs −2 % with PUFA; no difference in VAT, pancreatic or total fat [61].
- +1 000 kcal/d for 3 wk in overweight adults: IHTG +55 % (SAT fat), +15 % (unsaturated fat), +33 % (simple
  sugars, via DNL +98 %); BW +1.4 / +0.9 / +1.4 kg; HOMA-IR +23 % and ceramides +49 % with SAT only [62].
- > 1 000 kcal/d simple sugars × 3 wk: BW +1.8 kg (+2 %), liver fat 9.2 → 11.7 % (+27 %) [67].
- 1 L/d sucrose cola × 6 mo vs isocaloric milk, diet cola, water: liver fat +132–143 %, muscle fat
  +117–221 %, visceral fat +24–31 % (relative differences), TG +32 %, total cholesterol +11 %; **total fat mass
  not different** [63].
- Fructose- vs glucose-sweetened beverages (25 % E, 10 wk): similar weight gain; VAT volume increased only with
  fructose (SC only with glucose); ↑ DNL, apoB, sdLDL, postprandial TG with fructose [64]. But hypercaloric
  fructose vs glucose (+25 % E, 2 wk): BW +1.0 vs +0.6 kg, liver TAG +1.70 vs +2.05 %-points (ns) —
  energy-mediated [65]; meta-analysis: fructose raises IHCL (SMD 0.45) and ALT (+4.94 U/L) only in hypercaloric
  trials (+21–35 % E), not isocalorically [66].
- Sex: fraction of a meal's fat stored in SC adipose at 24 h: women 38 ± 3 % vs men 24 ± 3 % [72]; women
  preferentially increase leg uptake with a high-fat meal [71]. Men gained relatively more fat (37.6 ± 5.7 % vs
  20.9 ± 1.8 % of baseline FM) in the Tchoukalova cohort [69]. SHBG fell with overfeeding in men; higher
  baseline E2/SHBG predicted less upper-body gain [76].

**Equations.**

```
Regional allocation of each day's dFM (>0):
  v   = v0 · m_VAT_macro · m_VAT_sex · m_VAT_i                 (visceral share)
  u   = 0.50·(1 − v)/0.90 ;  l = 0.40·(1 − v)/0.90               (upper-/lower-body SC shares, renormalised)
  women: shift 0.05 from u to l (lower-body preference)         — PROPOSED, grade C/D
  dVAT = v·dFM ; dUBSQ = u·dFM ; dLBSQ = l·dFM
Liver fat (relative change per day on surplus days; 06 owns absolute levels, decay and the deficit side):
  d ln(IHTG)/dt = (k_liver(mix)/100) · max(0, d(BW%)/dt)      BW% = 100·(BW − BW_ref)/BW_ref
  k_liver(mix) = Σ_i w_i · k_i over the surplus energy shares w_i (SFA, MUFA, n-6 PUFA, sugars/CHO, protein→use mixed)
  (k values below are "relative % change in IHTG per 1 % body-weight gain")
```

| Parameter | Value | Uncertainty | Source |
|-----------|-------|-------------|--------|
| v0 (visceral share of fat gain, lean adults) | 0.10 | inter-individual SD ≈0.05; range 0–0.25 | [69][70]; CT data [73][74][75] |
| m_VAT_sex | men 1.2, women 0.8 | **PROPOSED**, grade D (sex difference not significant in [70]) | [71][72] direction |
| m_VAT_macro: SFA-rich surplus | 1.5 (lean young); 1.0 (overweight) | grade C | [59] vs [61] |
| m_VAT_macro: PUFA-rich | 0.75 | grade C | [59] |
| m_VAT_macro: sugar-sweetened beverages / fructose ≥ 25 % E | 1.3 | grade C | [63][64] |
| m_VAT_i (individual) | lognormal, CV ≈0.5 | — | twin data [1] |
| k_SFA (liver, relative % per % BW gained) | ≈20–37 | — | +53 %/2.6 % [61]; +55 %/1.5 % [62]; +43 %/2.3 % [59] |
| k_MUFA/unsaturated mix | ≈15 | — | +15 %/1.0 % [62] |
| k_n6-PUFA | ≈0 | — | −2 %/2.3 % [61]; +3 %/1.8 % [59] |
| k_sugars/CHO | ≈13–22 | — | +27 %/2 % [67]; +33 %/1.5 % [62] |
| k_mixed default | 15 | — | derived |

**Time dynamics.** Liver fat responds within 1–3 weeks [62][67][68] and reverses with energy restriction (SFA-
induced rise reversed by 4 wk of ≈800 kcal/d restriction [61]; −25 % after 6 mo hypocaloric diet [67]).
Visceral fat changes over weeks; adipocyte number in lower-body fat rises after only 8 wk (hyperplasia is
long-lasting → 14) [69].

**Evidence grade: B** for regional shares and liver-fat direction by fat type/sugar; **C** for magnitudes and
sex modifiers.

### 4.10 Short-term overfeeding (1–7 days): cheat days, holidays, the scale spike, insulin sensitivity

**Mechanism.** After one or a few days of large overeating, most of the scale increase is glycogen with its
water, extra gut content and sodium-driven extracellular water; true fat gain is roughly the surplus minus TEF,
facultative thermogenesis and the energy parked in glycogen, divided by ≈10 000 kcal/kg. The non-fat parts
decay over days once intake normalises; the fat part persists unless offset by a later deficit or spontaneous
hypophagia. Insulin sensitivity falls within 2–3 days of a large surplus, before measurable fat gain, and
vigorous exercise largely prevents this.

**Quantitative anchors.**
- 3 d at +1 500 kcal/d (10 young men, 3-component model): BW +0.7 ± 0.5 kg, TBW +0.7 ± 0.4 kg, FM not
  significantly changed; weight returned to baseline within 5.0 ± 4.9 d (max ≈2 wk) [84].
- ≈6 000 kcal/d (≈50/35/15 % C/F/P) for 1 wk in healthy men: BW +3.5 kg; systemic and adipose insulin resistance
  after 2–3 d; oxidative stress and GLUT4 carbonylation; no inflammation/ER stress [77].
- +50 % × 1 wk in 32 men: BW +1.8 kg [97]. +50 % × 9 d: BW +3.2 kg, 56 % fat [18].
- Maximal single meal: 3 113 kcal (13 024 kJ) of pizza vs 1 584 kcal ad libitum; glycaemia well regulated,
  larger insulin/GLP-1/GIP/PYY responses, prolonged lethargy [104].
- Holiday period (mid-Nov → early Jan): +0.37 ± 1.52 kg; net +0.48 ± 2.22 kg by Feb/Mar, not reversed by the
  next autumn (n = 195/165) [85].
- Insulin sensitivity: 14 d of step reduction (10 000 → 1 500/d) + 50 % overfeeding: Matsuda index ↓ at day 3 and
  7, clamp glucose-infusion rate −44 % at day 14, visceral fat ↑; at day 30 (16 d after stopping) insulin
  sensitivity back to baseline while weight still elevated [79]. 7 d of +50 % with < 4 000 steps/d: OGTT insulin
  response doubled (+17 ± 16 nmol·120 min·L⁻¹); the same surplus plus 45 min/d running at 70 % VO₂max (extra
  food to match the surplus): no change (+1 ± 6) [78]. 5 d of +50 % at 60 % fat: hepatic insulin resistance
  (↑ fasting glucose/HGP), peripheral insulin action unchanged [80]. 28 d of +1 040 kcal/d (46 % fat): clamp GIR
  54.8 → 50.3 µmol·min⁻¹·kg FFM⁻¹ (−8 %); BW +0.6 kg at day 3, +2.7 kg at day 28 [81].

**Scale-weight decomposition (next morning after a surplus day):**

```
ΔBW_scale = ΔG·(1 + w_G) + ΔECF_x + ΔGUT + ΔFM + ΔLT
```

Decay after intake returns to maintenance: glycogen + bound water τ ≈ 1–2 d (4.3; 04); ECF from sodium τ ≈ 1–3 d
(13/15); gut content τ ≈ 1–2 d (**UNVERIFIED**, 15 owns); FM and LT do not decay (they require a deficit).

**Worked example (model prediction, 80 kg man, FM 16 kg, maintenance 2 500 kcal = 100 g P / 300 g C / 90 g F;
cheat day 150 g P / 700 g C / 230 g F = 5 470 kcal, surplus ≈ +2 970 kcal):**

| Term | kcal | Mass next morning |
|------|------|-------------------|
| Extra TEF (0.25·200 + 0.075·1 600 + 0.025·1 260) | 202 | — |
| Facultative CHO thermogenesis (0.10·1 600) | 160 | — |
| Adaptive term (1 day of τ = 14 d) | ≈25 | — |
| Glycogen ≈ +300 g (cf. +346 g after a 479 g starch meal [6]) | ≈1 260 | +0.30 kg glycogen + ≈0.81 kg water |
| Remainder → fat + adipose matrix (≈10 840 kcal/kg FM incl. r_L ≈ 0.6) | ≈1 320 | ≈+0.12 kg FM, +0.07 kg LT |
| Gut content, ECF (sodium) | — | ≈+0.3–1.0 and +0.3–0.9 kg (**UNVERIFIED**, food- and salt-dependent) |
| **Total** | 2 970 | **≈ +1.9 to +3.2 kg on the scale, of which ≈0.12 kg fat (≈5 %)** |

The same arithmetic for a +6 000 kcal day (glycogen room ≈400 g) gives ≈0.3–0.4 kg of fat. The prototype
reproduces Boden's 7-d +3.5 kg (model 3.9 kg), Sagayama's 3-d +0.7 kg (model 1.0 kg, excl. gut/ECF) and
Müller's 1-wk +1.8 kg (model 1.5 kg) (§4.15).

**Acute insulin-sensitivity component (04/06 own chronic IS; this is the surplus-driven acute part):**

```
x_S       = max(0, EI − EI_ref) / EI_ref
IS_target = 1 − k_IS · x_S · m_SFA · (1 − e_ex) − k_inact · 1[steps < 4 000]
dIS_rel/dt = (IS_target − IS_rel) / τ_IS      τ_IS = 2 d when falling, 5 d when recovering
```

| Parameter | Value | Uncertainty | Source |
|-----------|-------|-------------|--------|
| k_IS | 0.20 per unit x_S | 0.1–0.4 | **PROPOSED FIT**: −8 % clamp GIR at x_S ≈ 0.43 [81] |
| k_inact | 0.30 | 0.2–0.4 | **PROPOSED FIT**: −44 % GIR with x_S = 0.5 + 1 500 steps/d [79]; ≈2× OGTT insulin [78] |
| e_ex (exercise protection) | 0.9 for ≥ 45 min/d at ≈70 % VO₂max; scale linearly with daily exercise minutes | — | [78] |
| m_SFA | 1.5 if surplus is SFA-rich, else 1 | grade C | HOMA-IR +23 % with SAT only [62]; high-fat → hepatic IR [80] |
| τ_IS onset / recovery | 2 d / 5 d | — | onset 2–3 d [77][79]; recovered within 16 d [79] |

**Evidence grade:** scale decomposition **B** (glycogen/water physiology solid; gut/ECF magnitudes C); fat gain
of a single day **C** (model-derived; no direct 1-day body-composition study located); acute IS **B**.

### 4.11 Refeeds, diet breaks and cheat meals inside a diet

**Mechanism.** A refeed raises intake (usually CHO) to around or above maintenance for 1–3 days (a "diet
break" for 1–2 weeks). Physiologically it (i) refills depleted glycogen (scale ↑ 0.5–2 kg without fat),
(ii) transiently raises leptin — more with CHO than with fat — in proportion to recent cumulative energy balance,
(iii) may partly relieve adaptive thermogenesis if long enough (weeks, 02/12), and (iv) restores training
glycogen (19). Whether it improves fat loss or lean retention beyond what its effect on the average weekly energy
balance predicts is unproven in trained people; one 2-week-block design helped in men with obesity.

**Quantitative anchors.**
- Glycogen: prior high-fat diet → 278 ± 6 g of a 500 g CHO load stored as glycogen vs 170 ± 2 g after high-CHO
  diet; net lipogenesis 0.8 vs 9 g [7].
- Leptin: +40 % CHO for 3 d → fasting leptin +28 %, 24-h EE +7 %; +40 % fat → no change (10 lean women)
  [39][107]. 12 h of massive overfeeding (120 kcal/kg) → leptin +40 %, persisting to next morning [40].
  Leptin reflects cumulative 3-d energy balance: 135 ± 22 % of baseline after 3 d at 130 % TEE, 88 ± 16 % after
  3 d at 70 %; it returned to baseline only when cumulative balance was restored (n = 6) [41]. LF/HC vs HF/LC
  isoenergetic days: 24-h leptin AUC 38 ± 12 % higher with LF/HC [42]. 2 d at −62 % → leptin −27.2 %, then
  +37.6 % on day 5 after returning to ad-lib intake (as summarised in [107]).
- Campbell 2020 (27 resistance-trained adults, 7 wk, RT 4×/wk, 1.8 g/kg P): 5 d at −35 % + 2 consecutive CHO
  refeed days at maintenance vs −25 % every day: FM −2.8 vs −2.3 kg, FFM −0.4 vs −1.3 kg, dry FFM −0.2 vs
  −1.9 kg, RMR −38 vs −78 kcal/d; group × time significant only for dry FFM [87]; an independent reanalysis
  concluded only dry FFM differed [88]. Pooled leptin (n = 8) 3.9 → 1.6 ng/mL.
- ICECAP (61 resistance-trained adults, 32 F): 4 × 3 wk moderate restriction separated by 3 × 1 wk at energy
  balance vs 12 wk continuous: end FM 15.3 vs 18.0 kg (P = 0.32), FFM 56.7 vs 56.7 kg; no difference in REE,
  leptin, testosterone, IGF-1, fT3; lower hunger and desire to eat, higher PYY and satisfaction with breaks [89].
- MATADOR (51 men with obesity): 8 × 2 wk at 67 % of maintenance alternating with 7 × 2 wk at energy balance vs
  16 wk continuous: weight loss 14.1 ± 5.6 vs 9.1 ± 2.9 kg, FM loss 12.3 ± 4.8 vs 8.0 ± 4.2 kg, FFM loss similar,
  body-composition-adjusted REE fall −360 ± 502 vs −749 ± 498 kJ/d; weight change during balance blocks
  0.0 ± 0.3 kg [90].
- Scoping review of cheat meals (8 articles): compatible with weight loss; mixed for lean retention, metabolic
  adaptation and performance; improved hunger/satisfaction when framed as goal-directed; "cheating" framing
  associated with eating-disorder behaviours [91].

**Rules for the engine (no special fat-loss bonus; outcomes emerge from other modules):**
1. Energy: a refeed day is just a day with its own EI; weekly fat change follows the weekly energy balance.
2. Glycogen/water: §4.3 (room is large after deficit/low-CHO days → 0.3–0.5 kg glycogen + 0.8–1.5 kg water).
3. Leptin short-term signal for 12 (PROPOSED FIT to [39][41]):
   `leptin_ST = 1 + κ · CEB3_w / EI_ref`, with `CEB3_w` = 3-d cumulative energy balance in which surplus energy
   supplied as fat is weighted 0 and as CHO/protein 1 (deficits unweighted). κ = 0.30 for CEB3_w > 0 (range
   0.2–0.6: Dirlewanger CHO-only +28 % at 1.2·EI_ref → 0.23; Chin-Chance mixed +35 % at 0.9·EI_ref → ≈0.4
   unweighted, ≈0.6 fat-weighted) and κ = 0.13 for deficits (−12 % at −0.9·EI_ref [41]).
4. Adaptive thermogenesis relief: owned by 02 (evidence: 2-wk balance blocks in obese men reduced the adjusted REE
   fall [90]; 1-wk breaks in trained adults did not [89]).
5. Lean retention: default **no** extra effect; optional flag (grade C) reducing deficit-driven FFM loss by up to
   50 % with ≥ 2 CHO-refeed days/week in RT-trained dieters [87][88].
6. Appetite/adherence benefit (lower hunger with breaks [89]) → 12.

**Evidence grade: C** (few, small trials; heterogeneous designs; benefits mostly psychological/adherence).

### 4.12 Post-diet fat overshoot ("collateral fattening", preferential catch-up fat)

**Mechanism.** After substantial weight loss in lean people, fat is restored faster than lean tissue during
refeeding (lower lean share of regain + persistent suppressed thermogenesis), while hunger driven by the lean-mass
deficit persists until lean mass is fully restored — so fat "overshoots" its pre-diet level. The leaner the
person, the larger the lean share of the loss and the larger the overshoot. It appears only when fat depletion
is large (> ≈⅓ of initial fat); after mild restriction (≈6 % fat depletion) preferential catch-up fat was not seen.

**Quantitative anchors.**
- Minnesota Experiment (32 men; 24 wk semistarvation; original data Keys 1950 [99]): −≈25 % BW, −70 % fat, −27 % FFM (hydration-corrected);
  12 wk restricted + 8 wk ad-lib refeeding: by week 20 more weight and fat regained than lost; in the 12 men who
  completed all phases fat overshoot ≈4 kg (range 0–9 kg) while FFM was still −5 to 0 kg below baseline;
  hyperphagia persisted until FFM was restored [92][93][94][95].
- Hyperphagia during ad-lib refeeding correlated inversely with fat recovery (r = −0.6) and FFM recovery
  (r = −0.5); FFM effect independent of fat [93]. The individual's lean–fat partitioning (P-ratio) during loss
  is conserved during regain and is predicted by initial % body fat; FFM-adjusted BMR was still reduced at 12 wk
  of refeeding, in proportion to *fat* (not FFM) recovery [92].
- US Army Rangers (8 wk course, ≈1 000 kcal/d deficit, −12 % BM): 5 wk later FFM and performance recovered, FM
  above initial in all 10 men; fat overshoot ≈4–5 kg on average [96][94].
- No preferential catch-up fat after 3 wk at −50 % (≈6 % fat depletion) [97][94].
- Post-menopausal women regaining ≥ 2 kg over 12 mo after a 5-mo diet regained > ⅔ of fat lost but only ≈25 %
  of lean lost [98].

**Published model (Jacquet 2020 [95], fitted to Minnesota; validated on Rangers):**

```
Pm_SS    = (100 − %FAT0)/100 · exp(−0.015 · %FAT0)       (mass fraction of loss as FFM; c = 0.015)
γ        = 1 + a · exp(−b · %FAT0),  a = 0.92, b = 0.11   (GLM, linear-extrapolation method)
Pm_RF    = Pm_SS / γ                                      (mass fraction of regain as FFM)
FAT_overshoot (when FFM fully restored) = (γ − 1) · ΔW_SS
```

Examples (70 kg, 5 kg lost and regained): %FAT0 10 → overshoot ≈1.5 kg; 20 → ≈0.5 kg; 30 → ≈0.17 kg.

**Engine rule (PROPOSED implementation of [95] with a depletion threshold):**

```
On entering a deficit phase: store FM_pre, FFM_pre, pctFat_pre; accumulate Pm_SS = ΔFFM_loss/ΔW_loss.
On a surplus day with FFM_def = FFM_pre − FFM > 0.2 kg:
   D_F   = (FM_pre − FM)/FM_pre
   r     = clamp((D_F − 0.10)/0.20, 0, 1)                    (threshold ramp; PROPOSED from [94][97])
   γ_eff = 1 + 0.92·exp(−0.11·pctFat_pre)·r
   P_RF  = Pm_SS / γ_eff
   r_L,RF = P_RF/(1 − P_RF)                                  (FFM per kg FM during regain)
   r_L    = (1 − r)·r_L,generic(§4.7) + r·r_L,RF              (blend → no discontinuity at the threshold)
   then ADD RT lean L_RT (incl. 09 "muscle memory"), which can drive the regain composition below γ = 1.
   Keep 02's adaptive-thermogenesis state decaying with its own (slow) recovery constant.
Deactivate when FFM_def ≤ 0 or 26 wk after the deficit ended.
```

Age modifier (optional, grade C): for age ≥ 60, multiply P_RF by 0.5 during regain [98].

**Evidence grade: C** (re-analysis of one historical experiment + one small military cohort; mechanism plausible;
threshold and applicability to modest dieting uncertain).

### 4.13 Chronic mild surplus and cardiometabolic markers (hand-off to 06)

| Outcome | Change with experimental weight gain | Source |
|---------|--------------------------------------|--------|
| 24-h systolic BP | +4 mmHg (95 % CI 1.6–6.3) with +3.7 kg over 8 wk; mean BP change correlated with VAT change (ρ = 0.45) | Covassin 2018 [73] |
| Muscle sympathetic nerve activity | 32 → 38 bursts/min with +4.9 kg (42 d); SBP ↑ | Gentile 2007 [74] |
| Arterial stiffness | +13 ± 6 %, compliance −21 ± 4 % with +5.1 kg; tracked VAT gain | Orr 2008 [75] |
| Insulin | BMI 21.8 → 23.8 over 4.5 mo: basal and stimulated hyperinsulinaemia (mainly ↓ insulin clearance) | Erdmann 2008 [83] |
| Clamp insulin sensitivity | −8 % after 28 d at +1 040 kcal/d | Samocha-Bonet 2012 [81] |
| Lipids (mixed surplus) | +1 250 kcal/d × 28 d: HDL +11 ± 2 %; LDL, TG, NEFA unchanged; CRP, liver fat, ceramides ↑ | Heilbronn 2013 [82] |
| Lipids (SFA surplus) | +1 000 kcal/d × 3 wk: HDL +17 %, LDL +10 % (+0.3 ± 0.4 mmol/L), TG unchanged; unchanged with unsaturated fat or sugars | Luukkonen 2018 [62] |
| Lipids (sugary drinks) | 6 mo × 1 L/d cola: TG +32 %, total cholesterol +11 % vs controls | Maersk 2012 [63] |
| Reversal | Adverse effects of SFA surplus reversed by 4 wk energy restriction; twins' blood values normalised by 4 mo | [61][2] |

Proposed slope for 06: ΔSBP ≈ +1.1 mmHg per kg of weight gained (4/3.7), modulated by VAT share (grade B−).

### 4.14 Alcohol as surplus energy (brief; 15 owns)

Alcohol is oxidised first and cannot be stored; it is fattening indirectly by suppressing fat oxidation.
+25 % of energy as ethanol (96 g/d): lipid oxidation −49.4 g/d (−36 %), CHO/protein oxidation unchanged, 24-h EE
+7 % (≈28 % of the alcohol energy dissipated) [100]. 24 g alcohol: fractional hepatic DNL 2 → 30 % but absolute
DNL 0.8 g per 6 h (< 5 % of the dose); 77 ± 13 % of alcohol → plasma acetate; adipose NEFA release −53 %,
whole-body lipid oxidation −73 % [101]. **Rule:** count 7 kcal/g (15 may adjust), TEF_A = 0.20, A_ox = all
alcohol that day (subject to 15's clearance cap), surplus stored via spared fat oxidation (no direct DNL mass).
Grade **B**.

### 4.15 INTEGRATED DAILY SURPLUS-PARTITIONING RULE SET (plugs into dossier 01)

**Where it sits.** Dossier 01 integrates `FM`, `LT`, `G` daily from `EI − EE`. This module replaces 01's default
energy-partition function `p = C/(C + F)` **whenever the day's stored energy S > 0** (and during post-deficit
regain), supplies the macronutrient-specific dissipation terms, the glycogen overflow/DNL rule, the regional/liver
allocation, and the acute IS/leptin signals. Deficit days use 01/03/09 rules unchanged.

**Pseudo-code (TypeScript-flavoured; kcal, kg, g, days). Sub-step glycogen at ≤ 2 h.**

```ts
function surplusDay(st: State, d: DayInput, prm: Params, ext: FromOtherModules): DayResult {
  // 1. Energy intake (metabolisable; digestibility corrections from 15)
  const E_P = 4*d.P, E_C = 4*d.C, E_F = 9*d.F, E_A = 7*d.A;
  const EI  = E_P + E_C + E_F + E_A;

  // 2. Body-size-driven expenditure (01/02/10)
  const EE_base = ext.K + prm.gF*st.FM + prm.gL*st.LT + prm.delta*st.BW + ext.EE_exercise;

  // 3. Diet-driven dissipation
  const TEF  = prm.tefP*E_P + prm.tefC*E_C + prm.tefF*E_F + prm.tefA*E_A;               // 02 owns values
  const TH_C = EI > st.EI_ref ? prm.phiC*Math.max(0, E_C - 4*st.CHO_ref) : 0;              // §4.5
  if (!ext.hallATcoversSurplus)                                                           // avoid double count with 02
    st.AT_OF += (st.betaOF_i*Math.max(0, EI - st.EI_ref) - st.AT_OF)/prm.tauOF;           // §4.6
  const dREE_P = prm.kP*Math.max(0, d.P - st.P_ref);                                      // optional, §4.5
  let EE_pre = EE_base + TEF + TH_C + st.AT_OF + dREE_P;

  // 4. Glycogen (04 owns kinetics; saturation at G_max = 0.015*BW)
  const dG = glycogenStep(st.G, d.C, st.BW, prm);                                          // kg/d, sub-stepped

  // 5. CHO overflow -> net DNL (whole body)
  const C_room  = Math.max(0, (EE_pre - E_A - E_P)/4);                                     // g/d oxidisable at RQ≈1
  const C_over  = Math.max(0, d.C - C_room - prm.rhoG*dG/4);
  const DNL_net = prm.yDNL*C_over;                                                         // g fat/d (0.32 g/g)
  const C_DNL   = 4*C_over - 9.44*DNL_net;                                                 // heat, kcal/d
  EE_pre += C_DNL;

  // 6. Energy left for tissue
  const S = EI - EE_pre - prm.rhoG*dG;
  st.EB7  = ema(st.EB7, EI - EE_pre, 7);
  st.CEB3 = sum3d(st, weightedSurplus(d, EI, EE_pre));                                    // for 12 (leptin)

  let dFM = 0, dLT = 0;
  if (S > 0) {
    // 7a. RT-driven lean (09 supplies G_RT; this module supplies h(EB))
    const h = st.EB7 >= 0 ? 1 + prm.hs*(1 - Math.exp(-st.EB7/prm.Ehalf))
                          : Math.max(0, 1 + st.EB7/500);
    let L_RT = d.sRT * ext.G_RT * h;                                                       // kg/d
    if (L_RT*(prm.rhoL + prm.etaL) > S) L_RT = S/(prm.rhoL + prm.etaL);
    const S_sed = S - L_RT*(prm.rhoL + prm.etaL);
    // 7b. Remaining surplus: fat + adipose matrix + sedentary lean (§4.7) or refeed rule (§4.12)
    const rL_gen = prm.rAT + prm.rS*mP(d.P/st.BW)*phiF(st.FM)*(1 - d.sRT)*mFA(d);
    const rL = overshootActive(st) ? blendRefeed(st, rL_gen)   /* (1-r)*rL_gen + r*P_RF/(1-P_RF), §4.12 */
                                   : rL_gen;
    dFM = S_sed/(prm.rhoF + prm.etaF + rL*(prm.rhoL + prm.etaL));
    dLT = L_RT + rL*dFM;
  } else {
    ({dFM, dLT} = ext.deficitPartition(S, st, d));                                         // 01/03/09
  }

  // 8. Book-keeping
  st.FM += dFM; st.LT += dLT; st.G += dG;
  allocateRegional(st, dFM, d);            // §4.9: VAT/UBSQ/LBSQ shares; liver fat via k_liver
  updateAcuteIS(st, EI, d);                // §4.10
  updateOvershootMemory(st, dFM, dLT);     // §4.12
  return { dFM, dLT, dG, DNL_net, TEF, TH_C, AT_OF: st.AT_OF, EE_total: EE_pre, S };
}
```

**Substrate split for RQ/ketosis modules (04/05):** `A_ox = E_A`; `P_ox = E_P − 4000·f_prot·dLT`;
`C_ox = E_C − ρG·dG − 4·C_over`; `F_ox = max(0, EE_pre − A_ox − P_ox − C_ox)`.

**Master parameter table (defaults for the average person; individual draws where given).**

| Symbol | Default | Range / SD | Unit | Grade | Source |
|--------|---------|-----------|------|-------|--------|
| ρF, ηF | 9 441, 179 | — | kcal/kg | A | [30][31] |
| ρL, ηL | 1 816, 229 | — | kcal/kg | B | [30][31] |
| ρG | 4 207 | — | kcal/kg | A | [30] |
| TEF_P / C / F / A | 0.25 / 0.075 / 0.025 / 0.20 | 0.20–0.30 / 0.05–0.10 / 0–0.03 / 0.10–0.30 | fraction | A | [28][29] |
| φ_C | 0.10 | 0.05–0.15 | fraction | C | fit [39][4] |
| β_OF (population) | 0.12 | individual SD 0.15, truncate [−0.10, 0.70] | fraction of surplus | B | fit [1][11][13][18][19]; [9] |
| τ_OF | 14 | 7–28 | d | C | [30] |
| k_P | 1.0 (optional) | 0.7–1.8 | kcal/d per g/d | C | fit [8] |
| G_max | 0.015·BW | ±30 % | kg | B | [5] |
| w_G | 2.7 | 2.7–4 | g/g | B | [30][86] |
| y_DNL | 0.32 | 0.28–0.36 | g fat/g CHO | B | [5] |
| r_AT | 0.20 | 0.15–0.25 | kg/kg FM | UNVERIFIED | — |
| r_S | 0.45 | 0.35–0.55 | kg/kg FM | B/C | fit, §4.7 |
| m_P(p) | (1 − e^{−(p−0.75)/0.35})/0.95, clamp [−0.3, 1.05] | — | — | C | fit [8] |
| φ_F(FM) | min(1, 10.4/(10.4+FM)/0.45) | — | — | C | [14][30] |
| h_s, E_half | 0.20, 300 kcal/d | 0–0.5, 200–500 | — | C | fit [47][49][55][57] |
| RT deficit cut-off | −500 | ±200 | kcal/d | B | [58] |
| G_RT | from 09 | — | kg/d | — | 09 |
| v0 (visceral share) | 0.10 | SD 0.05 | fraction | B | [69][70] |
| k_liver (mixed / SFA / unsat / n-6 PUFA / sugars) | 15 / 28 / 15 / 0 / 18 | ± 50 % | rel % per % BW | C | [59][61][62][67] |
| k_IS, k_inact, τ_IS | 0.20, 0.30, 2 d (on) / 5 d (off) | — | — | C | fit [78][79][81] |
| κ (leptin, surplus/deficit) | 0.30 / 0.13 | 0.2–0.6 / — | per EI_ref of CEB3_w | C | fit [39][41] |
| Overshoot a, b, c | 0.92, 0.11, 0.015 | — | — | C | [95] |
| Overshoot threshold D_F | ramp 0.10 → 0.30 | — | fraction | D | [94][97] |

**Prototype check of this rule set** (author's Python implementation of the equations above with Hall 2011
constants, sedentary δ = 7 kcal/kg/d, population defaults; gut/ECF compartments *excluded*; observed values from
the cited papers):

| Scenario | Model ΔBW / ΔFM / ΔFFM (kg), % stored | Observed |
|----------|---------------------------------------|----------|
| Bouchard: +1 000 kcal/d, 84/100 d, lean men | 8.9 / 5.2 / 3.7, 65 % | 8.1 / 5.4 / 2.7, 63 % [1] |
| Johannsen: +1 158 kcal/d, 56 d | 7.1 / 4.4 / 2.7, 72 % | 7.5 / 4.2 / ≈3.3, ≈70 % [13] |
| Diaz: +50 %, 42 d | 7.4 / 4.3 / 3.1, 73 % | 7.6 / ≈4.4 / ≈3.2 [11] |
| Bray 15 % protein: +954 kcal/d, 56 d | 6.0 / 3.8 / 2.1, 75 % | 6.05 / 3.45 / 2.87 (DXA LBM) [8] |
| Bray 25 % protein | 5.5 / 3.6 / 1.9, 71 % | 6.51 / 3.44 / 3.18 [8] |
| Bray 5 % protein | 5.2 / 4.4 / 0.8 | 3.16 / 3.66 / −0.70 — **not reproduced** (protein-deficiency catabolism and blunted EE, see §10) |
| Horton: +50 % as CHO vs fat, 14 d | stored 74 % vs 89 % | 75–85 % vs 90–95 % [4] |
| Levine: +1 000 kcal/d, 56 d, β = 0.12 / 0.35 | 6.3 / 4.9 kg; stored 70 % / 54 % | 4.7 ± 1.8 kg; 45 % [9] |
| Ravussin: ×1.6, 9 d | 2.7 kg, 80 % | 3.2 kg, 75 % [18] |
| Roberts: +1 011 kcal/d, 21 d | 2.7 kg, 77 % | 2.5 kg, 85–90 % [19] |
| Boden: ≈6 000 vs 2 600 kcal/d, 7 d | 3.9 kg | 3.5 kg [77] |
| Sagayama: +1 500 kcal/d, 3 d | 1.0 kg (FM +0.3) | 0.7 kg, FM ns [84] |
| Müller: +50 %, 7 d | 1.5 kg | 1.8 kg [97] |
| RT intermediate (G_RT 0.10 kg/wk), +500 kcal/d, 8 wk | 3.3 / 1.8 / 1.5 | Helms MOD/HIGH ΔBM +3.3 kg [47] |

Note: the model omits gut content and sodium-driven ECF, which explains most short-study under-predictions of
ΔBW (Jebb 12 d: model 1.7 kg vs 2.90 kg observed [16]).

**Numerical notes.** (1) Glycogen: implicit or ≤ 2-h sub-steps (stiff quadratic). (2) Apply r_L to a 7-day EMA
of dFM to avoid LT noise from day-to-day S flips. (3) Guarantee energy closure every day:
`EI − EE_pre − ρG·dG − (ρF+ηF)·dFM − (ρL+ηL)·dLT = 0` (unit test). (4) β_OF,i is sampled once per simulated
person (Monte-Carlo band in the UI); the default curve uses the mean.

---

## 5. Interactions with other subsystems

| Module | This dossier NEEDS from it | This dossier GIVES to it |
|--------|----------------------------|--------------------------|
| 01 core energy balance | Integrator, K, body-size EE, deficit partition | Surplus partition (replaces p = C/(C+F) when S > 0), DNL heat, TH_C, AT_OF, regain/overshoot rule; energy-closure identity |
| 02 energy expenditure | TEF coefficients, maintenance EE (EI_ref), deficit-side adaptive thermogenesis (Hall βAT = 0.14, τ = 14 d [30]) | Surplus-side adaptive term β_OF (or confirmation that 02's symmetric AT covers it), facultative CHO thermogenesis, protein REE term, individual NEAT-responder distribution |
| 03 protein/MPS | Protein adequacy, f_prot, protein-deficiency catabolism (Bray 5 % group) | m_P(p) sedentary lean fraction; protein deposition for P_ox |
| 04 carbohydrate/glycogen | Glycogen kinetics, G₀, hepatic glucose output, chronic IS | G_max = 15 g/kg, overflow → DNL rule (y = 0.32 g/g, 24.5 % cost), hepatic-DNL signal, acute IS component |
| 05 fat oxidation/ketosis | — | F_ox as residual; surplus days (esp. CHO) suppress fat oxidation → ketosis exit (RQ ↑) |
| 06 lipids/liver | Absolute IHTG model, lipid responses | k_liver by macronutrient of surplus; hepatic-DNL signal; BP slope (+1.1 mmHg/kg); HDL/LDL/TG anchors for surplus |
| 07 timing | — | Note: TRE during bulking lowered fat gain mainly through lower intake [55][56] |
| 09 hypertrophy | G_RT(status, stimulus, sex, age), muscle memory | Energy-availability modulation h(EB); routing of surplus beyond lean needs to fat |
| 10 cardio | Exercise EE | Exercise protects IS during surplus (e_ex) [78] |
| 12 hormones/appetite | Leptin model, hunger, adherence | CEB3-based short-term leptin multiplier (CHO-weighted), post-overfeeding hypophagia (young) vs none (old) [19][20]; leptin tracks fat gained, not NEAT [10] |
| 13 transitions | ECF/water transients | Glycogen+water spike and decay after refeeds/cheat days |
| 14 anthropometrics | Initial FM, regional fat, adipose matrix fraction | v0, SC upper/lower shares; hyperplasia in lower-body fat after 8 wk [69]; "personal fat threshold"/adipose expandability concept [103] |
| 15 micronutrients/substances | Digestibility, sodium→ECF, gut transit, alcohol clearance | Alcohol oxidation-first rule and TEF_A |
| 16 modifiers | Sex/age effects | Sex-specific regional shares (weak); older adults do not compensate after overeating [20]; older women regain less lean [98] |
| 17 safety | Thresholds | Warnings listed in §9 |
| 18 planner | — | "Lean-gain vs fat-gain" trade-off curve; overshoot risk for lean dieters |
| 19 performance | — | Glycogen restoration on refeed days; bench-strength signal with larger surplus (weak) [47] |

Modelling lineage: Hall's 2006 semistarvation/refeeding model [33] already contains glycogen-dependent DNL and
reproduces Minnesota refeeding; this dossier's overflow and overshoot rules are simplified, data-anchored
stand-ins compatible with Hall 2011 [30].

---

## 6. Output metrics for the UI / planner goals

| Metric | Unit | Direction of good | Computation | Grade |
|--------|------|-------------------|-------------|-------|
| Fat gained from surplus (period) | kg | ↓ (unless goal is weight gain) | Σ dFM over S > 0 days | B |
| Lean tissue gained | kg | ↑ | Σ dLT (split: RT-driven vs sedentary/adipose matrix) | C |
| Gain quality (lean share of weight gained) | % | ↑ | ΔLT/(ΔLT + ΔFM) over the period | C |
| Surplus storage efficiency | % of cumulative surplus stored | ↓ for fat-avoidance | Σ S / Σ (EI − EI_ref) | B |
| Energy cost per kg gained | kcal/kg | informational | Σ (EI − EI_ref)/ΔBW | B |
| Rate of weight gain | % BW/wk | target 0.25–0.5 % (novice/intermediate) [53] | 7-day slope of BW | B |
| Scale-weight decomposition | kg | informational | glycogen + water, ECF, gut, FM, LT | B/C |
| "True fat from last cheat day" | kg | ↓ | dFM of that day(s) | C |
| Glycogen status | g, % of G_max | informational (performance) | G, G/G_max | B |
| DNL (net) | g/d | ↓ | DNL_net | B |
| Visceral fat change | kg | ↓ | Σ v·dFM | B/C |
| Liver fat relative change | % | ↓ | IHTG trajectory | C |
| Acute insulin-sensitivity index | relative | ↑ | IS_rel | C |
| Adaptive thermogenesis in surplus | kcal/d | informational | AT_OF | B |
| Short-term leptin index | relative | informational (12) | leptin_ST | C |
| Fat-overshoot risk if regained ad libitum | kg | ↓ | (γ_eff − 1)·ΔW_SS | C |

---

## 7. Validation targets (engine must reproduce within tolerance)

1. **Bouchard 1990 [1] — long mixed surplus, lean sedentary men.** 24 men (BMI 19.7, FM 6.9 kg), +1 000 kcal/d on
   84 of 100 days, 50/35/15 % C/F/P. Target: ΔBW 8.1 kg (±1.5), ΔFM 5.4 kg (±1.0), ΔFFM 2.7 kg (±1.0), stored
   energy 63 % of 84 000 kcal (±8 points). With β_OF,i ~ N(0.12, 0.15) the simulated ΔBW SD should be ≈2–3 kg
   (observed 2.4; range 4.3–13.3).
2. **Bray 2012 [8] — protein content of surplus.** +954 kcal/d × 56 d, inpatient, 15 % vs 25 % protein
   (139 vs 228 g/d): ΔFM 3.45 vs 3.44 kg (engine: difference < 0.3 kg, each within ±0.6 kg); ΔLBM +2.87 vs
   +3.18 kg (engine ΔFFM incl. glycogen + water ≥ 1.8 kg; defaults give 2.1 / 1.9 kg, i.e. ≈1 kg below DXA — see
   §10); ΔREE +160 vs +227 kcal/d (engine with k_P on: within ±80).
3. **Horton 1995 [4] — CHO vs fat surplus.** +50 % of maintenance for 14 d as pure CHO or pure fat (lean + obese
   men): energy stored 75–85 % (CHO) vs 90–95 % (fat); engine difference ≥ 8 percentage points, fat-surplus
   storage ≥ 88 %.
4. **Jebb 1996 [16] + Schutz 1989 [17] — oxidative hierarchy.** +33 % mixed × 12 d: CHO oxidation within 5 % of
   CHO intake (540 g/d) by day 5; fat oxidation ≈59 g/d despite 150 g/d intake; fat balance 70–80 % of the energy
   imbalance. +987 kcal fat for 36 h: fat oxidation change < 5 %, 24-h EE change < 2 %.
5. **Acheson 1988 [5] / 1982 [6] — glycogen capacity and DNL.** 70 kg man after glycogen depletion, 7 d at
   3 642 → 4 930 kcal/d with 86 % CHO: glycogen rises ≈500 g before net DNL > 0; by days 5–7 net DNL ≈150 g/d
   (±40). Single 479 g starch meal from a mixed diet: glycogen +300–410 g within 10 h, net DNL ≈ 0.
6. **Johannsen 2019 [13] + Levine 1999 [9] — EE response and its variance.** +1 158 kcal/d × 56 d: ΔBW 7.5 kg
   (±1.5), ΔFM 4.2 (±1.0); unexplained 24-h EE ≤ +100 kcal/d on average. Levine (+1 000 kcal/d × 56 d, free
   living): population distribution of fat gain spanning ≈0.4–4.2 kg; a β_OF,i ≈ 0.35 individual stores ≈45–55 %.
7. **Helms 2023 [47] / Garthe 2013 [49] — RT with surplus.** Trained lifters, ≥ 1.8 g/kg protein, 8 wk RT: +≈500–
   700 kcal/d → ΔBW ≈ +3.3 kg with ΔFM ≥ ΔLT, vs maintenance ΔBW ≈ +0.4 kg; the between-group difference in
   DXA-equivalent FFM (LT + glycogen water) must be < 0.8 kg while the fat difference is > 1 kg (prototype: 0.75
   vs 1.85 kg; Garthe: FM +15 % vs +3 %, LBM not different).
8. **Short-term surplus (Sagayama 2014 [84], Boden 2015 [77]) and post-diet regain (Jacquet 2020 [95]).**
   3 d at +1 500 kcal/d: ΔBW +0.7 kg (engine with gut/ECF 0.6–1.2 kg), ΔFM ≤ 0.35 kg, return to baseline weight
   in ≤ 7 d at maintenance. 7 d at ≈6 000 kcal/d: ΔBW +3.5 kg (±1.0); acute IS index below 0.85 by day 3.
   Regain after a Minnesota-like loss (%FAT₀ 14, ΔW_SS 17 kg, FFM fully restored): fat overshoot ≈3.4 kg
   (observed mean ≈4 kg, range 0–9 [94][95]).

Secondary checks: regional shares of 3.8 kg fat gain = 1.9 upper SC / 1.6 lower SC / 0.4 visceral [70];
SFA vs PUFA surplus liver fat +53 % vs −2 % at ≈2.2 kg gain [61]; 24-h SBP +4 mmHg for +3.7 kg [73].

---

## 8. Myths / contested claims

| Claim | Evidence | Verdict |
|-------|----------|---------|
| "Excess protein can't be stored as fat; protein overfeeding doesn't make you fatter." | Inpatient RCT: fat gain identical (3.44–3.66 kg) at 5, 15 and 25 % protein during +954 kcal/d [8]. Antonio's trials in trained lifters (4.4 g/kg; 3.4 g/kg; 1-y crossover) found no fat gain despite +≈800 kcal/d **self-reported**, free-living, BodPod [43][44][45][46] — 8 wk at a true +800 kcal/d would store ≈3 kg even at protein's 25 % TEF, so under-reporting of baseline intake or compensation is the likely explanation. | Myth. Protein changes *lean* gain and EE, not fat gain, when energy is truly in surplus. |
| "Carbs are uniquely fattening because they turn into fat (DNL)." | DNL < 5–10 g/d unless CHO energy > TEE [34][35][37]; CHO surplus is if anything *less* efficiently stored than fat surplus [4]; fat gain from CHO surplus occurs by sparing fat oxidation [16][17]. | Myth (except extreme CHO excess with full glycogen [5]). |
| "A 6 000 kcal cheat day adds 2–3 kg of fat." | Scale gain is mostly glycogen + water + gut + ECF; fat ≈ (surplus − TEF − glycogen)/≈10 000 kcal/kg ≈ 0.3–0.4 kg; 3 d at +1 500 kcal/d showed no measurable FM change and weight normalised in ≈5 d [84]. | Myth (but the fat part is real and cumulative). |
| "Metabolism speeds up to burn off excess calories (luxuskonsumption)." | Average unexplained EE rise small (Johannsen +23–43 kcal/d; Diaz none; Siervo 12 % unaccounted) [11][13][21]; large in *some* people via NEAT [9]. | Mostly myth for the average person; real for "NEAT responders". |
| "Bigger surplus = more muscle." | Trained lifters: larger surplus mainly adds fat [47][49][55][57]; one pilot in bodybuilders suggests more muscle with much higher intake [48]; Smith 2021 found ≈0.55 %/wk gain compatible with mostly FFM but with poor predictability [52]. | Largely myth beyond a modest surplus; possibly less true for novices. |
| "You must eat in a surplus to build muscle." | Maintenance supports most RT gains; ≈500 kcal/d deficit abolishes them on average [58]. | Partly true: avoid deficits > ≈500 kcal/d; surplus helps little. |
| "3 500 kcal = 1 lb of weight gained." | Pooled overfeeding: 8.05 kcal/g (≈3 650 kcal/lb) [14]; long studies 8–12 kcal/g [1][13]; short ones lower (water). | Myth for chronic gain; depends on duration and composition. |
| "Refeeds/cheat days reset leptin and metabolism and accelerate fat loss." | Leptin rises transiently with CHO surplus (+28 % after 3 d) and falls again [39][41]; no fat-loss advantage with 1-wk breaks in trained adults [89]; 2-d refeeds: only dry FFM better (contested) [87][88]; 2-wk balance blocks helped men with obesity [90]. | Unproven for fat loss in lean/trained people; may help adherence/hunger. |
| "Fructose is uniquely fattening regardless of calories." | Isocaloric fructose: no effect on liver fat/ALT; hypercaloric: ↑ [66][65]; but in free-living 10-wk trials fructose (not glucose) raised VAT, DNL and atherogenic lipids [64]. | Contested; the dominant driver is excess energy; fructose adds hepatic/VAT specificity. |
| "Weight regained after a diet has the same composition as the weight lost." | In lean people after large losses, fat recovers first and overshoots [92][95][96]; older women regain mostly fat [98]. | Myth for large losses in lean people; minor for mild diets [97]. |

---

## 9. Safety bounds

- **Rate of gain.** Sustained gain > ≈0.5 % BW/wk in trained lifters is mostly fat (skinfolds rise, muscle
  thickness does not [47]; individual exceptions [52]); > 1 % BW/wk in anyone is predominantly fat with rising
  liver fat and insulin resistance [62][79]; the planner must not prescribe surpluses > ≈+20 % of
  maintenance (or > ≈+500 kcal/d) for body-composition goals [51][53]; the simulator may run larger surpluses but
  must warn.
- **Single-day extremes.** Days > ≈2 × maintenance: warn (insulin resistance develops within 2–3 d of repeated
  extreme days [77]; maximal single meals ≈3 100 kcal were tolerated metabolically by healthy young men but caused
  prolonged lethargy [104]; threshold is expert opinion, grade D).
- **Metabolic disease.** For users with NAFLD, T2D/prediabetes, dyslipidaemia or hypertension, flag SFA-rich and
  sugar-sweetened-beverage surpluses (liver fat +33–55 % in 3 wk; TG +32 % over 6 mo) [62][63]; any surplus raises
  BP (+≈1 mmHg/kg) [73] and arterial stiffness [75].
- **Inactivity + surplus.** Combined surplus and < 4 000 steps/d halves insulin sensitivity within 1–2 wk
  [78][79]; recommend daily exercise (45 min at ≈70 % VO₂max prevented it [78]).
- **Cheat-day framing.** Avoid "cheat"/reward framing; associated with eating-disorder behaviours [91]; planner
  refeeds should be ≤ maintenance + ≈30 % and goal-framed.
- **Weight cycling in lean users** (athletes making weight, aesthetic dieters < ≈15 % BF men / < ≈25 % BF women):
  warn about fat overshoot on regain; the planner should prefer slow controlled regain with RT and high protein
  [94][95][96].
- **Older adults.** No spontaneous compensation after overeating → weight ratchet [20]; older women regain mostly
  fat [98].
- **Alcohol-based surpluses:** defer to 15/17.
- Pregnancy, adolescents, eating disorders, underweight (BMI < 18.5) rehabilitation: out of scope → 17.

---

## 10. Open questions / weakest assumptions

1. **Individual dissipation (β_OF).** Population mean well constrained; which individual is a "NEAT responder" is
   not predictable from simple inputs (twin ICC ≈ 0.5 [1]). UI must show a band, not a point.
2. **Lean bonus of a surplus under RT (h_s)** rests on small trials with skinfolds, BIA or anthropometric
   equations [47][48][49][55]; 4C data (Smith 2021) disagree in part [52]. Grade C.
3. **Placeholders for G_RT** (novice/intermediate/advanced) are UNVERIFIED until dossier 09 supplies them.
4. **Adipose non-lipid mass per kg fat (r_AT = 0.20)** UNVERIFIED; affects the FFM share of sedentary gain.
5. **Bray low-protein group** (−0.70 kg LBM, no EE rise, 3.16 kg gain) is not reproduced; energy accounting with
   standard densities does not close for that group, and protein-deficiency catabolism is 03's domain.
6. **Glycogen kinetics**: Hall's quadratic implies τ ≈ 1 d; calorimetry shows CHO balance by day 3–5 [16].
   Saturation exponent in the overflow rule is a PROPOSED form.
7. **Gut content and ECF** magnitudes after large meals are UNVERIFIED here (15/13).
8. **Fat overshoot threshold** (fat depletion ≥ ≈10–30 %) and transfer from starvation/military data to modest
   dieting is uncertain [94][97]; the a, b constants come from 12 men [95].
9. **Liver-fat coefficients** differ between lean-young and overweight-middle-aged cohorts [59][61]; few trials,
   short durations.
10. **Women and older adults** are under-represented in overfeeding studies (most cohorts are young men);
    sex-specific regional modifiers are grade D.
11. **Horton vs Lammert**: whether CHO vs fat surpluses produce different *fat* gains beyond 2 weeks is unresolved
    [4][12]; the model yields a ≈10-point storage difference driven by TH_C.
12. **Long-term persistence**: overfeeding-induced adipocyte hyperplasia in lower-body fat [69] may make gains
    harder to reverse; Bouchard 5-y follow-up found no persistent effect beyond age-related gain [2].
13. **Self-reported intake** in free-living surplus studies (Antonio, Helms, Gavanda) undermines surplus-size
    estimates; prefer inpatient data for calibration.

---

## 11. References

(URL = https://pubmed.ncbi.nlm.nih.gov/PMID/ unless stated.)

1. Bouchard C, Tremblay A, Després JP, Nadeau A, Lupien PJ, Thériault G, et al. The response to long-term overfeeding in identical twins. N Engl J Med. 1990;322:1477–82. PMID 2336074. doi:10.1056/NEJM199005243222101
2. Bouchard C, Tremblay A, Després JP, Nadeau A, Lupien PJ, Moorjani S, et al. Overfeeding in identical twins: 5-year postoverfeeding results. Metabolism. 1996;45:1042–50. PMID 8769366. doi:10.1016/s0026-0495(96)90277-2
3. Dériaz O, Fournier G, Tremblay A, Després JP, Bouchard C. Lean-body-mass composition and resting energy expenditure before and after long-term overfeeding. Am J Clin Nutr. 1992;56:840–7. PMID 1415002. doi:10.1093/ajcn/56.5.840
4. Horton TJ, Drougas H, Brachey A, Reed GW, Peters JC, Hill JO. Fat and carbohydrate overfeeding in humans: different effects on energy storage. Am J Clin Nutr. 1995;62:19–29. PMID 7598063. doi:10.1093/ajcn/62.1.19
5. Acheson KJ, Schutz Y, Bessard T, Anantharaman K, Flatt JP, Jéquier E. Glycogen storage capacity and de novo lipogenesis during massive carbohydrate overfeeding in man. Am J Clin Nutr. 1988;48:240–7. PMID 3165600. doi:10.1093/ajcn/48.2.240
6. Acheson KJ, Flatt JP, Jéquier E. Glycogen synthesis versus lipogenesis after a 500 gram carbohydrate meal in man. Metabolism. 1982;31:1234–40. PMID 6755166. doi:10.1016/0026-0495(82)90010-5
7. Acheson KJ, Schutz Y, Bessard T, Ravussin E, Jéquier E, Flatt JP. Nutritional influences on lipogenesis and thermogenesis after a carbohydrate meal. Am J Physiol. 1984;246:E62–70. PMID 6696064. doi:10.1152/ajpendo.1984.246.1.E62
8. Bray GA, Smith SR, de Jonge L, Xie H, Rood J, Martin CK, et al. Effect of dietary protein content on weight gain, energy expenditure, and body composition during overeating: a randomized controlled trial. JAMA. 2012;307:47–55. PMID 22215165. doi:10.1001/jama.2011.1918. Full text: https://pmc.ncbi.nlm.nih.gov/articles/PMC3777747/
9. Levine JA, Eberhardt NL, Jensen MD. Role of nonexercise activity thermogenesis in resistance to fat gain in humans. Science. 1999;283:212–4. PMID 9880251. doi:10.1126/science.283.5399.212
10. Levine JA, Eberhardt NL, Jensen MD. Leptin responses to overfeeding: relationship with body fat and nonexercise activity thermogenesis. J Clin Endocrinol Metab. 1999;84:2751–4. PMID 10443673. doi:10.1210/jcem.84.8.5910
11. Diaz EO, Prentice AM, Goldberg GR, Murgatroyd PR, Coward WA. Metabolic response to experimental overfeeding in lean and overweight healthy volunteers. Am J Clin Nutr. 1992;56:641–55. PMID 1414963. doi:10.1093/ajcn/56.4.641
12. Lammert O, Grunnet N, Faber P, Bjørnsbo KS, Dich J, Larsen LO, et al. Effects of isoenergetic overfeeding of either carbohydrate or fat in young men. Br J Nutr. 2000;84:233–45. PMID 11029975.
13. Johannsen DL, Marlatt KL, Conley KE, Smith SR, Ravussin E. Metabolic adaptation is not observed after 8 weeks of overfeeding but energy expenditure variability is associated with weight recovery. Am J Clin Nutr. 2019;110:805–13. PMID 31204775. doi:10.1093/ajcn/nqz108. https://pmc.ncbi.nlm.nih.gov/articles/PMC6766445/
14. Forbes GB, Brown MR, Welle SL, Lipinski BA. Deliberate overfeeding in women and men: energy cost and composition of the weight gain. Br J Nutr. 1986;56:1–9. PMID 3479191. doi:10.1079/bjn19860080
15. Joosen AM, Westerterp KR. Energy expenditure during overfeeding. Nutr Metab (Lond). 2006;3:25. PMID 16836744. doi:10.1186/1743-7075-3-25. https://pmc.ncbi.nlm.nih.gov/articles/PMC1543621/
16. Jebb SA, Prentice AM, Goldberg GR, Murgatroyd PR, Black AE, Coward WA. Changes in macronutrient balance during over- and underfeeding assessed by 12-d continuous whole-body calorimetry. Am J Clin Nutr. 1996;64:259–66. PMID 8780332. doi:10.1093/ajcn/64.3.259
17. Schutz Y, Flatt JP, Jéquier E. Failure of dietary fat intake to promote fat oxidation: a factor favoring the development of obesity. Am J Clin Nutr. 1989;50:307–14. PMID 2756918. doi:10.1093/ajcn/50.2.307
18. Ravussin E, Schutz Y, Acheson KJ, Dusmet M, Bourquin L, Jéquier E. Short-term, mixed-diet overfeeding in man: no evidence for "luxuskonsumption". Am J Physiol. 1985;249:E470–7. PMID 4061637. doi:10.1152/ajpendo.1985.249.5.E470
19. Roberts SB, Young VR, Fuss P, Fiatarone MA, Richard B, Rasmussen H, et al. Energy expenditure and subsequent nutrient intakes in overfed young men. Am J Physiol. 1990;259:R461–9. PMID 2396704. doi:10.1152/ajpregu.1990.259.3.R461
20. Roberts SB, Fuss P, Heyman MB, Evans WJ, Tsay R, Rasmussen H, et al. Control of food intake in older men. JAMA. 1994;272:1601–6. PMID 7966871. doi:10.1001/jama.1994.03520200057036
21. Siervo M, Frühbeck G, Dixon A, Goldberg GR, Coward WA, Murgatroyd PR, et al. Efficiency of autoregulatory homeostatic responses to imposed caloric excess in lean men. Am J Physiol Endocrinol Metab. 2008;294:E416–24. PMID 18042669. doi:10.1152/ajpendo.00573.2007
22. Pasquet P, Brigant L, Froment A, Koppert GA, Bard D, de Garine I, et al. Massive overfeeding and energy balance in men: the Guru Walla model. Am J Clin Nutr. 1992;56:483–90. PMID 1503058. doi:10.1093/ajcn/56.3.483
23. Thearle MS, Pannacciulli N, Bonfiglio S, Pacak K, Krakoff J. Extent and determinants of thermogenic responses to 24 hours of fasting, energy balance, and five different overfeeding diets in humans. J Clin Endocrinol Metab. 2013;98:2791–9. PMID 23666976. doi:10.1210/jc.2013-1289
24. Reinhardt M, Schlögl M, Bonfiglio S, Votruba SB, Krakoff J, Thearle MS. Lower core body temperature and greater body fat are components of a human thrifty phenotype. Int J Obes (Lond). 2016;40:754–60. PMID 26499440. doi:10.1038/ijo.2015.229
25. Schmidt SL, Kealey EH, Horton TJ, VonKaenel S, Bessesen DH. The effects of short-term overfeeding on energy expenditure and nutrient oxidation in obesity-prone and obesity-resistant individuals. Int J Obes (Lond). 2013;37:1192–7. PMID 23229737. doi:10.1038/ijo.2012.202
26. Schmidt SL, Harmon KA, Sharp TA, Kealey EH, Bessesen DH. The effects of overfeeding on spontaneous physical activity in obesity prone and obesity resistant humans. Obesity (Silver Spring). 2012;20:2186–93. PMID 22522883. doi:10.1038/oby.2012.103
27. Giroux V, Saidj S, Simon C, Laville M, Segrestin B, Mathieu ME. Physical activity, energy expenditure and sedentary parameters in overfeeding studies – a systematic review. BMC Public Health. 2018;18:903. PMID 30031374. doi:10.1186/s12889-018-5801-2
28. Westerterp KR. Diet induced thermogenesis. Nutr Metab (Lond). 2004;1:5. PMID 15507147. doi:10.1186/1743-7075-1-5
29. Tappy L. Thermic effect of food and sympathetic nervous system activity in humans. Reprod Nutr Dev. 1996;36:391–7. PMID 8878356. doi:10.1051/rnd:19960405
30. Hall KD, Sacks G, Chandramohan D, et al. Quantification of the effect of energy imbalance on bodyweight. Lancet. 2011;378:826–37 (and web appendix "Dynamic Mathematical Model of Body Weight Change in Adults"). PMID 21872751. doi:10.1016/S0140-6736(11)60812-X
31. Hall KD. Mathematical modelling of energy expenditure during tissue deposition. Br J Nutr. 2010;104:4–7. PMID 20132585. doi:10.1017/S0007114510000206
32. Hall KD. What is the required energy deficit per unit weight loss? Int J Obes (Lond). 2008;32:573–6. PMID 17848938. doi:10.1038/sj.ijo.0803720
33. Hall KD. Computational model of in vivo human energy metabolism during semistarvation and refeeding. Am J Physiol Endocrinol Metab. 2006;291:E23–37. PMID 16449298. doi:10.1152/ajpendo.00523.2005. https://pmc.ncbi.nlm.nih.gov/articles/PMC2377067/
34. Hellerstein MK. De novo lipogenesis in humans: metabolic and regulatory aspects. Eur J Clin Nutr. 1999;53 Suppl 1:S53–65. PMID 10365981. doi:10.1038/sj.ejcn.1600744
35. Schwarz JM, Neese RA, Turner S, Dare D, Hellerstein MK. Short-term alterations in carbohydrate energy intake in humans. Striking effects on hepatic glucose production, de novo lipogenesis, lipolysis, and whole-body fuel selection. J Clin Invest. 1995;96:2735–43. PMID 8675642. doi:10.1172/JCI118342
36. Aarsland A, Chinkes D, Wolfe RR. Hepatic and whole-body fat synthesis in humans during carbohydrate overfeeding. Am J Clin Nutr. 1997;65:1774–82. PMID 9174472. doi:10.1093/ajcn/65.6.1774
37. McDevitt RM, Bott SJ, Harding M, Coward WA, Bluck LJ, Prentice AM. De novo lipogenesis during controlled overfeeding with sucrose or glucose in lean and obese women. Am J Clin Nutr. 2001;74:737–46. PMID 11722954. doi:10.1093/ajcn/74.6.737
38. Minehira K, Vega N, Vidal H, Acheson K, Tappy L. Effect of carbohydrate overfeeding on whole body macronutrient metabolism and expression of lipogenic enzymes in adipose tissue of lean and overweight humans. Int J Obes Relat Metab Disord. 2004;28:1291–8. PMID 15303106. doi:10.1038/sj.ijo.0802760
39. Dirlewanger M, di Vetta V, Guenat E, Battilana P, Seematter G, Schneiter P, et al. Effects of short-term carbohydrate or fat overfeeding on energy expenditure and plasma leptin concentrations in healthy female subjects. Int J Obes Relat Metab Disord. 2000;24:1413–8. PMID 11126336. doi:10.1038/sj.ijo.0801395
40. Kolaczynski JW, Ohannesian JP, Considine RV, Marco CC, Caro JF. Response of leptin to short-term and prolonged overfeeding in humans. J Clin Endocrinol Metab. 1996;81:4162–5. PMID 8923877. doi:10.1210/jcem.81.11.8923877
41. Chin-Chance C, Polonsky KS, Schoeller DA. Twenty-four-hour leptin levels respond to cumulative short-term energy imbalance and predict subsequent intake. J Clin Endocrinol Metab. 2000;85:2685–91. PMID 10946866. doi:10.1210/jcem.85.8.6755
42. Havel PJ, Townsend R, Chaump L, Teff K. High-fat meals reduce 24-h circulating leptin concentrations in women. Diabetes. 1999;48:334–41. PMID 10334310. doi:10.2337/diabetes.48.2.334
43. Antonio J, Peacock CA, Ellerbroek A, Fromhoff B, Silver T. The effects of consuming a high protein diet (4.4 g/kg/d) on body composition in resistance-trained individuals. J Int Soc Sports Nutr. 2014;11:19. PMID 24834017. doi:10.1186/1550-2783-11-19
44. Antonio J, Ellerbroek A, Silver T, Orris S, Scheiner M, Gonzalez A, Peacock CA. A high protein diet (3.4 g/kg/d) combined with a heavy resistance training program improves body composition in healthy trained men and women – a follow-up investigation. J Int Soc Sports Nutr. 2015;12:39. PMID 26500462. doi:10.1186/s12970-015-0100-0
45. Antonio J, Ellerbroek A, Silver T, Vargas L, Tamayo A, Buehn R, Peacock CA. A high protein diet has no harmful effects: a one-year crossover study in resistance-trained males. J Nutr Metab. 2016;2016:9104792. PMID 27807480. doi:10.1155/2016/9104792
46. Leaf A, Antonio J. The effects of overfeeding on body composition: the role of macronutrient composition – a narrative review. Int J Exerc Sci. 2017;10:1275–96. PMID 29399253. https://pmc.ncbi.nlm.nih.gov/articles/PMC5786199/
47. Helms ER, Spence AJ, Sousa C, Kreiger J, Taylor S, Oranchuk DJ, et al. Effect of small and large energy surpluses on strength, muscle, and skinfold thickness in resistance-trained individuals: a parallel groups design. Sports Med Open. 2023;9:102. PMID 37914977. doi:10.1186/s40798-023-00651-y. https://pmc.ncbi.nlm.nih.gov/articles/PMC10620361/ (Table 1 labels skinfold sums "cm"; values are mm.)
48. Ribeiro AS, Nunes JP, Schoenfeld BJ, Aguiar AF, Cyrino ES. Effects of different dietary energy intake following resistance training on muscle mass and body fat in bodybuilders: a pilot study. J Hum Kinet. 2019;70:125–34. PMID 31915482. doi:10.2478/hukin-2019-0038
49. Garthe I, Raastad T, Refsnes PE, Sundgot-Borgen J. Effect of nutritional intervention on body composition and performance in elite athletes. Eur J Sport Sci. 2013;13:295–303. PMID 23679146. doi:10.1080/17461391.2011.643923
50. Rozenek R, Ward P, Long S, Garhammer J. Effects of high-calorie supplements on body composition and muscular strength following resistance training. J Sports Med Phys Fitness. 2002;42:340–7. PMID 12094125.
51. Slater GJ, Dieter BP, Marsh DJ, Helms ER, Shaw G, Iraki J. Is an energy surplus required to maximize skeletal muscle hypertrophy associated with resistance training? Front Nutr. 2019;6:131. PMID 31482093. doi:10.3389/fnut.2019.00131
52. Smith RW, Harty PS, Stratton MT, Rafi Z, Rodriguez C, Dellinger JR, et al. Predicting adaptations to resistance training plus overfeeding using Bayesian regression: a preliminary investigation. J Funct Morphol Kinesiol. 2021;6:36. PMID 33919267. doi:10.3390/jfmk6020036
53. Iraki J, Fitschen P, Espinar S, Helms E. Nutrition recommendations for bodybuilders in the off-season: a narrative review. Sports (Basel). 2019;7:154. PMID 31247944. doi:10.3390/sports7070154
54. Spillane M, Willoughby DS. Daily overfeeding from protein and/or carbohydrate supplementation for eight weeks in conjunction with resistance training does not improve body composition and muscle strength or increase markers indicative of muscle protein synthesis and myogenesis in resistance-trained males. J Sports Sci Med. 2016;15:17–25. PMID 26957922.
55. Gavanda S, Arnet L, Löffler D, Dissemond J, Havers T, Wiewelhove T, et al. Time-restricted eating during a bulking phase is associated with reduced fat accumulation, while muscle and strength gains are maintained: a 12-wk randomized controlled trial. J Nutr. 2026;156:101722. PMID 42442697. doi:10.1016/j.tjnut.2026.101722
56. Blake DT, Hamane C, Pacheco C, Henselmans M, Tinsley GM, Costa P, et al. Hypercaloric 16:8 time-restricted eating during 8 weeks of resistance exercise in well-trained men and women. J Int Soc Sports Nutr. 2025;22:2492184. PMID 40241374. doi:10.1080/15502783.2025.2492184
57. Henselmans M, Tiede DR, Plotkin DL, Mattingly ML, Harbour ER, Anglin DA, et al. Effects of modest carbohydrate-energy supplementation on resistance training adaptations in trained men: a crossover trial. Nutrients. 2026;18:1961. PMID 42356347. doi:10.3390/nu18121961
58. Murphy C, Koehler K. Energy deficiency impairs resistance training gains in lean mass but not strength: a meta-analysis and meta-regression. Scand J Med Sci Sports. 2022;32:125–37. PMID 34623696. doi:10.1111/sms.14075
59. Rosqvist F, Iggman D, Kullberg J, Cedernaes J, Johansson HE, Larsson A, et al. Overfeeding polyunsaturated and saturated fat causes distinct effects on liver and visceral fat accumulation in humans. Diabetes. 2014;63:2356–68. PMID 24550191. doi:10.2337/db13-1622
60. Elmsjö A, Rosqvist F, Engskog MK, Haglöf J, Kullberg J, Iggman D, et al. NMR-based metabolic profiling in healthy individuals overfed different types of fat: links to changes in liver fat accumulation and lean tissue mass. Nutr Diabetes. 2015;5:e182. PMID 26479316. doi:10.1038/nutd.2015.31 (Table 1: LIPOGAIN body-composition changes).
61. Rosqvist F, Kullberg J, Ståhlman M, Cedernaes J, Heurling K, Johansson HE, et al. Overeating saturated fat promotes fatty liver and ceramides compared with polyunsaturated fat: a randomized trial. J Clin Endocrinol Metab. 2019;104:6207–19. PMID 31369090. doi:10.1210/jc.2019-00160
62. Luukkonen PK, Sädevirta S, Zhou Y, Kayser B, Ali A, Ahonen L, et al. Saturated fat is more metabolically harmful for the human liver than unsaturated fat or simple sugars. Diabetes Care. 2018;41:1732–9. PMID 29844096. doi:10.2337/dc18-0071. https://pmc.ncbi.nlm.nih.gov/articles/PMC7082640/
63. Maersk M, Belza A, Stødkilde-Jørgensen H, Ringgaard S, Chabanova E, Thomsen H, et al. Sucrose-sweetened beverages increase fat storage in the liver, muscle, and visceral fat depot: a 6-mo randomized intervention study. Am J Clin Nutr. 2012;95:283–9. PMID 22205311. doi:10.3945/ajcn.111.022533
64. Stanhope KL, Schwarz JM, Keim NL, Griffen SC, Bremer AA, Graham JL, et al. Consuming fructose-sweetened, not glucose-sweetened, beverages increases visceral adiposity and lipids and decreases insulin sensitivity in overweight/obese humans. J Clin Invest. 2009;119:1322–34. PMID 19381015. doi:10.1172/JCI37385
65. Johnston RD, Stephenson MC, Crossland H, Cordon SM, Palcidi E, Cox EF, et al. No difference between high-fructose and high-glucose diets on liver triacylglycerol or biochemistry in healthy overweight men. Gastroenterology. 2013;145:1016–25. PMID 23872500. doi:10.1053/j.gastro.2013.07.012
66. Chiu S, Sievenpiper JL, de Souza RJ, Cozma AI, Mirrahimi A, Carleton AJ, et al. Effect of fructose on markers of non-alcoholic fatty liver disease (NAFLD): a systematic review and meta-analysis of controlled feeding trials. Eur J Clin Nutr. 2014;68:416–23. PMID 24569542. doi:10.1038/ejcn.2014.8
67. Sevastianova K, Santos A, Kotronen A, Hakkarainen A, Makkonen J, Silander K, et al. Effect of short-term carbohydrate overfeeding and long-term weight loss on liver fat in overweight humans. Am J Clin Nutr. 2012;96:727–34. PMID 22952180. doi:10.3945/ajcn.112.038695
68. Lecoultre V, Carrel G, Egli L, Binnert C, Boss A, MacMillan EL, et al. Coffee consumption attenuates short-term fructose-induced liver insulin resistance in healthy men. Am J Clin Nutr. 2014;99:268–75. PMID 24257718. doi:10.3945/ajcn.113.069526
69. Tchoukalova YD, Votruba SB, Tchkonia T, Giorgadze N, Kirkland JL, Jensen MD. Regional differences in cellular mechanisms of adipose tissue gain with overfeeding. Proc Natl Acad Sci U S A. 2010;107:18226–31. PMID 20921416. doi:10.1073/pnas.1005259107
70. Votruba SB, Jensen MD. Short-term regional meal fat storage in nonobese humans is not a predictor of long-term regional fat gain. Am J Physiol Endocrinol Metab. 2012;302:E1078–83. PMID 22338076. doi:10.1152/ajpendo.00414.2011
71. Votruba SB, Jensen MD. Sex-specific differences in leg fat uptake are revealed with a high-fat meal. Am J Physiol Endocrinol Metab. 2006;291:E1115–23. PMID 16803856. doi:10.1152/ajpendo.00196.2006
72. Romanski SA, Nelson RM, Jensen MD. Meal fatty acid uptake in adipose tissue: gender effects in nonobese humans. Am J Physiol Endocrinol Metab. 2000;279:E455–62. PMID 10913047. doi:10.1152/ajpendo.2000.279.2.E455
73. Covassin N, Sert-Kuniyoshi FH, Singh P, Romero-Corral A, Davison DE, Lopez-Jimenez F, et al. Experimental weight gain increases ambulatory blood pressure in healthy subjects: implications of visceral fat accumulation. Mayo Clin Proc. 2018;93:618–26. PMID 29728201. doi:10.1016/j.mayocp.2017.12.012
74. Gentile CL, Orr JS, Davy BM, Davy KP. Modest weight gain is associated with sympathetic neural activation in nonobese humans. Am J Physiol Regul Integr Comp Physiol. 2007;292:R1834–8. PMID 17218435. doi:10.1152/ajpregu.00876.2006
75. Orr JS, Gentile CL, Davy BM, Davy KP. Large artery stiffening with weight gain in humans: role of visceral fat accumulation. Hypertension. 2008;51:1519–24. PMID 18458161. doi:10.1161/HYPERTENSIONAHA.108.112946
76. Singh P, Covassin N, Sert-Kuniyoshi FH, Marlatt KL, Romero-Corral A, Davison DE, et al. Overfeeding-induced weight gain elicits decreases in sex hormone-binding globulin in healthy males – implications for body fat distribution. Physiol Rep. 2021;9:e15127. PMID 34877821. doi:10.14814/phy2.15127
77. Boden G, Homko C, Barrero CA, Stein TP, Chen X, Cheung P, et al. Excessive caloric intake acutely causes oxidative stress, GLUT4 carbonylation, and insulin resistance in healthy men. Sci Transl Med. 2015;7:304re7. PMID 26355033. doi:10.1126/scitranslmed.aac4765
78. Walhin JP, Richardson JD, Betts JA, Thompson D. Exercise counteracts the effects of short-term overfeeding and reduced physical activity independent of energy imbalance in healthy young men. J Physiol. 2013;591:6231–43. PMID 24167223. doi:10.1113/jphysiol.2013.262709
79. Knudsen SH, Hansen LS, Pedersen M, Dejgaard T, Hansen J, van Hall G, et al. Changes in insulin sensitivity precede changes in body composition during 14 days of step reduction combined with overfeeding in healthy young men. J Appl Physiol (1985). 2012;113:7–15. PMID 22556394. doi:10.1152/japplphysiol.00189.2011
80. Brøns C, Jensen CB, Storgaard H, Hiscock NJ, White A, Appel JS, et al. Impact of short-term high-fat feeding on glucose and insulin metabolism in young healthy men. J Physiol. 2009;587:2387–97. PMID 19332493. doi:10.1113/jphysiol.2009.169078
81. Samocha-Bonet D, Campbell LV, Mori TA, Croft KD, Greenfield JR, Turner N, Heilbronn LK. Overfeeding reduces insulin sensitivity and increases oxidative stress, without altering markers of mitochondrial content and function in humans. PLoS One. 2012;7:e36320. PMID 22586466. doi:10.1371/journal.pone.0036320
82. Heilbronn LK, Coster AC, Campbell LV, Greenfield JR, Lange K, Christopher MJ, et al. The effect of short-term overfeeding on serum lipids in healthy humans. Obesity (Silver Spring). 2013;21:E649–59. PMID 23640727. doi:10.1002/oby.20508
83. Erdmann J, Kallabis B, Oppel U, Sypchenko O, Wagenpfeil S, Schusdziarra V. Development of hyperinsulinemia and insulin resistance during the early stage of weight gain. Am J Physiol Endocrinol Metab. 2008;294:E568–75. PMID 18171910. doi:10.1152/ajpendo.00560.2007
84. Sagayama H, Jikumaru Y, Hirata A, Yamada Y, Yoshimura E, Ichikawa M, et al. Measurement of body composition in response to a short period of overfeeding. J Physiol Anthropol. 2014;33:29. PMID 25208693. doi:10.1186/1880-6805-33-29
85. Yanovski JA, Yanovski SZ, Sovik KN, Nguyen TT, O'Neil PM, Sebring NG. A prospective study of holiday weight gain. N Engl J Med. 2000;342:861–7. PMID 10727591. doi:10.1056/NEJM200003233421206
86. Kreitzman SN, Coxon AY, Szaz KF. Glycogen storage: illusions of easy weight loss, excessive weight regain, and distortions in estimates of body composition. Am J Clin Nutr. 1992;56(1 Suppl):292S–293S. PMID 1615908. doi:10.1093/ajcn/56.1.292S
87. Campbell BI, Aguilar D, Colenso-Semple LM, Hartke K, Fleming AR, Fox CD, et al. Intermittent energy restriction attenuates the loss of fat free mass in resistance trained individuals. A randomized controlled trial. J Funct Morphol Kinesiol. 2020;5:19. PMID 33467235. doi:10.3390/jfmk5010019. https://pmc.ncbi.nlm.nih.gov/articles/PMC7739314/
88. Peos J, Brown AW, Vorland CJ, Allison DB, Sainsbury A. Contrary to the conclusions stated in the paper, only dry fat-free mass was different between groups upon reanalysis (comment on Campbell et al. 2020). J Funct Morphol Kinesiol. 2020. PMID 33467300. https://pmc.ncbi.nlm.nih.gov/articles/PMC7739336/ (author reply: PMID 33467301)
89. Peos JJ, Helms ER, Fournier PA, Ong J, Hall C, Krieger J, Sainsbury A. Continuous versus intermittent dieting for fat loss and fat-free mass retention in resistance-trained adults: the ICECAP trial. Med Sci Sports Exerc. 2021;53:1685–98. PMID 33587549. doi:10.1249/MSS.0000000000002636
90. Byrne NM, Sainsbury A, King NA, Hills AP, Wood RE. Intermittent energy restriction improves weight loss efficiency in obese men: the MATADOR study. Int J Obes (Lond). 2018;42:129–38. PMID 28925405. doi:10.1038/ijo.2017.206
91. Tsang JH, Poon ET, Trexler ET, Wong SH, Zheng C, Sun F. The role of cheat meals in dieting: a scoping review of physiological and psychological responses. Nutr Rev. 2025;83:2240–52. PMID 40517327. doi:10.1093/nutrit/nuaf077
92. Dulloo AG, Jacquet J, Girardier L. Autoregulation of body composition during weight recovery in human: the Minnesota Experiment revisited. Int J Obes Relat Metab Disord. 1996;20:393–405. PMID 8696417.
93. Dulloo AG, Jacquet J, Girardier L. Poststarvation hyperphagia and body fat overshooting in humans: a role for feedback signals from lean and fat tissues. Am J Clin Nutr. 1997;65:717–23. PMID 9062520. doi:10.1093/ajcn/65.3.717
94. Dulloo AG, Miles-Chan JL, Schutz Y. Collateral fattening in body composition autoregulation: its determinants and significance for obesity predisposition. Eur J Clin Nutr. 2018;72:657–64. PMID 29559726. doi:10.1038/s41430-018-0138-6. https://pmc.ncbi.nlm.nih.gov/articles/PMC5945583/
95. Jacquet P, Schutz Y, Montani JP, Dulloo A. How dieting might make some fatter: modeling weight cycling toward obesity from a perspective of body composition autoregulation. Int J Obes (Lond). 2020;44:1243–53. PMID 32099104. doi:10.1038/s41366-020-0547-1. https://pmc.ncbi.nlm.nih.gov/articles/PMC7260129/
96. Nindl BC, Friedl KE, Frykman PN, et al. Physical performance and metabolic recovery among lean, healthy men following a prolonged energy deficit. Int J Sports Med. 1997;18:317–24. PMID 9298770. doi:10.1055/s-2007-972640
97. Müller MJ, Enderle J, Pourhassan M, Braun W, Eggeling B, Lagerpusch M, et al. Metabolic adaptation to caloric restriction and subsequent refeeding: the Minnesota Starvation Experiment revisited. Am J Clin Nutr. 2015;102:807–19. PMID 26399868. doi:10.3945/ajcn.115.109173
98. Beavers KM, Lyles MF, Davis CC, Wang X, Beavers DP, Nicklas BJ. Is lost lean mass from intentional weight loss recovered during weight regain in postmenopausal women? Am J Clin Nutr. 2011;94:767–74. PMID 21795437. doi:10.3945/ajcn.110.004895
99. Keys A, Brožek J, Henschel A, Mickelsen O, Taylor HL. The Biology of Human Starvation (2 vols). Minneapolis: University of Minnesota Press; 1950. (Book; data accessed via [92][94][95].)
100. Suter PM, Schutz Y, Jéquier E. The effect of ethanol on fat storage in healthy subjects. N Engl J Med. 1992;326:983–7. PMID 1545851. doi:10.1056/NEJM199204093261503
101. Siler SQ, Neese RA, Hellerstein MK. De novo lipogenesis, lipid kinetics, and whole-body lipid balances in humans after acute alcohol consumption. Am J Clin Nutr. 1999;70:928–36. PMID 10539756. doi:10.1093/ajcn/70.5.928
102. Tucker WJ, Jarrett CL, D'Lugos AC, Angadi SS, Gaesser GA. Effects of indulgent food snacking, with and without exercise training, on body weight, fat mass, and cardiometabolic risk markers in overweight and obese men. Physiol Rep. 2021;9:e15118. PMID 34816612. doi:10.14814/phy2.15118
103. Cuthbertson DJ, Steele T, Wilding JP, Halford JC, Harrold JA, Hamer M, Karpe F. What have human experimental overfeeding studies taught us about adipose tissue expansion and susceptibility to obesity and metabolic complications? Int J Obes (Lond). 2017;41:853–65. PMID 28077863. doi:10.1038/ijo.2017.4
104. Hengist A, Edinburgh RM, Davies RG, Walhin JP, Buniam J, et al. Physiological responses to maximal eating in men. Br J Nutr. 2020;124:407–17. PMID 32248846. doi:10.1017/S0007114520001270
105. Hydes T, Alam U, Cuthbertson DJ. The impact of macronutrient intake on non-alcoholic fatty liver disease (NAFLD): too much fat, too much carbohydrate, or just too many calories? Front Nutr. 2021;8:640557. PMID 33665203. doi:10.3389/fnut.2021.640557
106. Tappy L. Metabolic consequences of overfeeding in humans. Curr Opin Clin Nutr Metab Care. 2004;7:623–8. PMID 15534429. doi:10.1097/00075197-200411000-00006
107. Mendoza-Herrera K, Florio AA, Moore M, Marrero A, et al. The leptin system and diet: a mini review of the current evidence. Front Endocrinol (Lausanne). 2021;12:749050. PMID 34899599. doi:10.3389/fendo.2021.749050 (source for Dirlewanger's +40 % design and the 2-d −62 % leptin data).
