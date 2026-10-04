# 12 — Hormones, Appetite & Adherence

*Evidence dossier for the Vitals mechanistic engine. Author: research agent 12. Compiled 2026-09-30.*
*Cross-references: 01 (body-composition model), 02 (energy expenditure / adaptive thermogenesis), 03 (protein/MPS), 04 (carbohydrate, glycogen, insulin), 05 (ketosis), 07 (meal timing), 08 (IGF-1/longevity), 09 (resistance training), 10 (cardio), 13 (diet transitions, refeeds), 14 (anthropometrics), 15 (fibre, alcohol, processing), 16 (sleep, stress, sex, age), 17 (safety), 18 (planner), 19 (performance, mood, bone).*

Reading guide for implementers: every hormone is simulated **relative to the user's own baseline** (value 1.0 at t = 0) unless an absolute value is explicitly given. All dynamics use the same first-order update rule (§4.0). Numbers tagged `PROPOSED FIT` are fitted by this agent to the listed data points and are *not* published equations. `UNVERIFIED` marks a figure that could not be confirmed against a primary source during this review.

---

## 1. Scope

This module converts the day-by-day schedule (energy intake vs expenditure, macronutrients, fibre, processing, liquid calories, ketosis, meal pattern, exercise, sleep) plus the body state from module 01 into:
(a) endocrine outputs relative to baseline — leptin, ghrelin/satiety peptides, T3/rT3, cortisol, testosterone/SHBG/free T (men), a reproductive-axis stress index (women: probability of menstrual disturbance; men: testosterone suppression), GH and IGF-1, FGF21;
(b) a **hunger model** expressed in kcal-equivalents of unmet appetite, mapped to a 0–100 **Hunger Pressure Index (HPI)**; and
(c) **adherence** outputs (plan-survival probability; optional free-living "restraint-capacity" intake model) so the planner (18) can penalise regimes that are physiologically attractive but unsustainably hungry. It also summarises diet-break/refeed evidence, weight-regain physiology, rate-of-loss trade-offs and dieting mood/libido effects.

---

## 2. State variables

| Name | Unit | Typical range | Represents | Initial value rule |
|---|---|---|---|---|
| `L0` | ng/mL | men 1–15, women 3–40 | Baseline fasting leptin (absolute) | Measured value if user supplies it; else `L0 = a_sex·FM0^b_sex` (§4.1) |
| `A_lep` | – | 0.2–1.5 | Acute energy-status leptin factor | 1.0 |
| `C_lep` | – | 0.7–1.0 | Carbohydrate-availability leptin factor | 1.0 |
| `L` / `L_rel` | ng/mL / – | L_rel 0.1–1.5 | Current leptin = `L_FM·A_lep·C_lep`; relative = `L/L0` | `L0` / 1.0 |
| `L_FM_lag` | ng/mL | – | Slowly lagged fat-mass leptin (drives slow T3 recovery) | `L0` |
| `G` | – | 0.7–2.5 | Fasting ghrelin relative to baseline | 1.0 |
| `SPI` | – | 0.7–1.3 | Satiety-peptide index (PYY/GLP-1/CCK composite), relative | 1.0 |
| `T3f` | – | 0.4–1.15 | Fast (energy/carbohydrate) T3 component | 1.0 |
| `T3` | – | 0.3–1.2 | Total T3 relative = `T3f·(L_FM_lag/L0)^0.3` | 1.0 |
| `rT3` | – | 0.9–1.8 | Reverse T3 relative | 1.0 |
| `Cort` | – | 0.9–1.8 | 24-h mean cortisol relative | 1.0 |
| `n_def` | days | 0–365 | Consecutive days in deficit (u < −0.05) | 0 |
| `n_LC` | days | 0–365 | Consecutive days with net carbohydrate < 130 g | 0 |
| `Tt` | – | 0.2–1.4 | Total testosterone relative (men) | 1.0 |
| `SHBG` | – | 0.7–2.0 | SHBG relative | 1.0 |
| `FT` | pmol/L | 50–700 | Free testosterone (Vermeulen calculation) | From `TT0`, `SHBG0` |
| `R_MD` | probability/cycle | 0–1 | Female reproductive-axis state (probability of menstrual disturbance) | `P_MD*(EA0)` |
| `EA7` | kcal/kg FFM/d | 0–70 | 7-day trailing mean energy availability | EA on day 0 |
| `GH` | – | 1–5 | 24-h GH secretion relative | 1.0 |
| `IGF1` | – | 0.2–1.2 | Serum IGF-1 relative | 1.0 |
| `K_ad` | – | 0–1 | Adaptation of appetite to ketosis | 0 |
| `W_ref` | kg | – | "Defended" reference weight for appetite feedback | `W0` |
| `F` | – | 0–1 | Diet-fatigue state | 0 |
| `E_s` | kcal-eq/d | −1500–3000 | Smoothed unmet appetite ("effort") | 0 |
| `S_ex` | kcal/d | 0–1500 | Exercise energy expenditure, 14-d filtered | baseline ExEE |
| `P_surv` | probability | 0–1 | Plan-survival (adherence) probability | 1.0 |
| `E_cap` | kcal-eq/d | 0–1200 | Restraint capacity (free-living mode only) | 700 |

---

## 3. Inputs that drive it

| Input | Unit | Source module | How it enters |
|---|---|---|---|
| Energy intake `EI` (metabolisable) | kcal/d | schedule | Energy balance `u`, satiety-effective intake |
| Total energy expenditure `TEE` | kcal/d | 02 | `u = (EI − TEE)/TEE` |
| Exercise energy expenditure `ExEE` | kcal/d | 10/09 | Energy availability, exercise appetite compensation, cortisol (session) |
| Net (available) carbohydrate | g/d | schedule/04 | Leptin carb factor, T3, cortisol (low-carb), leptin overfeeding weighting |
| Protein | g/d and g/kg | schedule/03 | Satiety, IGF-1, testosterone (very high protein) |
| Fat | %E | schedule | Testosterone (low-fat), overfeeding weighting |
| Fibre (and viscosity class) | g/d | schedule/15 | Satiety term |
| Energy density of solid food | kcal/g | schedule/15 | Satiety term |
| Ultra-processed share `f_UPF` | fraction of kcal | schedule/15 | Satiety term |
| Liquid calories | kcal/d | schedule/15 | Satiety credit discount |
| Alcohol | g/d | schedule/15 | Testosterone |
| Fasting β-hydroxybutyrate `BHB` | mmol/L | 05 | Appetite attenuation, ghrelin |
| Meals per day, eating window, habitual meal clock times | count, h | schedule/07 | Meal-pattern appetite term, ghrelin entrainment |
| Sleep duration | h/night | schedule/16 | Appetite, ghrelin, cortisol, testosterone |
| Body weight `W`, fat mass `FM`, fat-free mass `FFM`, body-fat % | kg, % | 01/14 | Leptin, ghrelin, testosterone obesity factor, EA, appetite feedback |
| Fasting insulin (relative) | – | 04 | SHBG |
| Sex, menopausal status, age | – | profile/16 | Leptin constants, reproductive index, thresholds |

---

## 4. Mechanisms & equations

### 4.0 Conventions shared by all subsections

**Update rule (all first-order states).** For a state `x` with steady-state target `x*`:

```
x(t+Δt) = x(t) + (x* − x(t)) · (1 − exp(−Δt/τ)),   τ = τ_down if x* < x(t) else τ_up
```
Δt = 1 day by default; Δt = 0.25 day is allowed and recommended for fasting protocols.

**Derived drivers (computed each step):**

| Symbol | Definition | Notes |
|---|---|---|
| `u` | `(EI − TEE)/TEE`, clamped to [−1, +1] | fractional energy balance; −1 = total fast |
| `φ_L(u)` | `1 − exp(−max(0,−u)/0.20)` | saturating deficit term used by leptin |
| `φ_E(u)` | `1 − exp(−max(0,−u)/0.30)` | saturating deficit term used by T3, GH |
| `DC_L` | `max(0, 1 − carb_g/150)` | carbohydrate shortfall for leptin |
| `DC_T` | `max(0, 1 − carb_g/130)` | carbohydrate shortfall for T3/cortisol |
| `EA` | `(EI − ExEE)/FFM` (kcal·kg FFM⁻¹·d⁻¹) | Loucks' energy availability [133] |
| `K` | `BHB² / (BHB² + 0.3²)` | ketosis intensity (0.5 at BHB 0.3 mM; 0.72 at 0.48 mM) |
| `S_L(L)` | `L³/(L³ + L50³)`; `L50` = 1.0 ng/mL men, 2.5 ng/mL women | leptin "sufficiency" (threshold physiology [27][28]) |

Hormone half-lives are minutes (leptin 24.9 ± 4.4 min [8]; GH ≈ 18–20 min [140]; cortisol ≈ 108–129 min [105]), so at daily resolution the plasma level is algebraic in its drivers; the time-constants below describe how fast the *drivers* (secretion) adapt.

---

### 4.1 Leptin

**Mechanism.** Leptin is secreted by adipocytes roughly in proportion to fat mass, with women secreting ~2–3× more per unit fat than men [4][6][5]. Superimposed on this, leptin falls within hours of energy restriction — far faster and further than fat mass — and the fall tracks reduced adipocyte glucose metabolism/insulin rather than ketones: a small glucose infusion or a glucose clamp prevents the fasting fall [10][11], and changes track glucose, insulin, NEFA and BHB [18][16]. Carbohydrate (not fat) overfeeding raises leptin [13]. Leptin reflects *cumulative* short-term energy balance [14].

**(a) Baseline absolute leptin — sex-specific relation to fat mass.** `PROPOSED FIT` (power law re-expression of published sex-specific linear regressions [5]):

```
L0 = a_sex · FM0^b_sex         (ng/mL; FM in kg)
men:   a = 0.21, b = 1.14
women: a = 0.22, b = 1.36     (post-menopausal women × 0.80)
```
Data points used: Kennedy 1997 [5] regressions `leptin = 0.402·%BF − 3.087` (men) and `1.293·%BF − 24.817` (women), evaluated at men 20 %BF/80 kg (4.95 ng/mL) and 30 %BF/90 kg (8.97), women 30 %BF/70 kg (13.97) and 40 %BF/85 kg (26.9). The power form keeps values positive at low fat mass, where the linear equations go negative. Cross-checks: women ≈ 2× men at equal BMI [6]; women 17.1 vs men 5.8 ng/mL (mean, mixed cohort) [4]; normal-weight 7.5 ± 9.3 vs obese 31.3 ± 24.1 ng/mL, r = 0.85 with %BF [1]; post-menopausal BMI-adjusted leptin −21% [7]; androgens suppress leptin, explaining part of the dimorphism [2]. Absolute values are assay-dependent — use `L0` only for thresholds (`S_L`), always display relative leptin.

**(b) Fat-mass component (within-person).**
```
L_FM(t) = L0 · (FM(t)/FM0)^β,     β = 1.8  (range 1.1–2.4)
```
`PROPOSED FIT`. Within-person elasticity exceeds the cross-sectional exponent. Data points: isocaloric maintenance after 10–15% weight loss, leptin 29.2 → 14.9 ng/mL on a high-carbohydrate diet (−49%) [94]; 21.4% weight loss in obese men → −76% [12]; slow 12% loss in women → −25% (Δleptin/Δ%BF 3.6 in obese vs 0.9 ng·mL⁻¹ per %BF in lean) [3]. Leptin per kg fat stays lower during maintenance of a reduced weight in women [23].

**(c) Acute energy-status factor.**
```
A*(u) = 1 − a_max,sex · φ_L(u)                       for u ≤ 0
        a_max = 0.35 (men), 0.55 (women)
A*(u) = min(1.5, 1 + k_ov · u · (f_carb + 0.5·f_prot + 0.15·f_fat))   for u > 0,  k_ov = 1.0
τ_down = 1.5 d,  τ_up = 0.5 d
```
`f_*` = fraction of that day's energy from each macronutrient (surplus assumed to share the day's composition). `PROPOSED FIT`; data points (relative leptin, observed → model):

| Study | Condition | Observed | Model |
|---|---|---|---|
| Weigle 1997 [12] | women, 3-d fast | −62% (8.5→2.4 ng/mL) | −61% |
| Boden 1996 [10] | 52-h fast, lean / obese | −64% / −72% | −44…−56% |
| Dubuc 1998 [18] | −68% energy, 7 d, men / women | −36% / −61% | −40% / −57% |
| Doucet 2004 [19] | −800 kcal/d, 4 d, men | −36% (fat mass unchanged) | −25% |
| Keim 1998 [15] | women, ≈−30% (−2.0 MJ intake, +0.8 MJ EE), 1 wk | −54% (adiposity-adjusted) | −42% |
| Mars 2005 [17] | men, −62%, 2 d | −27% (95% CI −34 to −20) | −28% |
| Koehler 2016 [22] | exercising men, EA 15 vs 40 kcal/kg FFM, 4 d | −53 to −56% | −30% |
| Müller 2015 [98] | non-obese men, −50%, 3 wk (fat −114 g/d) | −44% | −50% |
| Chan 2003 [27] | lean men, 72-h fast | to ≈10% of baseline | −48% (**model under-predicts**) |

Overfeeding: carbohydrate overfeeding 3 d → +28% leptin, fat overfeeding → no significant change [13]; 3 d at 130% of TEE → leptin 135 ± 22% of baseline in the following eucaloric period, 88 ± 16% after 3 d at 70% [14]. Leptin returned to baseline "within 12 h of refeeding" after a 3-d fast [12] and "24 h later" after a 36-h fast [11] (model, from a 3-d-fast nadir of 0.39: 0.75 at 12 h, 0.90 at 24 h). Chin-Chance [14] found leptin stayed low during a eucaloric washout until cumulative balance was restored — the model's fast recovery does not reproduce this; see §10.

**(d) Carbohydrate-availability factor.**
```
C_lep* = 1 − 0.30 · DC_L,     τ_down = 1.5 d, τ_up = 0.5 d
```
`PROPOSED FIT`. Data: isocaloric weight-reduced maintenance, very-low-carbohydrate (10% E) vs low-fat (60% E) diet leptin 11.2 vs 14.9 ng/mL (ratio 0.75) [94]; isocaloric ketogenic vs baseline diet, 8.94 → 7.13 ng/mL (0.80) [93] (model 0.76); all-protein VLED lowers leptin more than a balanced diet at equal cumulative restriction, paralleling glucose [16]. Fasting leptin is **not** changed by fat 37→10% E for 7 weeks [12] or 31/23/14% fat [3] when carbohydrate is ample (threshold behaviour captured by the 150 g knee). High-fat/low-carbohydrate meals lower the 24-h leptin AUC by 38% [20] and fructose-sweetened meals by 21% vs glucose [21] — those are 24-h-profile effects; fasting values move less.

**(e) Output.**
```
L = L_FM · A_lep · C_lep ;   L_rel = L / L0
L_FM_lag: first-order follower of L_FM with τ = 21 d (both directions)   [used by T3, §4.3]
```
Optional sub-daily profile: diurnal amplitude 21% with zenith ≈ 24:00 and nadir 09:00–12:00, entrained to meal timing (6.5-h meal shift moves the rhythm 5–7 h; sleep deprivation does not alter it) [9].

**Parameter table**

| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| a, b (men) | 0.21, 1.14 | ng/mL, – | ±30% on L0 | fit to [5] |
| a, b (women) | 0.22, 1.36 | ng/mL, – | ±30% | fit to [5]; ratio check [4][6] |
| post-menopause factor | 0.80 | – | 0.7–0.9 | [7] |
| β | 1.8 | – | 1.1–2.4 | fit to [94][12][3] |
| a_max men / women | 0.35 / 0.55 | – | ±0.15 | fit to [18][19][17][15][12] |
| u-scale | 0.20 | – | 0.1–0.35 | fit |
| τ_down / τ_up | 1.5 / 0.5 | d | ±50% | [11][12] |
| carbohydrate coefficient / knee | 0.30 / 150 g | – | 0.2–0.4 / 100–200 g | [94][93][16] |
| k_ov | 1.0 | – | 0.5–1.5 | [13][14] |
| leptin t½ | 24.9 ± 4.4 | min | – | [8] |

**Time dynamics.** Onset within 12 h of a fast; nadir ≈36 h (short fast) [11]; ~−50–65% by 2–3 days of total fasting [10][12]; most of the energy-status fall in a moderate deficit occurs in the first week, before meaningful fat loss (−57% at 1 week with only 0.5% weight loss is quoted by [37] from [15]). Recovery on return to maintenance: 12–24 h for the acute component [11][12]; the fat-mass component recovers only as fat is regained (fitness competitors: leptin back to baseline after 3–4 months of increased intake [137]).

**Downstream links (from replacement studies).** Restoring leptin to pre-loss levels in people holding a 10% reduced weight reversed the fall in 24-h EE, non-resting EE, skeletal-muscle work efficiency, SNS tone, T3 and T4 [25][26]; resting EE beyond body-composition prediction was not affected [26]. In lean men fasting 72 h, replacement-dose leptin prevented the fall in testosterone and LH pulsatility and partly the TSH fall, but not the changes in T3/rT3, cortisol, GH or fuel use [27]. In hypothalamic amenorrhoea, leptin raised LH pulse frequency within 2 weeks and produced ovulatory cycles in 3/8 women [28]. Leptin changes between weight plateaus did not correlate with EE changes [23]. Mouse precedent [29]. → This module exports `S_L` (threshold physiology) to testosterone, IGF-1 and the leanness appetite multiplier; it does **not** add a separate leptin→EE term (02 owns adaptive thermogenesis; use leptin only as a covariate there if desired).

**Moderators.** Sex (above); menopause; age (leptin 53% lower >60 y in one cohort, not fully BMI-adjusted [4]; BMI-adjusted decline with age [7]); androgens (lower) [2]; obesity (larger absolute falls per %BF [3]).

**Evidence grade: B.** Direction and time course are consistent across many controlled human studies (A-level), but the magnitude of the acute fall varies 2-fold between studies (sex, adiposity, assay, sampling time), and the parameterisation is a fit by this agent.

---

### 4.2 Ghrelin and the satiety peptides (PYY, GLP-1, CCK, amylin)

**Mechanism.** Ghrelin (stomach) rises before meals and falls after them; peptide YY, GLP-1 and CCK (gut) rise after meals and signal satiety. Diet-induced weight loss shifts both sets in the direction that favours regain, and the shift persists for at least a year [30][39]. Intravenous ghrelin increases buffet intake by 28 ± 3.9% [33], establishing a causal link to intake. These hormones are **display outputs and mechanistic context**: the hunger model (§4.9) is calibrated on intake/appetite data directly, so do **not** additionally sum hormone changes into hunger (double counting).

**Weight-loss response.**
- 17% diet-induced weight loss → +24% 24-h ghrelin AUC [31].
- 10-week VLED (−13.5 ± 0.5 kg): leptin, PYY, CCK, amylin, insulin ↓; ghrelin, GIP, pancreatic polypeptide and subjective appetite ↑; at 62 weeks leptin, PYY, CCK, insulin, ghrelin, GIP, PP and hunger all still differed from baseline [30].
- Dose-response in 5% steps (VLED to 15% loss): fasting leptin −8.25 ng/mL by 5% loss with only −1.88 ng/mL more from 5→15%; amylin and GLP-1 fall by 5% then plateau; fasting ghrelin unchanged <5%, +41.6 pg/mL from 5→10% and +67.7 pg/mL from 5→15%; no relation to starting BMI [37].
- 16% loss (after refeeding out of ketosis): basal and postprandial active ghrelin ↑, postprandial CCK ↓, fasting hunger +38%; at 1 year (15% maintained) ghrelin still ↑, PYY ↓, fasting hunger +22%, but postprandial fullness ↑ [39].
- Contest preparation (drug-free male bodybuilder, 13.8 → 5.1% DXA body fat): ghrelin 383 → 822 pg/mL [119].
- Short moderate deficits do **not** raise fasting total ghrelin (−800 kcal/d × 4 d [19]; day 3 of VLED [38]); 48 h of near-total restriction does [43].

**Ketosis.** When weight-reduced participants were ketotic (BHB 0.48 ± 0.07 mM) the weight-loss-induced ghrelin rise was suppressed; after 2 weeks of refeeding (BHB 0.19) ghrelin and appetite rose [40]. Timeline under a ketogenic VLED (550/660 kcal/d women/men; BHB 0.60 ± 0.13 mM by day 3): fasting hunger ↑ at day 3 (2 ± 1% loss) and at 5% loss (12 ± 8 days); no increase at 10% loss (32 ± 8 days) or 16% loss (week 9); active ghrelin ↑ only at week 13 after refeeding [38]. Meta-analysis: VLED and ketogenic low-carbohydrate diets produce small absolute reductions in hunger — the clinical value is preventing the rise expected with weight loss [41]; see also review [42].

**Macronutrients and food form.** Acute protein (meta-analysis, 49 acute trials): hunger −7 mm VAS, fullness +10 mm, ghrelin −20 pg/mL, CCK +30 pg/mL, GLP-1 ↑; hormone effects appear at ≥35 g doses; long-term trials show no persistent effect (GLP-1 even ↓) [44]. High-protein meals give the largest PYY release, and PYY-null mice resist protein satiation [45]. A 35-g-protein breakfast lowered daily ghrelin and raised PYY vs breakfast skipping [46]. An unprocessed diet raised PYY (34.3 vs 28.9 pg/mL at baseline) and lowered active ghrelin (48.3 vs 61.4) relative to baseline, whereas the ultra-processed diet did not [59].

**Meal timing / fasting.** Ghrelin rises nearly 2-fold immediately before each meal and falls to trough within 1 h after eating; inter-meal ghrelin has a diurnal rhythm in phase with leptin (zenith 01:00, nadir 09:00) [32]. Pre-meal peaks occur at each person's *habitual* meal times (short vs long inter-meal-interval eaters), and hunger tends to precede ghrelin — i.e., ghrelin is entrained/anticipatory [34]. During a 24-h fast, ghrelin still rises and falls at customary meal times while the 24-h mean declines slightly [35]; during 12–84 h of fasting the diurnal pattern persists and the 24-h mean shows a small but significant decline, with a strong inverse association with cortisol (r = −0.79) [36]. Early time-restricted feeding (08:00–14:00) lowered mean ghrelin by 32 ± 10 pg/mL and made hunger "more even-keeled" [76].

**Exercise and sleep.** A single exercise bout: acylated ghrelin median −16.5%, PYY +8.9%, GLP-1 +13%, PP +15% (meta-analysis) [70]. Two nights of 4-h sleep: ghrelin +28%, leptin −18% [66].

**Equations (display outputs).**
```
G_WL   = (L_FM / L0)^(−0.35)                       # weight-loss (fat-mass) driven component
G*     = [1 + (G_WL − 1)·(1 − 0.9·K·K_ad)] · (1 + 0.07·max(0, 7 − sleep_h))
τ_G    = 3 d (up and down)
SPI*   = 1 − 0.15·(1 − exp(−WL%/3)) + 0.10·clamp((protein%E − 15)/15, −1, 1)
             + 0.10·clamp((fibre_g − fibre_ref)/14, −1, 1) + 0.19·(f_UPF,ref − f_UPF)/0.8
τ_SPI  = 7 d
```
`PROPOSED FIT` for `G`: exponent 0.35 fitted to +24% at 17% loss [31] (model +25%, assuming fat mass fell to 70% of baseline) and +115% at contest-level leanness [119] (model +101% with fat mass at 33% of baseline); the ghrelin rise is driven by fat-mass loss, not the acute leptin fall (4-d deficit: leptin −36%, ghrelin unchanged [19]). Sleep coefficient from [66] (+28% at 4 h vs 10 h in bed; rescaled to a 7-h reference gives +21% at 4 h). `SPI` is `PROPOSED` (grade D) from [37][44][59]; `WL%` = % loss of initial weight; `K_ad` defined in §4.9.

Optional sub-daily ghrelin (if the engine runs hourly): `G(t) = G · [1 + 0.8·Σ_m exp(−((t − t_m^hab)/1 h)²)]`, suppressed to 0.6·G for 1–3 h after a meal; habitual meal times `t_m^hab` drift toward actual meal times with τ ≈ 7 d. `PROPOSED` (grade D): the 2-fold pre-meal rise and 1-h trough are from [32]; the entrainment time-constant is **UNVERIFIED** (no human study found that quantifies re-entrainment speed).

**Evidence grade:** weight-loss direction and persistence **A/B** (several controlled cohorts); ketosis suppression **B**; parameter values **C**; sub-daily entrainment **D**.

---

### 4.3 Thyroid axis (T3, rT3, TSH)

**Mechanism.** Energy restriction — and, independently, carbohydrate restriction — shifts peripheral deiodination of T4 away from active T3 toward inactive reverse T3 [87][85]. TSH dips transiently early in a fast (−43% on day 2) and then normalises [88]; T4 is usually unchanged or slightly ↑. Hypocaloric dieting produces a pattern resembling the euthyroid sick syndrome (total and free T3 ↓, rT3 ↑) [102]. There is also a slow component linked to the weight-reduced / low-leptin state (reversed by leptin replacement) [25][26].

**Key data.**
- Total fast 7–18 d: T3 −53%, rT3 +58%; 800 kcal/d with 0% carbohydrate × 2 wk: T3 −47% (rT3 unchanged); 800 kcal with ≥50 g carbohydrate: no significant change in T3 or rT3 [85].
- Sequence in fasting: FT4 rises at ~10 h, TT3/TT4 falls from 12–14 h, TSH falls at 30–36 h, rT3/TT4 rises by 48 h [88].
- Refeeding restores T3 and rT3 within 5 days [87]; VLCD 28 d: T3 −34.6% (low-carb) vs −17.9% (high-carb), rT3 ↑ similarly by week 1, both back to baseline after 1 week of a 1,000-kcal mixed diet; RMR fell similarly (12.4% vs 20.8%) despite the different T3 falls [89].
- Eucaloric carbohydrate deprivation (2% E) × 11 d: T3 1.33 vs 1.71–1.78 nmol/L (−23 to −25%), rT3 ↑, REE unchanged, urinary N ↑ [90]. Isocaloric protein+fat vs protein+carbohydrate: rT3 ↑ and T3 ↓ only without carbohydrate [91]. Eucaloric ketogenic diet 3 wk: T3 4.1 vs HCLF 4.8 pmol/L [92]. Isocaloric KD vs baseline diet: FT3 2.85 → 2.50 pg/mL (−12%), FT4 1.18 → 1.32 ng/dL [93].
- Weight-reduced maintenance (isocaloric, 4 wk each): T3 137 ng/dL pre-loss → 121 (low-fat), 123 (low-GI), 108 (very-low-carbohydrate) [94].
- 72-h fast, lean men: T3 ≈ −30%, rT3 ≈ +30%, TSH AUC >−70%; leptin replacement did not prevent the T3/rT3 change [27].
- 3 wk at −50% (non-obese men): T3 −39% [98]. Long-term self-selected CR (3–15 y, lean, weight-stable): T3 73.6 vs 91.0–94.3 ng/dL (≈−20%), rT3 and TSH unchanged [95]. CALERIE (~15% CR, 2 y): T3 115.9 ng/dL baseline, change −23.5 (Y1) and −29.9 (Y2) ng/dL vs −9.1/−13.3 in controls (net ≈ −12 to −14%) [96].
- Military 8-wk course (−1,000 to −1,200 kcal/d): T3 below normal (78 ± 20 ng/dL), prompt recovery on refeeding [116] — but in another cohort T3 was the only marker not restored 2–6 weeks later [117]. Contest preparation: T3 123 → 40 ng/dL [119]; female fitness competitors: T3 ↓ and still slightly below baseline after 3–4 months of recovery [137].
- Overfeeding (3 wk) raises T3 concentration and production (≈30 → 50–54 µg/d per 70 kg) regardless of macronutrient; isocaloric carbohydrate-for-fat substitution raises T3 [86].

**Equations.** `PROPOSED FIT`:
```
T3f*  = 1 − 0.22·φ_E(u) − 0.22·DC_T                       (u ≤ 0)
T3f*  = 1 + 0.10·min(1, u/0.3)                             (u > 0; overfeeding, grade C)
τ_down = 2 d, τ_up = 3 d
T3    = T3f · (L_FM_lag / L0)^0.30                          (slow, leanness/weight-reduced component)
rT3*  = 1 + 0.6·max(0, (|u| − 0.7)/0.3) + 0.15·DC_T        (u ≤ 0);  τ_up 2 d, τ_down 3 d
```
Fit check (observed → model): total fast 14 d −53% → −43%; 800 kcal/0 carbohydrate −47% → −41%; VLCD low-carb −35% → −38%, high-carb −18% → −26%; eucaloric 2% carbohydrate −23% → −20%; eucaloric KD −15% → −9%; 72-h fast −30% → −34%; 3 wk at −50% −39% → −25%; weight-reduced maintenance LF −12% → −14%, VLC −21% → −24%; CALERIE net −13% → −18%; contest prep −67% → −53%. Known misfit: Spaulding's "no change with ≥50 g carbohydrate at 800 kcal" [85] (model −31%) — the model sides with the later VLCD [89] and CR [96][98] data.

**Relation to RMR (coordinate with 02).** T3 is exported as a **biomarker**, not as a driver of RMR, because: T3 fell with carbohydrate deprivation without any REE change [90]; RMR fell equally with different T3 falls [89]; leptin replacement restored T3 *and* TEE but REE beyond body-composition prediction was unchanged [26]; metabolic adaptation in the Kiel study was not related to T3 changes [98]. For reference only: in hypothyroid patients on replacement, REE fell ≈15% as TSH rose from 0.1 to 10 mU/L [100]; review [101]. If 02 wants a T3-linked term, cap it at ≤0.25 × ΔT3% (grade D).

**Moderators.** Carbohydrate intake (strong); severity of deficit; leanness; sex differences not established.

**Evidence grade: B** (direction and carbohydrate dependence replicated in controlled feeding studies; magnitudes vary; the leanness exponent is a fit to few data).

---

### 4.4 Cortisol

**Mechanism.** Fasting activates the HPA axis (larger secretory bursts, later diurnal peak); moderate calorie restriction produces at most a small, transient rise. Low-carbohydrate diets raise resting cortisol during the first ~3 weeks and amplify the cortisol response to prolonged exercise. Sleep loss raises the *evening* cortisol level.

**Key data.**
- Meta-analysis (13 studies, 357 participants): calorie restriction raises serum cortisol; fasting shows a very strong effect; VLCD and less intense LCD do not significantly raise it; meta-regression shows the effect declines toward baseline after several weeks [103].
- 5-day water fast: 24-h cortisol production ×1.8 (2,504 → 4,528 nmol/L distribution volume) via 1.6× larger burst mass; peak shifted from ~09:30–13:30 to ~11:15–16:10; half-life unchanged (108 → 129 min) [105].
- 3-week total fast in 5 healthy women (≈8 kg loss): 24-h cortisol ↑, cortisol half-life ↑, half of dexamethasone-suppression tests non-suppressed; normalised after weight regain [115].
- 6-day starvation in obese men: 09:30 cortisol 143 → 216 nM; 3-week VLCD (2.55 MJ/d): no change in plasma cortisol and cortisol metabolite excretion halved [106].
- 48 h near-total restriction: cortisol 32% higher than fed at session end [43]; 48 h of −3,681 kcal/d: cortisol higher [78].
- 3-week 1,200 kcal/d (women): restriction increased total cortisol output (Cohen's d = 0.63), driven by evening values; *monitoring* calories increased perceived stress (d = 0.38) but not cortisol [104].
- CALERIE 2 y: cortisol slightly but significantly higher at 1 y only [107]. Fitness competitors (4 months): no rise [137]. Contest prep: 25.2 → 26.5 µg/dL [119]. Military: elevated cortisol reflects chronic status with diminishing fat stores [116].
- Low-carbohydrate meta-analysis (27 studies, 309 men): <3 weeks, resting cortisol SMD +0.41 (95% CI 0.16–0.66); ≥3 weeks no consistent effect; post-exercise cortisol after ≥20 min exercise SMD ≈ +0.8 [108]. Isocaloric high-protein vs high-carbohydrate (10 d): cortisol 10.6 vs 7.74 µg/dL, CBG ↑ [109]. Isocaloric weight-reduced maintenance: 24-h urinary cortisol 71 (VLC) vs 60 (low-GI) vs 50 µg/d (low-fat), baseline 58 [94]. High-fat/low-carb alters cortisol metabolism (11β-HSD1 ↑) without changing plasma cortisol [110].
- Exercise (30 min, trained men): cortisol change −6.6% (rest), +5.7% (40% VO2max), +39.9% (60%), +83.1% (80%) — part hemoconcentration (plasma volume −10 to −17%) [111].
- Sleep: after one night of partial or total sleep deprivation, 18:00–23:00 cortisol +37% and +45% [112]; after 1 week of 5-h nights, daytime cortisol profile unchanged [127].

**Equations.** `PROPOSED FIT` (grade C):
```
ΔER*    = [0.5·max(0,(|u| − 0.6)/0.4)^2 + 0.08·min(1, |u|/0.25)] · exp(−n_def/28)    (u < −0.05; else 0)
ΔLC*    = DC_T · (0.05 + 0.15·exp(−n_LC/21))
Δsleep* = 0.04·max(0, 7 − sleep_h)
Δlean*  = 0.20·(1 − S_L(L_FM)) − 0.20·(1 − S_L(L0))
Cort*   = 1 + ΔER* + ΔLC* + Δsleep* + Δlean*,      τ = 1 d (up and down)

Session output (not added to Cort): cortisol_post_bout = 1 + interp(%VO2max: 40→0, 60→0.40, 80→0.83) · (1 + 0.5·DC_T)
```
`n_def` resets to 0 after ≥3 consecutive days with u ≥ −0.05; `n_LC` resets after ≥3 days with carbohydrate ≥130 g. Fit check (observed → model): 6-d fast +51% morning cortisol [106] → +65%; 5-d fast 24-h production ×1.8 [105] → +67% mean concentration; 48-h near-total restriction +32% [43] → +44%; 3-week VLCD (u ≈ −0.7) no change [106] → +11% (over-predicted); eucaloric low-carbohydrate (40 g) 2 wk, SMD +0.41 [108] → +9%; 1,200 kcal/d in women (u ≈ −0.4) small rise [104] → +6% at day 7, fading; CALERIE (u ≈ −0.15) slight rise at 1 y [107] → ≈0.

**Cortisol, water retention and the "whoosh" claim.** No controlled human study located tests whether diet-induced cortisol elevations cause fluid retention that masks fat loss and is released suddenly ("whoosh"). Evidence against a large effect: cortisol rises are small and transient except in fasting [103]; VLCD does not raise plasma cortisol [106]. What *is* documented: early energy restriction produces a *negative* fluid balance linked to falling insulin [98]; starvation oedema appears in severe, prolonged semistarvation with hypoproteinaemia [82][84]. Scale-weight plateaus and sudden drops are better explained by glycogen-bound water, sodium and measurement noise (modules 04, 13, 15). → Do **not** model a cortisol→water term (grade D for any such term).

**Cortisol and abdominal fat.** Women with high waist-to-hip ratio secrete more cortisol in response to laboratory stress (cross-sectional) [113]; the systematic review finds inconsistent HPA findings in obesity, with clearer up-regulation of adipose 11β-HSD1 [114]. No evidence was found that diet-range cortisol changes redistribute fat toward the abdomen; energy restriction reduces visceral fat (e.g., [159]). → No cortisol→visceral-fat partitioning term (grade D).

**Evidence grade: B** for fasting and low-carbohydrate transients; **C** for moderate-CR magnitudes; **D** for leanness term and any water/fat-distribution effects.

---

### 4.5 Testosterone, SHBG and free testosterone (men)

**Mechanism.** The hypothalamic–pituitary–gonadal axis is suppressed when leptin falls below a threshold (leptin replacement prevents the fasting fall in testosterone and LH pulsatility [27]); this makes testosterone insensitive to short/moderate deficits in normal-weight men but strongly suppressed at contest-level leanness or near-total fasting. Separately, excess adiposity suppresses testosterone, so weight loss in men with obesity *raises* it [124]. SHBG rises as insulin falls, further lowering the free fraction [116].

**Key data (men).**
| Study | Condition | Total T |
|---|---|---|
| Chan 2003 [27] | 72-h fast, lean | ≈ −40% (prevented by leptin replacement) |
| Koehler 2016 [22] | EA 15 kcal/kg FFM/d × 4 d | no significant change (leptin −53 to −56%) |
| Müller 2015 [98] | −50% × 3 wk, non-obese | −11% |
| Mäestu 2010 [121] | bodybuilders, weeks 11→5 pre-contest | 20.3 → 18.0 nmol/L |
| Mitchell 2018 [120] | 9 natural bodybuilders, 16 wk, FM 8.8 → 5.3 kg, protein 2.8–3.1 g/kg | 16.4 → 10.1 nmol/L (−38%); free T 229 → 117 pmol/L |
| Rossow 2013 [118] | case, 14.8 → 4.5% body fat | 9.22 → 2.27 ng/mL (−75%); back to 9.91 after contest |
| Pardue 2017 [119] | case, DXA 13.8 → 5.1% body fat, 8 months | 623 → 173 ng/dL (−72%); largely reversed by month 13 |
| Friedl 2000 [116] | 8-wk military course, −1,000 to −1,200 kcal/d + sleep loss, minimal body fat | to 4.5 ± 3.9 nmol/L; LH suppressed; prompt recovery on refeeding |
| Henning 2014 [117] | same course (body fat −54% from 16.8%) | −70%; SHBG +46%; restored within 2–6 weeks |
| Cangemi 2010 [122] | long-term CR (7.4 y), 8.7% fat vs runners 10.5% | 12.0 vs 18.8 nmol/L; SHBG 238 vs 193 nmol/L |
| Smith 2022 [123] | meta-analysis of 7 RCTs | CR ↑ T in 3/4 trials of overweight/obese men; ↓ in 2/3 trials of normal-weight men; SHBG ↑ in all 4 trials measuring it |
| Corona 2013 [124] | meta-analysis, 24 studies | low-calorie diet: TT +2.87 nmol/L (95% CI 1.68–4.07); bariatric +8.73; degree of weight loss is the best determinant |

Diet composition: low-fat vs high-fat diets, SMD −0.38 for total T (95% CI −0.75 to −0.01; 6 studies, 206 men) [125]; low-carbohydrate diets with ≥35% protein: resting total T SMD −1.08 (≈ −5.23 nmol/L), moderate-protein low-carbohydrate: no consistent effect [108]; the decrease appears only >3.4 g protein/kg/d [126]; 10-d isocaloric high-protein vs high-carbohydrate: 371 vs 468 ng/dL with SHBG 23.4 vs 32.5 nmol/L [109]. Sleep: 1 week of 5-h nights: 18.4 → 16.5 nmol/L during waking hours (−10 to −15%) [127]. Alcohol 40 g/d × 3 wk: −6.8% (95% CI −1.0 to −12.5) [128]. Resistance training: no effect on basal total T (SDM −0.003) in older men [129]. Exogenous testosterone during a 28-d severe deficit preserved/increased lean mass (+2.5 kg vs placebo) [130] — evidence that suppression matters for lean-mass outcomes in extreme deficits (coordinate with 03).

**Equations.** `PROPOSED FIT`:
```
T* = [(0.25 + 0.75·S_L(L)) / (0.25 + 0.75·S_L(L0))]                     # leptin-threshold (L50 = 1.0 ng/mL, n = 3)
     · [1 − 0.4·clamp((|u| − 0.6)/0.4, 0, 1)]                            # near-total fasting (u ≤ −0.6)
     · F_ob · F_fat · F_prot · F_sleep · F_alc
F_ob    = exp(−0.025·max(0, BF% − 18)) / exp(−0.025·max(0, BF0% − 18))  # obesity suppression, relative to baseline
F_fat   = 1 − 0.10·clamp((30 − fat%E)/15, 0, 1)
F_prot  = 1 − 0.35·clamp((protein_g/kg − 3.0)/0.8, 0, 1)             # evidence is from low-carbohydrate, ≥35%-protein diets
F_sleep = 1 − 0.025·clamp(8 − sleep_h, 0, 5)
F_alc   = 1 − 0.0017·min(alcohol_g/d, 60)
τ_down = 2 d, τ_up = 7 d  (composition factors F_fat, F_prot, F_alc: τ = 7 d)
```
Fit check (observed → model): contest prep −72% / −75% [119][118] → −72%; military course −70% [117] → −64% (with sleep factor); 72-h fast −40% [27] → −33% (using the model's leptin, which under-predicts the fasting leptin fall); EA 15 × 4 d no change [22] → −7%; −50% × 3 wk −11% [98] → −5%; 16-wk natural bodybuilding −38% [120] → −50%; long-term CR vs lean runners −36% [122] → −14% (under-predicted: chronic low-intake effects beyond leptin); obese man 35 → 28% body fat [124] → +19% (Corona: +2.87 nmol/L, i.e., roughly +25% on a typical hypogonadal-obese baseline — baseline not verified).

**SHBG and free T.**
```
SHBG* = (Ins_rel)^(−0.3)                    (Ins_rel from module 04; τ = 7 d)
fallback if no insulin: SHBG* = 1 + 0.4·φ_E(u) + 0.02·max(0, BF0% − BF%)
Free T (Vermeulen [131]): with TT and SHBG in mol/L, albumin 43 g/L (6.2e-4 mol/L),
   K_alb = 3.6e4 L/mol, K_SHBG = 1.0e9 L/mol, N = 1 + K_alb·[Alb] ≈ 23.4
   a = N·K_SHBG ;  b = N + K_SHBG·(SHBG − TT) ;  FT = (−b + sqrt(b² + 4·a·TT)) / (2a)
```
`PROPOSED FIT` for SHBG (grade C): insulin fall of ≈70% → +43%, matching +46% [117]; Friedl attributes SHBG rise to falling insulin [116]. The Vermeulen calculation is a validated method (calculated FT ≈ equilibrium-dialysis FT except in pregnancy) [131]; the association constants are the standard ones used with it (values quoted from common usage — **UNVERIFIED** against the original paper's text). Defaults if the user has no labs: TT0 = 17 nmol/L (illustrative; sedentary controls 17.6 ± 6.3 [122]), SHBG0 = 35 nmol/L (**UNVERIFIED** typical adult value).

**Moderators.** Age (not modelled here; see 16); obesity (F_ob); sleep; alcohol; very high protein. Men's reproductive axis is more resilient to low EA than women's and recovers faster [132].

**Evidence grade: B** for direction (fasting, extreme leanness, obesity reversal, very-high-protein and low-fat effects replicated); **C** for the leptin-threshold parameterisation and magnitudes of diet-composition factors (few, small studies).

---

### 4.6 Reproductive-axis stress index (women) — and a male analogue

**Mechanism.** In women, LH pulsatility (and hence follicular development, oestradiol and progesterone) depends on energy availability (EA = intake − exercise expenditure, per kg FFM). Five days at EA ≥30 kcal/kg FFM/d did not disturb LH pulsatility; below 30, pulse frequency fell and amplitude rose progressively [133]. At EA 10 for 5 days, LH pulse frequency fell 57% (to 8.2 ± 1.5/24 h) and T3 fell 22%; one day of aggressive refeeding (4,100 kcal) restored glucose/insulin/BHB but **not** LH pulsatility [134]. Over three menstrual cycles, the frequency (not severity) of menstrual disturbances rose with the size of the energy deficit (−8%, −22%, −42% groups; disturbances at −22 to −42%, i.e., −470 to −810 kcal/d; β = −0.48, r² = 0.23) [135]. Re-analysis as EA found **no threshold**: odds of a disturbance fell 9% per +1 kcal/kg FFM/d (OR 0.91, 95% CI 0.84–0.98), predicted probability >50% below EA 30; luteal-phase defects were 57% of disturbances, anovulation 28%, oligomenorrhoea 15% [136]. Female fitness competitors (4 months, −12% body weight, −35–50% fat mass): leptin, T3, testosterone and oestradiol fell, irregular menstrual bleeding 63% vs 30% in controls; oestradiol and leptin recovered within 3–4 months, T3 and testosterone not fully [137]. Five days of EA 15 kcal/kg LBM/d suppressed bone formation and increased resorption in women but not men [138]. Leptin replacement restores LH pulses in hypothalamic amenorrhoea [28].

**Equations (women).** Logistic from [136] (published OR; intercept set by the published statement that P > 0.5 below EA ≈ 30):
```
EA7   = 7-day trailing mean of EA (kcal/kg FFM/d)
P_MD*(EA7) = 1 / (1 + exp(−0.0943·(30 − EA7)))            # 0.0943 = −ln(0.91)
R_MD: τ_up = 7 d (worsening), τ_down = 30 d (recovery)      # PROPOSED; slow recovery per [134][137]
RASI_female (0–100) = 100 · max(0, R_MD − R0)/(1 − R0),  R0 = P_MD*(EA at baseline)
Optional LH pulse frequency (5-day response): LHf_rel = 1 for EA ≥ 30; 1 − 0.57·(30 − EA)/20 for 10 ≤ EA < 30  [133][134]
```
Note: at EA 45 the logistic gives P ≈ 0.20 per cycle — in the source population (sedentary, 18–24 y) subclinical luteal defects are common; hence the index is reported relative to the user's baseline (`RASI_female`) and the absolute `R_MD` is shown only with a caveat. Hormonal contraception makes the index uninformative (bleeding is withdrawal bleeding) — flag (see 16).

**Male analogue.** `RASI_male = 100·clamp(1 − Tt, 0, 1)` (testosterone suppression from §4.5).

**Evidence grade:** LH/EA relation **B** (controlled 5-day studies); menstrual-disturbance dose-response **B** (one controlled 3-cycle trial and its re-analysis); recovery time-constant **C/D**.

---

### 4.7 Growth hormone and IGF-1 (coordinate with 08)

**Mechanism.** Fasting sharply increases pulsatile GH secretion (more and larger bursts) while hepatic IGF-1 production falls because of energy *and* protein deficiency (GH resistance). Long-term moderate CR with adequate protein does not lower IGF-1 in humans; protein restriction does.

**Key data.** 2-day fast: 24-h GH production ×5 (78 → 371 µg/L distribution volume), burst frequency 14 → 32/24 h, GH t½ unchanged (18–20 min); IGF-1 unchanged at 56 h [140]. 5-day fast: GH pulse frequency 5.8 → 9.9/24 h, 24-h integrated GH 2.82 → 8.75 µg·min/mL (×3.1), somatomedin C 1.31 → 0.77 U/mL from day 1 to 5 [139]. 10-day fast (obese men): somatomedin C 0.83 → 0.21 U/mL, prompt rise on refeeding; correlates with urea N loss (r = 0.74) [141]. 5-day fast then 5 days refeeding: 1.85 → 0.67 → 1.26 U/mL (normal diet), → 0.90 (isocaloric, 32% protein), → 0.31 (protein- and energy-deficient); change tracks N balance (r = 0.90) [142]. 72-h fast: total IGF-1 >50% ↓, free IGF-1 ≈75% ↓, IGFBP-1 ↑; leptin replacement partly restored total IGF-1 [27]. Long-term severe CR (1 and 6 y): no change in IGF-1; reducing protein from 1.67 to 0.95 g/kg/d for 3 weeks: 194 → 152 ng/mL (−22%) [143]. CALERIE 2 y: IGF-1 unchanged, IGFBP-1 +21% [107]. Military course: IGF-1 −39% (free −41%), IGFBP-1 +534% [117]; ≈ halved [116]. Natural bodybuilders: 27.0 → 19.9 nmol/L (−26%) despite 2.8–3.1 g/kg protein [120]; IGF-1 fell with insulin and fat mass (r ≈ 0.7) [121]. Low EA ×5 d did not change IGF-1 in men or women in [138]; leptin therapy raised IGF-1 in hypothalamic amenorrhoea [28].

**Equations.** `PROPOSED FIT`:
```
GH*   = 1 + 3.0·φ_E(u)² · m_adip        m_adip = 1 (BMI < 30), 0.5 (BMI ≥ 30);  τ = 0.5 d
P_eff = max(protein_g, 0.2·P_ref)       P_ref = habitual/baseline protein (g/d)
IGF1* = (P_eff/P_ref)^0.43 · [1 − 0.35·clamp((|u| − 0.3)/0.7, 0, 1)]
        · (0.6 + 0.4·S_L(L)) / (0.6 + 0.4·S_L(L0))
τ_down = 3 d, τ_up = 10 d
```
Protein elasticity 0.43 = ln(152/194)/ln(0.95/1.67) [143]. Fit check (observed → model): 5-day fast −64% [142] → −55%; 10-day fast (obese) −75% [141] → −65%; 72-h fast ">50%" [27] → −43%; 5-day refeed from fasting nadir, normal diet 0.68 of baseline [142] → 0.64; protein-deficient refeed 0.49 [142] → 0.49; CALERIE ≈0 [107] → −1%; protein 1.67 → 0.95 g/kg −22% [143] → −22%; military course −39% [117] → −39%; bodybuilders −26% [120] → −26%. Known misfit: Hartman's unchanged IGF-1 at 56 h [140] (model −35%). The GH obesity blunting factor is `PROPOSED` (GH rose with fasting in lean but the obese response was smaller in [36]; magnitude **UNVERIFIED**).

**Evidence grade: B** (fasting/refeeding and protein effects from controlled studies; parameterisation fitted).

---

### 4.8 Insulin, adiponectin, FGF21 (brief)

- **Fasting insulin** is owned by module 04. Reference magnitudes for validation: −31% after 2 d at −62% energy [17]; −74% (men) and −31% (women) after 7 d at −68% [18]; −34 to −38% after 4 d of EA 15 [22]; −54% after 3 wk at −50% [98]; >70% fall in a 72-h fast [27]. This module consumes `Ins_rel` for SHBG.
- **Adiponectin**: a review of CR trials found no clear dose-response of adiponectin to weight loss, unlike leptin [144]; the Kiel CR study even reported −49% after 3 weeks at −50% in non-obese men [98], and an unprocessed diet lowered it vs baseline [59]. → Do not model (grade D); if displayed, hold at 1.0 with "insufficient evidence".
- **FGF21**: in humans a 2-day fast or a ketogenic diet did not change FGF21; 7 days of fasting raised it 74%; 250-fold inter-individual variation [145]. Dietary protein restriction raises circulating FGF21 in humans after 28 days (magnitude "dramatic" in the abstract; exact fold-change **UNVERIFIED**) [146]. 75 g fructose raises FGF21 3.4-fold at 2 h, back to baseline by 5 h [147]. Proposed display rule (grade C): `FGF21_rel = 1 + 0.74·clamp((fast_days − 2)/5, 0, 1)`; protein-restriction term left as a qualitative flag until quantified.

---

### 4.9 Hunger / satiety model and the Hunger Pressure Index (HPI)

**Design principle.** The best-quantified human data on appetite are *intake* data (ad libitum energy intake under controlled manipulations) and one control-theory analysis of free-living intake. Hunger is therefore modelled in **kcal-equivalents per day**, following the "effort" construct of Polidori et al.: effort = (appetite-driven intake) − (actual intake), a quantitative index of the ongoing effort to sustain an intervention [47]. Every term below is the change in ad libitum intake (or satiety expressed as intake) observed in human studies. Hormones (§4.1–4.2) are *not* added on top — they are the mechanism behind these terms.

**4.9.1 Appetite drive (kcal/d).**
```
D = EI_hab + D_WL·Λ_lean + D_ex + D_sleep + D_fat + D_meal
EI_hab  = baseline maintenance intake (TEE at t = 0; constant)
D_WL    = 95 · W_c · (1 − exp(−ΔW/W_c))          ΔW = max(0, W_ref − W);  W_c = 0.08·W0 (kg)
          for W > W_ref:  D_WL = −min(500, 47.5·(W − W_ref))      (weight gain suppresses appetite; half gain, grade D)
W_ref: dW_ref/dt = (W − W_ref)/τ_ref,  τ_ref = 3650 d
Λ_lean  = [1 + 1.5·(1 − S_L(L_FM))] / [1 + 1.5·(1 − S_L(L0))]      (leanness amplification; ≥ ~1)
D_ex    = 150·(1 − exp(−S_ex/120)) − 150·(1 − exp(−ExEE0/120)),   S_ex = ExEE filtered with τ = 14 d
D_sleep = 100·clamp(7 − sleep_h, 0, 4)
D_fat   = 150·F;   F* = min(1, |u|/0.3) if u < −0.05 (τ_build = 45 d) else 0 (τ_recover = 7 d)
D_meal  = 60·max(0, 3 − meals_per_day)·exp(−days_since_pattern_change/10)
```

**4.9.2 Satiety-effective intake (kcal-eq/d).**
```
S = EI − 0.9·max(0, EI_liquid − EI_liquid,ref) + H_P + H_fib + H_ED + H_UPF
H_P   = 0.25·EI_hab·min(ln 2.5, ln(max(P, 0.3·P_ref)/P_ref))        P = protein g/d; P_ref = habitual protein g/d
H_fib = clamp(0.05·EI_hab·v·(fibre − fibre_ref)/14, −0.08·EI_hab, +0.08·EI_hab)
        v = 1.5 viscous fibres (β-glucan, pectin, guar, psyllium), 1.0 whole-food mixed, 0.5 insoluble/low-viscosity isolates
H_ED  = −0.5·EI_hab·clamp(ln(ED/ED_ref), −ln 2, +ln 2)             ED = energy density of non-beverage food, kcal/g
H_UPF = −300·(f_UPF − f_UPF,ref)/0.8                               (residual processing effect after H_ED)
```
All `_ref` values are the user's baseline diet (if unknown, use the population preset from module 15).

**4.9.3 Unmet appetite, ketosis attenuation and HPI.**
```
E_raw = SatDef(EI_hab − S) + D_WL·Λ_lean + D_ex + D_sleep + D_fat + D_meal
SatDef(x) = x                               for x ≤ 0 (surplus → satiety)
          = 1400·(1 − exp(−x/1000))         for x > 0 (large acute deficits saturate)
E_s:  first-order filter of E_raw, τ = 1 d
K_ad* = 1 if BHB ≥ 0.3 mM else 0;   τ_up = 10 d, τ_down = 3 d
f_K   = 1 − 0.9·K·K_ad
E_k   = E_s·f_K   if E_s > 0,   else E_s
HPI   = 100 / (1 + exp(−(E_k − 800)/300))          (E_k = 0 → 6; 400 → 21; 800 → 50; 1200 → 79; 1600 → 94)
```
The HPI scale constants (800, 300) are a **scaling choice**, not an evidence-derived quantity; they were set so that a habitual diet at maintenance reads ≈6, a typical 25%-deficit first week ≈40–50 and contest-level leanness ≈95+. No validated mapping from HPI to VAS millimetres exists (grade D).

**4.9.4 Per-term evidence.**

| Term | Human evidence (effect size) | Parameter origin | Grade |
|---|---|---|---|
| Weight-loss feedback `D_WL` | Free-living covert energy loss (SGLT2, 52 wk, n = 153): intake rose ≈100 kcal/d per kg lost (proportional control, kP = 95), ≈3× the EE adaptation; steady-state intake +≈350 kcal/d [47]. Hormonal changes occur mostly by 5–10% loss with little further change to 15% [37]; hunger +38% at 16% loss, +22% at 1 y [39]; persistent hunger at 62 wk [30]. | Initial slope 95 from [47]; saturation `W_c = 8%·W0` PROPOSED from [37][39] | **B** (slope), **C** (saturation) |
| Reference-weight drift `τ_ref` | Hunger elevation declined from +38% to +22% over ≈9 months at maintained 15% loss [39]; hormonal and appetite changes persist ≥1 y [30]; metabolic adaptation persists 6 y [162]; long drift needed to reproduce observed regain (§4.10c) | PROPOSED 10 y (plausible range 2 y–∞) | **D** |
| Leanness `Λ_lean` | Minnesota semistarvation (≈25% weight loss) → extreme hunger and post-starvation hyperphagia driven by both fat and FFM deficits (r = −0.6 and −0.5) [79][82][83]; ghrelin doubles at contest leanness [119]; leptin inversely associated with hunger during a deficit (r −0.6 to −0.7) [15]; dieting in the lean predisposes to fat overshoot [80] | PROPOSED form via leptin sufficiency | **D** |
| Acute deficit `SatDef` | 48 h at −3,681 kcal/d → +907 kcal (95% CI 321–1,493) over the next 36 h ad libitum [78]; 2 d at −62% → 143% and 124% of requirement on the next 2 days [17]; hunger ↑ by day 3 of a VLED [38] | Saturation PROPOSED | **B** (direction), **C** (shape) |
| Protein `H_P` | 15→30% protein at constant carbohydrate: −441 ± 63 kcal/d ad libitum, −4.9 kg in 12 wk [48]; 15→10%: +12 ± 4.5% energy intake, 15→25%: no change [49]; protein leverage [50]; acute protein: hunger −7 mm, fullness +10 mm [44]; fullness AUC ↑ [52]; 1.2–1.6 g/kg/d and 25–30 g/meal recommended [51] | β = 0.25 fits [48] (ln 2 → −18% of ≈2,400 kcal) and [49] (ln(2/3) → +10%) | **B** |
| Fibre `H_fib` | +14 g/d → −10% ad libitum intake, −1.9 kg over 3.8 mo (older, heterogeneous studies) [54]; viscous fibres reduce appetite in 59% of comparisons vs 14% for less viscous; no clear dose-response; effects on intake "relatively small" [53] | Coefficient halved from [54] to respect [53] | **C** |
| Energy density `H_ED` | −25% ED → −24% intake (−575 kcal/d) over 2 d with no hunger difference [57]; intake 1,800/1,519/1,376 kcal at high/medium/low ED, equal food weight [55]; water incorporated into food (soup) reduced lunch intake 1,209 vs 1,657 kJ [56]; 1-y low-ED advice: −7.9 vs −6.4 kg and less hunger [58] | ε = 0.5 (short-term data imply ≈0.8; halved for long-term attenuation) | **B** (short-term), **C** (long-term) |
| Ultra-processing `H_UPF` | Inpatient crossover (n = 20): +508 ± 106 kcal/d on ultra-processed diet (carbohydrate +280, fat +230, protein −2), weight +0.9 vs −0.9 kg in 2 wk; eating rate +17 kcal/min; consumed ED 1.36 vs 1.09 kcal/g [59]; faster eating ↑ intake (SMD 0.45) [60] | 508 kcal split ≈50% ED, ≈50% residual (300) | **B** (single RCT) |
| Liquid calories | 450 kcal/d as soda: dietary compensation −17% vs +118% for jelly beans; weight ↑ only with liquid [64]; beverage forms ↑ daily intake by 12.4–19% vs matched solids [65] | 0.9 of excess liquid kcal gets no satiety credit | **B** |
| Ketosis `f_K` | Ketogenic VLED: hunger ↑ up to ≈3 weeks (5% loss), then no ↑ at 10–17% loss while ketotic; ↑ after refeeding [38]; ghrelin rise suppressed while ketotic [40]; meta-analysis: small hunger ↓ and prevention of the weight-loss rise [41][42]. Counter-evidence: ad libitum animal-based ketogenic diet → 689 ± 73 kcal/d *more* intake than a plant-based low-fat diet over 2 wk [61]; in T2D, VLC vs HC energy-matched diets gave lower "daily overall" fullness [62] | a = 0.9; K half-max 0.3 mM; K_ad τ = 10 d (PROPOSED from [38]) | **B/C** |
| Sleep `D_sleep` | Partial sleep deprivation: +385 kcal/d (95% CI 252–517), no change in EE (meta-analysis, 11 studies) [67]; 2 nights of 4 h: hunger +24%, appetite +23% (carbohydrate-rich foods +33–45%) [66]; during a deficit 5.5 vs 8.5 h: more hunger, fat loss −55%, FFM loss +60% [68] | 100 kcal/d per hour below 7 h (PROPOSED; assumes ≈3–4 h restriction in [67]) | **B** (direction), **C** (per-hour) |
| Exercise `D_ex` | Acute bout: trivial change in absolute intake (ES 0.14) → net deficit (relative intake ES −1.35) [69]; 24-wk exercise at 8 or 20 kcal/kg/wk: intake +90.7 (95% CI 35–146) and +123.6 kcal/d (95% CI 65–183), compensation 1.5 and 2.7 kg [72]; large inter-individual variability (compensators +268 kcal/d, hunger +6.9 mm) [71]; adiposity and sex do not modify acute responses [73] | 150·(1 − e^(−ExEE/120)): ≈86 at 103 kcal/d, ≈132 at 257 kcal/d | **B** |
| Meal pattern `D_meal` | Eating <3 times/day ↑ appetite; >3/day little effect [74]; 6 vs 3 meals ↑ hunger AUC 14% (41,850 vs 36,612 mm·24 h) [75]; breakfast reduces daily hunger vs skipping [46]; eTRF lowers ghrelin and evens hunger [76][77]; ghrelin peaks entrain to habitual meal times [34] | PROPOSED; 10-d entrainment decay UNVERIFIED | **C/D** |
| Diet fatigue `D_fat` | Disinhibition ↑ with 6 wk continuous restriction but ↓ with diet breaks [150]; intermittent (3:1) restriction → lower hunger and desire to eat, higher satisfaction [149]; transient ↑ state hunger in 2-y CR [180]; free-living adherence decays over months [47][170] | PROPOSED | **D** |
| Palatability / variety | Satiety index correlates negatively with palatability (r = −0.64) and positively with serving weight (r = 0.66), water (0.64), fibre (0.46), protein (0.37); fat negative (−0.43); boiled potatoes 323 ± 51% vs croissant 47 ± 17% of white bread [63]; in [59] pleasantness did not differ yet intake did | Captured through ED/UPF/protein/fibre; no separate term | **C** |

**Holt satiety index usage.** The engine models foods by composition, so the satiety index is represented through its measured correlates (water/ED, fibre, protein, fat, palatability) [63]; do not import SI values as an independent input (would double count).

**4.9.5 Time dynamics summary.** Acute deficit and surplus act within a day (τ 1 d); ketosis attenuation builds over ~10 days and is lost within ~3 days of exiting ketosis [38][40]; exercise compensation builds over ~2 weeks [72]; weight-loss feedback builds with weight lost and decays only as `W_ref` drifts (τ ≈ 10 y, very uncertain) or weight is regained; fatigue builds over ~6 weeks of continuous deficit and clears within ~1 week of maintenance.

**4.9.6 Moderators.** Sex: in a ketogenic VLED, fasting hunger rose significantly in women but not men [38]; women report higher fullness responses. Individual variability is large (compensators vs non-compensators [71]); treat the population HPI as the mean and allow a user-level multiplier on `EI_hab`-scaled terms (inter-individual SD of the weight-loss feedback **UNVERIFIED**, suggest ±40%). Obesity: no effect of starting BMI on hormone changes [37].

**Evidence grade (composite HPI): C.** Individual terms range B–D (table); the combination rule (additive kcal-equivalents) and the logistic scale are proposed by this agent.

---

### 4.10 Adherence outputs

**(a) Plan-survival probability (planner penalty).**
```
h(HPI) = 0.0005·((HPI − 20)/40)²   for HPI > 20, else 0        (per day)
P_surv(t) = exp(−Σ_days h)
```
`PROPOSED FIT` (grade D) calibrated to the *excess* 12-month attrition of harder diets over the least restrictive arm in RCTs: alternate-day fasting 38% vs daily 25% restriction 29% vs control 26% [157]; Atkins 47% and Ornish 50% vs Zone and Weight Watchers 35% [171]; moderate low-fat vs low-carbohydrate 21% overall [174]. With the equation, a regime averaging HPI 40 adds ≈4.5 percentage points/yr of dropout, HPI 60 ≈17, HPI 80 ≈34, HPI 95 ≈48. The planner should also enforce a hard constraint (§9).

**(b) Adherence predicts results more than diet type.** Weight loss correlated with self-reported adherence (r = 0.60) but not diet type (r = 0.07) [171]; most- vs least-adherent tertiles lost −8.3 vs −1.9 kg (Atkins), −3.7 vs −0.4 (Zone), −6.5 vs −1.7 (Ornish) [173]; named-diet differences were small in a network meta-analysis (low-carbohydrate −8.73 kg and low-fat −7.99 kg at 6 months vs no diet) [175]; a 12-month healthy low-fat vs healthy low-carbohydrate trial found −5.3 vs −6.0 kg (difference 0.7 kg, 95% CI −0.2 to 1.6) [174]; A TO Z: −4.7 (Atkins), −1.6 (Zone), −2.6 (LEARN), −2.2 kg (Ornish) [172]. → The planner should rank regimes by projected outcome **× P_surv** and HPI, not by theoretical outcome alone.

**(c) Optional "free-living realism" intake model.** Control-theory reconstruction of a lifestyle programme: intake fell ≈700 kcal/d below baseline and relaxed exponentially toward baseline, being within 100 kcal/d of baseline at the 6–8-month plateau, while the effort (appetite − intake) stayed substantial [47]; an intermittent-non-adherence model reproduces the early plateau better than metabolic adaptation [170].
```
E_cap(t) = 700·exp(−t/1095)          (kcal-eq/d; τ = 3 y)            PROPOSED (grade D)
If E_k > E_cap: add extra intake X ≥ 0 solving E_k(EI + X) = E_cap (monotone → bisection)
```
Calibration (100-kg person, 15 kg lost, then free-living with `E_cap` and `τ_ref` = 10 y, EE falling 22 kcal/d per kg lost): regain 51% at 1 y, 72% at 144 weeks, 81% at 5 y — vs observed 71–76% regain at 144 weeks irrespective of loss rate [164] and 17–29% of loss maintained at 4–5 y [163]. A constant `E_cap` gives only ≈26% regain; a 2-year `τ_ref` gives ≈40% at 144 weeks — both too little. Inter-individual SD of `E_cap` **UNVERIFIED** (suggest CV 50%). Use this mode for "what will probably happen" projections; the plain simulator should show the prescribed regime.

**(d) Rate of loss.** Elite athletes, 4 RT sessions/wk: 0.7%/wk (−19% energy) vs 1.0%/wk achieved (target 1.4%, −30% energy): similar weight loss (−5.6 vs −5.5%), fat mass −31% vs −21%, lean mass +2.1% vs −0.2% [176]; 0.5–1%/wk recommended for contest prep [177]; rapid (5 wk) vs slow (15 wk) 5% loss: slow loss gave larger fat and waist reductions, rapid loss larger reductions in FFM, total body water and RMR [178]; VLCD 5 wk vs LCD 12 wk: similar total loss (−9.0 vs −8.2 kg) and regain (4.5 vs 4.2 kg), FFM loss 8.8% vs 1.3% of weight lost [165]; 12-wk rapid vs 36-wk gradual: 81% vs 50% reached ≥12.5% loss, regain equal (≈71%) [164]; 4 months severe (65–75%) then moderate vs 12 months moderate restriction in post-menopausal women: 2× weight and fat loss, more lean-mass loss (−1.2 kg, proportional to weight lost) and more hip BMD loss (−0.017 g/cm²) [159]. → Rate affects lean mass/BMD (modules 03, 19) and HPI (this module), not long-term regain per se.

---

### 4.11 Diet breaks and refeeds

**Evidence.**
| Study | Population / design | Result |
|---|---|---|
| MATADOR, Byrne 2018 [148] | 51 men with obesity; 16 wk of restriction at 67% of maintenance, continuous vs 8 × 2-wk restriction alternating with 7 × 2-wk energy balance (30 wk); food provided | Per-protocol: weight −14.1 ± 5.6 vs −9.1 ± 2.9 kg; fat −12.3 ± 4.8 vs −8.0 ± 4.2 kg; FFM loss similar (1.8 vs 1.2 kg); weight change during balance blocks 0.0 ± 0.3 kg; composition-adjusted REE −360 ± 502 vs −749 ± 498 kJ/d; 6-month follow-up subset: −11.1 ± 7.4 vs −3.0 ± 4.4 kg (8.1 kg difference) |
| ICECAP, Peos 2021 [149] | 61 resistance-trained adults (32 women); 4 × 3 wk moderate restriction + 3 × 1 wk balance vs 12 wk continuous | No difference in fat mass (15.3 vs 18.0 kg, P = 0.32), FFM, strength, REE, leptin, testosterone, IGF-1, fT3, active ghrelin; **lower hunger (P = 0.002) and desire to eat (P = 0.014), greater satisfaction, higher PYY** with breaks |
| Siedler 2023 [150] | 38 resistance-trained women, 25% restriction, 1.8 g/kg protein; 6 wk continuous vs 2:1 restriction:balance (8 wk) | No difference in body composition or RMR; disinhibition rose with continuous (4.91 → 6.17) and fell with breaks (6.80 → 6.05) |
| Campbell 2020 [151][152] | 27 resistance-trained adults, ≈25% restriction 7 wk; 2 high-carbohydrate refeed days/wk vs continuous | FFM −0.4 vs −1.3 kg; RMR −38 vs −78 kcal/d; a published comment argued that on reanalysis only dry FFM differed (see the authors' reply [152]) |
| Wing & Jeffery 2003 [153] | 142 adults, behavioural programme; 2-wk or 6-wk prescribed breaks | Breaks slowed loss/slight regain during the break but overall 5- and 11-month loss did not differ |
| Davoodi 2014 [154] | 60 women, "calorie-shifting" | RMR tended to be maintained, hunger ↓ (low-quality design, caffeine co-intervention) |
| Meta-analyses of intermittent vs continuous restriction (mostly intermittent *fasting*) | ≥6-month trials [155]; 11 RCTs 8–24 wk [156] | No difference in weight loss: 0.084 ± 0.114 kg [155]; −0.61 kg (95% CI −1.70 to 0.47) [156] |
| Alternate-day fasting, Trepanowski 2017 [157] | 100 adults, 1 y | Same weight loss as daily 25% restriction (−6.0 vs −5.3% at 12 mo), higher dropout (38% vs 29%); ate more than prescribed on fast days |

**Best current reading.**
1. Planned breaks of ≥1 week at true energy balance do not impair total fat loss, reduce hunger/desire to eat and disinhibition (B), and cost calendar time (B).
2. Whether breaks improve fat-loss *efficiency* is unresolved: yes in men with obesity on provided food with 2-wk blocks [148]; no in trained lean adults with shorter blocks [149][150] (C). A 2-week balance period reverses much of the adaptive REE reduction [148] (C).
3. 1–2-day carbohydrate refeeds raise leptin transiently (+28% after 3 d of carbohydrate overfeeding [13]; recovery within 12–24 h after short fasts [11][12]) and may modestly spare FFM [151] (C); there is no evidence of a lasting "metabolic reset".
4. Unstructured "breaks" with ad libitum eating risk hyperphagia; MATADOR's benefit required measured energy balance in the breaks [148]. Theoretical rationale for athletes is reviewed in [158].

**Model handling (no special-case code).** During a break the state equations produce: `A_lep` → 1 within ~1 d and `T3f` → 1 within ~3–5 d; `Cort` habituation counters reset; `F` clears (τ 7 d); the acute-deficit term vanishes; the fat-mass components (leptin, ghrelin, `D_WL`) persist. Scenario G in Appendix A shows HPI falling from ≈56–80 in restriction weeks to ≈13–37 in break weeks. REE effects belong to module 02 (use MATADOR as its validation); refeed composition effects on leptin/T3 come from §4.1/4.3 carbohydrate terms.

---

### 4.12 Weight-loss maintenance and regain physiology

- **Energy-expenditure side** (owned by 02): steady-state rule ≈100 kJ (≈24 kcal)/d per kg of weight change, half-time ≈1 y [160]; maintaining ≥10% reduced weight lowers TEE by 6 ± 3 (never-obese) and 8 ± 5 (obese) kcal/kg FFM/d beyond composition [24]; persists >1 y [161]; "Biggest Loser" competitors: metabolic adaptation −499 ± 207 kcal/d and RMR −704 ± 427 kcal/d 6 years later despite regaining 41.0 of 58.3 kg [162]; −504 ± 171 kcal/d at week 30 despite FFM preservation [99]; 2-y CR: 80–120 kcal/d below expected [96].
- **Intake side** (this module): appetite rises ≈100 kcal/d per kg lost — ≈3× the EE adaptation [47]; hormonal/hunger changes persist ≥1 y [30][39]; the weight-reduced state behaves like relative leptin insufficiency [26].
- **"Energy gap" for maintenance** (derived): holding a loss of ΔW kg requires resisting ≈ `24·ΔW` (EE) + `D_WL(ΔW)` (appetite) kcal/d; for 10 kg lost from 100 kg ≈ 240 + 540 ≈ 780 kcal/d of effort — the reason `E_cap` exhaustion drives regain (§4.10c).
- **Regain data**: 144 weeks after 12.5–15% loss, ≈71% regained regardless of whether the loss was rapid or gradual [164]; equal regain after rapid vs slow loss, but % FFM lost predicted regain (r = 0.325) [165]; US structured programmes: 5-y maintenance 7.1 kg (29%) after VLED vs 2.0 kg (17%) after hypoenergetic balanced diets; more exercise → better maintenance [163]; MATADOR intermittent group retained 8.1 kg more at 6 months [148]; post-starvation hyperphagia depends on both fat and FFM deficits, producing fat overshoot [79][80].
- **Predictors** (systematic review of 67 studies): behavioural and cognitive factors that reduce intake, increase expenditure and involve self-monitoring predict maintenance; demographics do not [166]; review of the "biology's response to dieting" [168]; NIDDK workshop summary of the weight-reduced state [169]; clinical review [167]; athlete-focused review of metabolic adaptation [181]. Neither the rise in hunger nor ghrelin at week 13 predicted 1-y maintenance in [39].
- **Model implications.** Regain in the "free-living" mode emerges from `D_WL` + EE adaptation exceeding a slowly decaying `E_cap`. FFM loss is currently *not* an explicit appetite driver (Dulloo's "proteinstat" [79][80]); adding `+k·ΔFFM` is an open option (grade D).

---

### 4.13 Mood, energy, libido and cold intolerance during prolonged deficit (coordinate with 19)

- **Minnesota Semistarvation Experiment** (36 young men; 12-wk control, 24-wk semistarvation at ≈1,600–1,800 kcal/d, ≈25% weight loss; restricted then ad libitum refeeding): anaemia, fatigue, apathy, extreme weakness, irritability, neurological deficits, lower-extremity oedema [82][84]; marked BMR fall beyond lost tissue [83] (reviewed in [81]); post-starvation hyperphagia [79]. Original monograph [83] (book; specific psychometric and libido figures not re-verified here — **UNVERIFIED** in detail).
- **Contest preparation**: total mood disturbance (POMS) 6 → 43 during preparation, back to 4 at 6 months; heart rate 53 → 27 bpm; blood pressure 132/69 → 104/56 mmHg; strength not fully recovered in 6 months [118]. Subjective sleep quality ↓, peak anaerobic power 753 → 537 W, RMR 107 → 81% of predicted; largely reversed by month 13 [119].
- **Female fitness competitors** (4 months to ≈12% body-weight loss): no significant mood change (trend to lower vigour, P = 0.066), cortisol not raised, menstrual irregularity ↑ [137].
- **Moderate CR in non-obese adults** (CALERIE, 2 y, 7.6 kg loss): mood improved (BDI-II −0.76), tension ↓, general health ↑, sexual drive/relationship ↑ (+1.06), sleep duration ↑ at 12 months — no negative effects on quality of life [179]. Dietary restraint and self-efficacy ↑, transient state-hunger ↑ [180].
- **Cold/thermoregulation**: 6-month CR lowered core body temperature [97]; T3 falls (§4.3) and SNS tone falls [98][26].
- **Sleep restriction** lowers vigour alongside testosterone [127].

**Proposed composite (display only; grade D):**
```
DietStrain (0–100) = 100·[0.6·(1 − S_L(L)/S_L(L0)) + 0.25·max(0, (HPI − 50)/50) + 0.15·clamp(7 − sleep_h, 0, 3)/3]
```
It is dominated by leptin sufficiency (leanness × deficit) because moderate CR in non-lean people does not worsen mood [179] whereas contest-level leanness does [118]. Libido: men → `Tt`; women → `RASI_female`.

---

## 5. Interactions with other subsystems

| Direction | Module | Quantity |
|---|---|---|
| Needs | 01 | W, FM, FFM, BF% each day |
| Needs | 02 | TEE (for `u`), baseline TEE0 (`EI_hab`) |
| Gives | 02 | Leptin_rel and T3_rel as optional covariates/validation markers for adaptive thermogenesis (do not double count; §4.3) |
| Needs | 03 | protein g/d and g/kg |
| Gives | 03 / 09 | `Tt` and `IGF1` as optional modifiers of lean-mass retention in severe deficits (exogenous T +2.5 kg LBM in a 28-d severe deficit [130]; sleep loss ↑ FFM loss [68]) — grade C |
| Needs | 04 | net carbohydrate g/d; fasting insulin (relative) |
| Needs | 05 | fasting BHB (ketosis) |
| Needs | 07 | meals/day, eating window, meal clock times, fasting duration |
| Gives | 08 | IGF-1_rel, GH_rel, FGF21 flag |
| Needs | 10 / 09 | ExEE (kcal/d), session intensity (%VO2max) |
| Needs | 13 | break/refeed schedule (handled by state equations) |
| Needs | 15 | fibre (and viscosity class), energy density, UPF share, liquid kcal, alcohol |
| Needs | 16 | sleep hours, menopausal status, hormonal contraception flag, age |
| Gives | 17 | EA, RASI, Tt, HPI, P_surv for safety rules |
| Gives | 18 | HPI time series, P_surv(T), mean HPI, max 14-day HPI, adherence-adjusted projections |
| Gives | 19 | DietStrain, RASI (bone risk), Tt, T3, sleep interactions |

---

## 6. Output metrics for the UI

| Metric | Unit | Direction of good | Computation | Grade |
|---|---|---|---|---|
| Hunger Pressure Index | 0–100 | lower | §4.9.3 | C |
| Unmet appetite ("effort") | kcal-eq/d | lower | `E_k` | C |
| Appetite drive from weight lost | kcal/d | lower | `D_WL·Λ_lean` | B/C |
| Plan-survival probability | % at horizon | higher | `P_surv(T)` | D |
| Adherence-adjusted projection | kg, etc. | – | free-living mode (§4.10c) | D |
| Leptin (relative; estimated ng/mL) | –, ng/mL | context ("higher = less starvation signalling") | §4.1 | B |
| Ghrelin (relative) | – | lower | §4.2 | B/C |
| Satiety-peptide index | – | higher | §4.2 | D |
| T3 (relative), rT3 (relative) | – | T3 closer to 1 | §4.3 | B |
| Cortisol, 24-h mean (relative) | – | closer to 1 | §4.4 | C |
| Post-exercise cortisol response | % | – | §4.4 session rule | B/C |
| Total testosterone (relative) (men) | – | ≥ baseline | §4.5 | B/C |
| Free testosterone | pmol/L | higher (within normal) | Vermeulen [131] | C |
| SHBG (relative) | – | context | §4.5 | C |
| Reproductive-axis stress (women) | 0–100 and P(disturbance)/cycle | lower | §4.6 | B |
| Energy availability | kcal/kg FFM/d | ≥45 ideal; ≥30 minimum (women) | `(EI − ExEE)/FFM` | B |
| GH secretion (relative) | – | context | §4.7 | B/C |
| IGF-1 (relative) | – | context (goal-dependent: longevity vs anabolism; see 08) | §4.7 | B |
| Diet strain / mood risk | 0–100 | lower | §4.13 | D |

---

## 7. Validation targets

Tolerance: relative hormone values within ±15 percentage points of the observed mean unless stated; intake effects within ±30%.

1. **Short fast and refeeding — leptin (Weigle 1997 [12]).** 7 non-obese women, 3-day fast (≈2.6% weight loss): leptin 8.5 → 2.4 ng/mL (−62 ± 25%); back to baseline within 12 h of refeeding. Engine: −50 to −75% at 72 h; ≥85% of baseline 24 h after refeeding.
2. **Sex difference in leptin/insulin response (Dubuc 1998 [18]).** 11 men, 13 women, normal weight, 7 d at −68% energy (~4% weight loss): leptin men 3.7 → 2.1 (−36%), women 16.2 → 6.0 ng/mL (−61%); insulin men −74%, women −31%. Engine: women's fall ≥1.4× men's.
3. **Kiel semistarvation (Müller 2015 [98]).** 32 non-obese men, 1 wk +50% overfeeding, 3 wk at −50% (−6.0 kg; fat −114 g/d, FFM −159 g/d), 2 wk refeeding: leptin −44%, insulin −54%, T3 −39%, testosterone −11%, REE −266 kcal/d (adaptive component ≈108 kcal/d). Engine: leptin −35…−55%, T3 −20…−40% (current fit −25%), testosterone −0…−20%.
4. **Weight-reduced maintenance by diet composition (Ebbeling 2012 [94]).** 21 young adults after 10–15% weight loss, 4-wk isocaloric crossover: leptin 29.2 (pre-loss) → 14.9 (low-fat), 12.7 (low-GI), 11.2 ng/mL (very-low-carbohydrate); T3 137 → 121, 123, 108 ng/dL; urinary cortisol 58 → 50, 60, 71 µg/d. Engine must reproduce the ordering and ≥20% lower leptin and ≥10% lower T3 on very-low-carbohydrate vs low-fat.
5. **Military semistarvation with recovery (Friedl 2000 [116]; Henning 2014 [117]).** Young men, 8 wk, deficits ≈1,000–1,200 kcal/d with sleep deprivation, body fat 16.8% → ≈7.7%: total T −70% (to ≈4.5 nmol/L), SHBG +46%, IGF-1 −39 to −50%, T3 below normal; all but T3 restored within 2–6 weeks of recovery. Engine: T −55…−80%, IGF-1 −30…−50%, T recovery >90% by 6 weeks.
6. **Contest preparation case (Pardue 2017 [119]; Rossow 2013 [118]).** Drug-free male bodybuilder, 8 months, intake 3,860 → 1,724 kcal/d, DXA fat 13.8 → 5.1%: testosterone 623 → 173 ng/dL, T3 123 → 40 ng/dL, ghrelin 383 → 822 pg/mL, RMR 107 → 81% predicted; reversal by month 13. Second case: testosterone 9.22 → 2.27 ng/mL at 4.5% fat, back to 9.91 after recovery. Engine: T −60…−80%; T3 ≥−45% (current fit −53%); HPI ≥90 at the end; DietStrain ≥60.
7. **Appetite feedback (Polidori 2016 [47]) and ketosis timeline (Nymo 2017/2018 [38][39]).** (a) A covert 360 kcal/d energy loss (urinary glucose) over 52 wk, with intake chosen ad libitum as in 8, must yield intake +≈350 kcal/d at equilibrium and ≈95 kcal/d per kg lost for losses ≤≈4 kg. (b) Ketogenic VLED (550/660 kcal, BHB ≈0.6 mM): HPI ↑ in days 1–21 then returns toward baseline by week 4–8 despite 10–16% loss; after refeeding out of ketosis at 16–17% loss, HPI clearly above baseline (observed fasting hunger +38%) and still elevated at 1 y (+22%).
8. **Food-environment intake effects (Weigle 2005 [48]; Hall 2019 [59]; Rolls 2006 [57]).** Ad libitum: protein 15 → 30% at constant carbohydrate → −441 ± 63 kcal/d, −4.9 kg over 12 wk; ultra-processed vs unprocessed → +508 ± 106 kcal/d, weight +0.9 vs −0.9 kg over 2 wk; −25% energy density → −24% intake (−575 kcal/d) over 2 d with unchanged hunger. Engine (ad libitum mode: solve each day for the intake at which `E_k` equals its baseline value, 0): intake differences within ±30% (the protein term alone gives −17%, i.e., −420 kcal/d at 2,400 kcal).

Secondary checks (use if time allows): menstrual disturbance odds (OR 0.91 per kcal/kg FFM/d; P > 0.5 below EA 30) [136]; LH pulse frequency −57% at EA 10 for 5 d [134]; IGF-1 5-d fast and refeeding 1.85 → 0.67 → 1.26 U/mL (0.90 if protein-deficient) [142]; GH production ×5 on day 2 of a fast [140]; cortisol production ×1.8 on day 5 of a fast [105]; ICECAP: breaks lower hunger without changing fat loss [149]; regain ≈71% at 144 wk [164].

---

## 8. Myths / contested claims

| Claim | What the evidence shows |
|---|---|
| "Starvation mode stops fat loss." | Adaptive EE reductions are real but bounded (≈100–500 kcal/d even in extreme cases [99][162]); the larger force is appetite (≈3× EE adaptation) [47]. Plateaus are mostly intake drift [47][170]. |
| "Dieting cortisol causes water retention that hides fat loss, then a 'whoosh'." | No controlled human evidence located. Cortisol rises are small and transient except in fasting [103]; VLCD does not raise plasma cortisol [106]; early restriction causes net fluid *loss* [98]. Scale jumps are better explained by glycogen, sodium and noise (04/13/15). |
| "Stress/dieting cortisol makes you store belly fat." | Only cross-sectional associations (stress reactivity and WHR [113]); HPA findings in obesity inconsistent [114]; energy restriction reduces visceral fat [159]. |
| "A cheat day/refeed resets leptin and metabolism." | Leptin rises within 12–24 h of carbohydrate-rich overfeeding (+28% in 3 d [13]) and falls again with renewed deficit; no evidence of a lasting reset. Structured ≥1-week breaks reduce hunger [149] and may partly reverse adaptive REE [148]. |
| "Ketogenic diets abolish hunger." | Ketosis prevents the weight-loss-induced rise in hunger/ghrelin after ~3 weeks [38][40][41], but ad libitum a ketogenic animal-based diet led to 689 kcal/d *more* intake than a low-fat plant-based diet [61]. Energy density and food form matter at least as much. |
| "High-protein diets crash testosterone." | Only above ≈3.4 g/kg/d (typically ≥35% E with low carbohydrate) [108][126]; 1.25–3.4 g/kg shows no consistent effect [126]. |
| "Low-fat diets tank testosterone." | Small effect: SMD −0.38 [125]. |
| "Fasting boosts testosterone and growth hormone." | GH secretion rises 3–5× [139][140] but testosterone *falls* ≈40% in a 72-h fast [27] and IGF-1 falls [142]. |
| "Eat 6 small meals to control hunger." | 6 vs 3 meals increased hunger AUC by 14% [75]; >3 meals has minimal effect; <3 meals raises appetite [74]. |
| "Lose slowly or you'll regain it." | Regain after 144 weeks was ≈71% whether loss was rapid or gradual [164]; similar in [165]. Slower loss does favour lean mass in lean athletes [176]. |
| "The best diet is X." | Adherence predicts loss (r = 0.60), diet type does not (r = 0.07) [171]; named-diet differences are small [175][174]. |
| "Diet breaks make fat loss more efficient." | Mixed: yes in men with obesity on provided food [148]; no in trained lean adults [149][150]; meta-analyses of intermittent restriction show equivalence [155][156]. Hunger benefit is the most consistent finding. |
| "Obese people are leptin resistant, so leptin changes don't matter." | Falls in leptin during weight loss drive neuroendocrine adaptation, and replacement reverses EE, thyroid and SNS changes in weight-reduced people [25][26]. |
| "Calorie restriction always wrecks mood and libido." | In non-obese adults, 2 y of ≈12–15% CR improved mood and sexual drive [179]; deterioration is characteristic of extreme leanness/semistarvation [118][82]. |

---

## 9. Safety bounds (feed module 17)

1. **Female energy availability.** Warn when `EA7` < 30 kcal/kg FFM/d (LH disruption within 5 days [133]; P(menstrual disturbance) > 0.5 [136]); the planner must not prescribe sustained EA < 30 for women, and should prefer ≥45 when bone health is a goal [138]. Flag `RASI_female` > 50.
2. **Male leanness / EA.** Warn when projected body fat < 6% (men) or `Tt` < 0.5; planner must not target <5% (contest-level suppression [118][119]). Female body-fat floor: warn below 14%, hard stop below 12% (12–14% suggested minimum cited in [137]; primary source not re-verified).
3. **Fasting > 72 h.** Testosterone −40%, T3 −30%, TSH suppressed, cortisol ↑ [27][105] — reversible, but ≥5 days of little/no intake carries refeeding-syndrome risk [84] → defer to 17.
4. **Unsustainable hunger.** Flag HPI ≥80 for ≥14 consecutive days; planner penalty rises steeply above HPI 60; hard-reject regimes whose mean HPI > 85 over the horizon unless the user explicitly chooses a supervised protocol.
5. **Rate of loss.** For lean trained users, cap at ≈0.5–1.0% body weight/week [176][177]; >1.5%/wk: gallstone risk (a cholecystectomy occurred in the rapid arm of [164]) → 17.
6. **Very high protein** >3.4 g/kg/d: testosterone suppression [126] (renal considerations → 17).
7. **Sleep** < 6 h during a deficit: warn (↑ hunger, FFM loss [68]).
8. **Eating-disorder risk.** Aesthetic-sport dieting carries disordered-eating risk [177]; rising disinhibition with continuous restriction [150]; repeated dieting in lean people predisposes to fat overshoot [80]. Show a screening prompt when the user targets contest-level leanness or repeated cycles.
9. **Hormone outputs are population-model projections, not diagnostics**; any symptom (amenorrhoea > 3 months, loss of libido, cold intolerance, dizziness) → advise medical review.
10. **Hormonal contraception / menopause / pregnancy**: the reproductive index is not applicable; pregnancy is a contraindication to deficits (17).

---

## 10. Open questions / weakest assumptions

1. **HPI scale and additivity** (grade D): no validated mapping from kcal-equivalent "effort" to VAS hunger or to dropout; the logistic constants are a scaling choice. The additive combination of protein, fibre, ED, UPF and ketosis effects is assumed; interactions (e.g., ketogenic diets are often high-ED) are handled only through the separate terms.
2. **Saturation of the weight-loss appetite feedback**: Polidori's proportional controller was fitted to ≈3–4 kg losses [47]; the 8%-of-body-weight saturation is inferred from hormone plateaus [37] and hunger magnitudes [39].
3. **Reference-weight drift and restraint capacity** (`τ_ref` 10 y, `E_cap` 700 kcal-eq/d decaying over 3 y) are calibrated to two regain datasets [163][164] only; inter-individual variance unknown.
4. **Leptin fall magnitude** varies ≈2-fold between studies; the model under-predicts the 72-h fall in lean men (≈10% of baseline [27]) and does not reproduce "cumulative-balance" persistence [14].
5. **Leptin-threshold testosterone model**: `L50` = 1.0 ng/mL is fitted to case reports and military data; absolute leptin is assay-dependent; long-term CR suppression beyond leptin (Cangemi [122]) is under-predicted.
6. **T3 with ≥50 g carbohydrate at 800 kcal**: Spaulding reported no change [85] while other VLCD/CR data show falls — the model follows the majority.
7. **Female reproductive recovery time-constant** (30 d) is proposed; Loucks & Verdun show no recovery after 1 day [134]; Hulmi shows recovery by 3–4 months [137].
8. **Sub-daily ghrelin entrainment speed** is unquantified in humans.
9. **Exercise compensation dependence on intensity/modality** not modelled; [72] used supervised aerobic exercise.
10. **Menstrual-cycle phase effects on appetite and hormonal responses, age, and ethnicity** are not modelled here (see 16).
11. **FFM depletion as an appetite driver** (Dulloo [79][80]) is not implemented.
12. **Sumithran 2011 [30] magnitudes** (per-hormone % changes, VAS values) could not be retrieved from full text; only its abstract-level findings are used.
13. **Low-fat SMD → % conversion** for testosterone (−10% at 15% fat) assumes a between-person SD ≈25–30% of the mean (UNVERIFIED).

---

## 11. References

1. Considine RV, Sinha MK, Heiman ML, Kriauciunas A, Stephens TW, Nyce MR et al. Serum immunoreactive-leptin concentrations in normal-weight and obese humans. N Engl J Med 1996;334(5):292-5. PMID: 8532024. doi:10.1056/NEJM199602013340503. https://pubmed.ncbi.nlm.nih.gov/8532024/
2. Rosenbaum M, Nicolson M, Hirsch J, Heymsfield SB, Gallagher D, Chu F et al. Effects of gender, body composition, and menopause on plasma concentrations of leptin. J Clin Endocrinol Metab 1996;81(9):3424-7. PMID: 8784109. doi:10.1210/jcem.81.9.8784109. https://pubmed.ncbi.nlm.nih.gov/8784109/
3. Havel PJ, Kasim-Karakas S, Mueller W, Johnson PR, Gingerich RL, Stern JS. Relationship of plasma leptin to plasma insulin and adiposity in normal weight and overweight women: effects of dietary fat content and sustained weight loss. J Clin Endocrinol Metab 1996;81(12):4406-13. PMID: 8954050. doi:10.1210/jcem.81.12.8954050. https://pubmed.ncbi.nlm.nih.gov/8954050/
4. Ostlund RE, Yang JW, Klein S, Gingerich R. Relation between plasma leptin concentration and body fat, gender, diet, age, and metabolic covariates. J Clin Endocrinol Metab 1996;81(11):3909-13. PMID: 8923837. doi:10.1210/jcem.81.11.8923837. https://pubmed.ncbi.nlm.nih.gov/8923837/
5. Kennedy A, Gettys TW, Watson P, Wallace P, Ganaway E, Pan Q et al. The metabolic significance of leptin in humans: gender-based differences in relationship to adiposity, insulin sensitivity, and energy expenditure. J Clin Endocrinol Metab 1997;82(4):1293-300. PMID: 9100610. doi:10.1210/jcem.82.4.3859. https://pubmed.ncbi.nlm.nih.gov/9100610/
6. Hellström L, Wahrenberg H, Hruska K, Reynisdottir S, Arner P. Mechanisms behind gender differences in circulating leptin levels. J Intern Med 2000;247(4):457-62. PMID: 10792559. doi:10.1046/j.1365-2796.2000.00678.x. https://pubmed.ncbi.nlm.nih.gov/10792559/
7. Isidori AM, Strollo F, Morè M, Caprio M, Aversa A, Moretti C et al. Leptin and aging: correlation with endocrine changes in male and female healthy adult populations of different body weights. J Clin Endocrinol Metab 2000;85(5):1954-62. PMID: 10843181. doi:10.1210/jcem.85.5.6572. https://pubmed.ncbi.nlm.nih.gov/10843181/
8. Klein S, Coppack SW, Mohamed-Ali V, Landt M. Adipose tissue leptin production and plasma leptin kinetics in humans. Diabetes 1996;45(7):984-7. PMID: 8666153. doi:10.2337/diab.45.7.984. https://pubmed.ncbi.nlm.nih.gov/8666153/
9. Schoeller DA, Cella LK, Sinha MK, Caro JF. Entrainment of the diurnal rhythm of plasma leptin to meal timing. J Clin Invest 1997;100(7):1882-7. PMID: 9312190. doi:10.1172/JCI119717. https://pubmed.ncbi.nlm.nih.gov/9312190/
10. Boden G, Chen X, Mozzoli M, Ryan I. Effect of fasting on serum leptin in normal human subjects. J Clin Endocrinol Metab 1996;81(9):3419-23. PMID: 8784108. doi:10.1210/jcem.81.9.8784108. https://pubmed.ncbi.nlm.nih.gov/8784108/
11. Kolaczynski JW, Considine RV, Ohannesian J, Marco C, Opentanova I, Nyce MR et al. Responses of leptin to short-term fasting and refeeding in humans: a link with ketogenesis but not ketones themselves. Diabetes 1996;45(11):1511-5. PMID: 8866554. doi:10.2337/diab.45.11.1511. https://pubmed.ncbi.nlm.nih.gov/8866554/
12. Weigle DS, Duell PB, Connor WE, Steiner RA, Soules MR, Kuijper JL. Effect of fasting, refeeding, and dietary fat restriction on plasma leptin levels. J Clin Endocrinol Metab 1997;82(2):561-5. PMID: 9024254. doi:10.1210/jcem.82.2.3757. https://pubmed.ncbi.nlm.nih.gov/9024254/
13. Dirlewanger M, di Vetta V, Guenat E, Battilana P, Seematter G, Schneiter P et al. Effects of short-term carbohydrate or fat overfeeding on energy expenditure and plasma leptin concentrations in healthy female subjects. Int J Obes Relat Metab Disord 2000;24(11):1413-8. PMID: 11126336. doi:10.1038/sj.ijo.0801395. https://pubmed.ncbi.nlm.nih.gov/11126336/
14. Chin-Chance C, Polonsky KS, Schoeller DA. Twenty-four-hour leptin levels respond to cumulative short-term energy imbalance and predict subsequent intake. J Clin Endocrinol Metab 2000;85(8):2685-91. PMID: 10946866. doi:10.1210/jcem.85.8.6755. https://pubmed.ncbi.nlm.nih.gov/10946866/
15. Keim NL, Stern JS, Havel PJ. Relation between circulating leptin concentrations and appetite during a prolonged, moderate energy deficit in women. Am J Clin Nutr 1998;68(4):794-801. PMID: 9771856. doi:10.1093/ajcn/68.4.794. https://pubmed.ncbi.nlm.nih.gov/9771856/
16. Wisse BE, Campfield LA, Marliss EB, Morais JA, Tenenbaum R, Gougeon R. Effect of prolonged moderate and severe energy restriction and refeeding on plasma leptin concentrations in obese women. Am J Clin Nutr 1999;70(3):321-30. PMID: 10479193. doi:10.1093/ajcn/70.3.321. https://pubmed.ncbi.nlm.nih.gov/10479193/
17. Mars M, de Graaf C, de Groot LC, Kok FJ. Decreases in fasting leptin and insulin concentrations after acute energy restriction and subsequent compensation in food intake. Am J Clin Nutr 2005;81(3):570-7. PMID: 15755824. doi:10.1093/ajcn/81.3.570. https://pubmed.ncbi.nlm.nih.gov/15755824/
18. Dubuc GR, Phinney SD, Stern JS, Havel PJ. Changes of serum leptin and endocrine and metabolic parameters after 7 days of energy restriction in men and women. Metabolism 1998;47(4):429-34. PMID: 9550541. doi:10.1016/s0026-0495(98)90055-5. https://pubmed.ncbi.nlm.nih.gov/9550541/
19. Doucet E, Pomerleau M, Harper ME. Fasting and postprandial total ghrelin remain unchanged after short-term energy restriction. J Clin Endocrinol Metab 2004;89(4):1727-32. PMID: 15070937. doi:10.1210/jc.2003-031459. https://pubmed.ncbi.nlm.nih.gov/15070937/
20. Havel PJ, Townsend R, Chaump L, Teff K. High-fat meals reduce 24-h circulating leptin concentrations in women. Diabetes 1999;48(2):334-41. PMID: 10334310. doi:10.2337/diabetes.48.2.334. https://pubmed.ncbi.nlm.nih.gov/10334310/
21. Teff KL, Elliott SS, Tschöp M, Kieffer TJ, Rader D, Heiman M et al. Dietary fructose reduces circulating insulin and leptin, attenuates postprandial suppression of ghrelin, and increases triglycerides in women. J Clin Endocrinol Metab 2004;89(6):2963-72. PMID: 15181085. doi:10.1210/jc.2003-031855. https://pubmed.ncbi.nlm.nih.gov/15181085/
22. Koehler K, Hoerner NR, Gibbs JC, Zinner C, Braun H, De Souza MJ et al. Low energy availability in exercising men is associated with reduced leptin and insulin but not with changes in other metabolic hormones. J Sports Sci 2016;34(20):1921-9. PMID: 26852783. doi:10.1080/02640414.2016.1142109. https://pubmed.ncbi.nlm.nih.gov/26852783/
23. Rosenbaum M, Nicolson M, Hirsch J, Murphy E, Chu F, Leibel RL. Effects of weight change on plasma leptin concentrations and energy expenditure. J Clin Endocrinol Metab 1997;82(11):3647-54. PMID: 9360521. doi:10.1210/jcem.82.11.4390. https://pubmed.ncbi.nlm.nih.gov/9360521/
24. Leibel RL, Rosenbaum M, Hirsch J. Changes in energy expenditure resulting from altered body weight. N Engl J Med 1995;332(10):621-8. PMID: 7632212. doi:10.1056/NEJM199503093321001. https://pubmed.ncbi.nlm.nih.gov/7632212/
25. Rosenbaum M, Murphy EM, Heymsfield SB, Matthews DE, Leibel RL. Low dose leptin administration reverses effects of sustained weight-reduction on energy expenditure and circulating concentrations of thyroid hormones. J Clin Endocrinol Metab 2002;87(5):2391-4. PMID: 11994393. doi:10.1210/jcem.87.5.8628. https://pubmed.ncbi.nlm.nih.gov/11994393/
26. Rosenbaum M, Goldsmith R, Bloomfield D, Magnano A, Weimer L, Heymsfield S et al. Low-dose leptin reverses skeletal muscle, autonomic, and neuroendocrine adaptations to maintenance of reduced weight. J Clin Invest 2005;115(12):3579-86. PMID: 16322796. doi:10.1172/JCI25977. https://pubmed.ncbi.nlm.nih.gov/16322796/
27. Chan JL, Heist K, DePaoli AM, Veldhuis JD, Mantzoros CS. The role of falling leptin levels in the neuroendocrine and metabolic adaptation to short-term starvation in healthy men. J Clin Invest 2003;111(9):1409-21. PMID: 12727933. doi:10.1172/JCI17490. https://pubmed.ncbi.nlm.nih.gov/12727933/
28. Welt CK, Chan JL, Bullen J, Murphy R, Smith P, DePaoli AM et al. Recombinant human leptin in women with hypothalamic amenorrhea. N Engl J Med 2004;351(10):987-97. PMID: 15342807. doi:10.1056/NEJMoa040388. https://pubmed.ncbi.nlm.nih.gov/15342807/
29. Ahima RS, Prabakaran D, Mantzoros C, Qu D, Lowell B, Maratos-Flier E et al. Role of leptin in the neuroendocrine response to fasting. Nature 1996;382(6588):250-2. PMID: 8717038. doi:10.1038/382250a0. https://pubmed.ncbi.nlm.nih.gov/8717038/
30. Sumithran P, Prendergast LA, Delbridge E, Purcell K, Shulkes A, Kriketos A et al. Long-term persistence of hormonal adaptations to weight loss. N Engl J Med 2011;365(17):1597-604. PMID: 22029981. doi:10.1056/NEJMoa1105816. https://pubmed.ncbi.nlm.nih.gov/22029981/
31. Cummings DE, Weigle DS, Frayo RS, Breen PA, Ma MK, Dellinger EP et al. Plasma ghrelin levels after diet-induced weight loss or gastric bypass surgery. N Engl J Med 2002;346(21):1623-30. PMID: 12023994. doi:10.1056/NEJMoa012908. https://pubmed.ncbi.nlm.nih.gov/12023994/
32. Cummings DE, Purnell JQ, Frayo RS, Schmidova K, Wisse BE, Weigle DS. A preprandial rise in plasma ghrelin levels suggests a role in meal initiation in humans. Diabetes 2001;50(8):1714-9. PMID: 11473029. doi:10.2337/diabetes.50.8.1714. https://pubmed.ncbi.nlm.nih.gov/11473029/
33. Wren AM, Seal LJ, Cohen MA, Brynes AE, Frost GS, Murphy KG et al. Ghrelin enhances appetite and increases food intake in humans. J Clin Endocrinol Metab 2001;86(12):5992. PMID: 11739476. doi:10.1210/jcem.86.12.8111. https://pubmed.ncbi.nlm.nih.gov/11739476/
34. Frecka JM, Mattes RD. Possible entrainment of ghrelin to habitual meal patterns in humans. Am J Physiol Gastrointest Liver Physiol 2008;294(3):G699-707. PMID: 18187517. doi:10.1152/ajpgi.00448.2007. https://pubmed.ncbi.nlm.nih.gov/18187517/
35. Natalucci G, Riedl S, Gleiss A, Zidek T, Frisch H. Spontaneous 24-h ghrelin secretion pattern in fasting subjects: maintenance of a meal-related pattern. Eur J Endocrinol 2005;152(6):845-50. PMID: 15941923. doi:10.1530/eje.1.01919. https://pubmed.ncbi.nlm.nih.gov/15941923/
36. Espelund U, Hansen TK, Højlund K, Beck-Nielsen H, Clausen JT, Hansen BS et al. Fasting unmasks a strong inverse association between ghrelin and cortisol in serum: studies in obese and normal-weight subjects. J Clin Endocrinol Metab 2005;90(2):741-6. PMID: 15522942. doi:10.1210/jc.2004-0604. https://pubmed.ncbi.nlm.nih.gov/15522942/
37. Edwards KL, Prendergast LA, Kalfas S, Sumithran P, Proietto J. Impact of starting BMI and degree of weight loss on changes in appetite-regulating hormones during diet-induced weight loss. Obesity (Silver Spring) 2022;30(4):911-919. PMID: 35253406. doi:10.1002/oby.23404. https://pubmed.ncbi.nlm.nih.gov/35253406/
38. Nymo S, Coutinho SR, Jørgensen J, Rehfeld JF, Truby H, Kulseng B et al. Timeline of changes in appetite during weight loss with a ketogenic diet. Int J Obes (Lond) 2017;41(8):1224-1231. PMID: 28439092. doi:10.1038/ijo.2017.96. https://pubmed.ncbi.nlm.nih.gov/28439092/
39. Nymo S, Coutinho SR, Eknes PH, Vestbostad I, Rehfeld JF, Truby H et al. Investigation of the long-term sustainability of changes in appetite after weight loss. Int J Obes (Lond) 2018;42(8):1489-1499. PMID: 29930313. doi:10.1038/s41366-018-0119-9. https://pubmed.ncbi.nlm.nih.gov/29930313/
40. Sumithran P, Prendergast LA, Delbridge E, Purcell K, Shulkes A, Kriketos A et al. Ketosis and appetite-mediating nutrients and hormones after weight loss. Eur J Clin Nutr 2013;67(7):759-64. PMID: 23632752. doi:10.1038/ejcn.2013.90. https://pubmed.ncbi.nlm.nih.gov/23632752/
41. Gibson AA, Seimon RV, Lee CM, Ayre J, Franklin J, Markovic TP et al. Do ketogenic diets really suppress appetite? A systematic review and meta-analysis. Obes Rev 2015;16(1):64-76. PMID: 25402637. doi:10.1111/obr.12230. https://pubmed.ncbi.nlm.nih.gov/25402637/
42. Deemer SE, Plaisance EP, Martins C. Impact of ketosis on appetite regulation-a review. Nutr Res 2020;77:1-11. PMID: 32193016. doi:10.1016/j.nutres.2020.02.010. https://pubmed.ncbi.nlm.nih.gov/32193016/
43. Pasiakos SM, Caruso CM, Kellogg MD, Kramer FM, Lieberman HR. Appetite and endocrine regulators of energy balance after 2 days of energy restriction: insulin, leptin, ghrelin, and DHEA-S. Obesity (Silver Spring) 2011;19(6):1124-30. PMID: 21212768. doi:10.1038/oby.2010.316. https://pubmed.ncbi.nlm.nih.gov/21212768/
44. Kohanmoo A, Faghih S, Akhlaghi M. Effect of short- and long-term protein consumption on appetite and appetite-regulating gastrointestinal hormones, a systematic review and meta-analysis of randomized controlled trials. Physiol Behav 2020;226:113123. PMID: 32768415. doi:10.1016/j.physbeh.2020.113123. https://pubmed.ncbi.nlm.nih.gov/32768415/
45. Batterham RL, Heffron H, Kapoor S, Chivers JE, Chandarana K, Herzog H et al. Critical role for peptide YY in protein-mediated satiation and body-weight regulation. Cell Metab 2006;4(3):223-33. PMID: 16950139. doi:10.1016/j.cmet.2006.08.001. https://pubmed.ncbi.nlm.nih.gov/16950139/
46. Leidy HJ, Ortinau LC, Douglas SM, Hoertel HA. Beneficial effects of a higher-protein breakfast on the appetitive, hormonal, and neural signals controlling energy intake regulation in overweight/obese, "breakfast-skipping," late-adolescent girls. Am J Clin Nutr 2013;97(4):677-88. PMID: 23446906. doi:10.3945/ajcn.112.053116. https://pubmed.ncbi.nlm.nih.gov/23446906/
47. Polidori D, Sanghvi A, Seeley RJ, Hall KD. How Strongly Does Appetite Counter Weight Loss? Quantification of the Feedback Control of Human Energy Intake. Obesity (Silver Spring) 2016;24(11):2289-2295. PMID: 27804272. doi:10.1002/oby.21653. https://pubmed.ncbi.nlm.nih.gov/27804272/
48. Weigle DS, Breen PA, Matthys CC, Callahan HS, Meeuws KE, Burden VR et al. A high-protein diet induces sustained reductions in appetite, ad libitum caloric intake, and body weight despite compensatory changes in diurnal plasma leptin and ghrelin concentrations. Am J Clin Nutr 2005;82(1):41-8. PMID: 16002798. doi:10.1093/ajcn.82.1.41. https://pubmed.ncbi.nlm.nih.gov/16002798/
49. Gosby AK, Conigrave AD, Lau NS, Iglesias MA, Hall RM, Jebb SA et al. Testing protein leverage in lean humans: a randomised controlled experimental study. PLoS One 2011;6(10):e25929. PMID: 22022472. doi:10.1371/journal.pone.0025929. https://pubmed.ncbi.nlm.nih.gov/22022472/
50. Simpson SJ, Raubenheimer D. Obesity: the protein leverage hypothesis. Obes Rev 2005;6(2):133-42. PMID: 15836464. doi:10.1111/j.1467-789X.2005.00178.x. https://pubmed.ncbi.nlm.nih.gov/15836464/
51. Leidy HJ, Clifton PM, Astrup A, Wycherley TP, Westerterp-Plantenga MS, Luscombe-Marsh ND et al. The role of protein in weight loss and maintenance. Am J Clin Nutr 2015;101(6):1320S-1329S. PMID: 25926512. doi:10.3945/ajcn.114.084038. https://pubmed.ncbi.nlm.nih.gov/25926512/
52. Dhillon J, Craig BA, Leidy HJ, Amankwaah AF, Osei-Boadi Anguah K, Jacobs A et al. The Effects of Increased Protein Intake on Fullness: A Meta-Analysis and Its Limitations. J Acad Nutr Diet 2016;116(6):968-83. PMID: 26947338. doi:10.1016/j.jand.2016.01.003. https://pubmed.ncbi.nlm.nih.gov/26947338/
53. Wanders AJ, van den Borne JJ, de Graaf C, Hulshof T, Jonathan MC, Kristensen M et al. Effects of dietary fibre on subjective appetite, energy intake and body weight: a systematic review of randomized controlled trials. Obes Rev 2011;12(9):724-39. PMID: 21676152. doi:10.1111/j.1467-789X.2011.00895.x. https://pubmed.ncbi.nlm.nih.gov/21676152/
54. Howarth NC, Saltzman E, Roberts SB. Dietary fiber and weight regulation. Nutr Rev 2001;59(5):129-39. PMID: 11396693. doi:10.1111/j.1753-4887.2001.tb07001.x. https://pubmed.ncbi.nlm.nih.gov/11396693/
55. Bell EA, Castellanos VH, Pelkman CL, Thorwart ML, Rolls BJ. Energy density of foods affects energy intake in normal-weight women. Am J Clin Nutr 1998;67(3):412-20. PMID: 9497184. doi:10.1093/ajcn/67.3.412. https://pubmed.ncbi.nlm.nih.gov/9497184/
56. Rolls BJ, Bell EA, Thorwart ML. Water incorporated into a food but not served with a food decreases energy intake in lean women. Am J Clin Nutr 1999;70(4):448-55. PMID: 10500012. doi:10.1093/ajcn/70.4.448. https://pubmed.ncbi.nlm.nih.gov/10500012/
57. Rolls BJ, Roe LS, Meengs JS. Reductions in portion size and energy density of foods are additive and lead to sustained decreases in energy intake. Am J Clin Nutr 2006;83(1):11-7. PMID: 16400043. doi:10.1093/ajcn/83.1.11. https://pubmed.ncbi.nlm.nih.gov/16400043/
58. Ello-Martin JA, Roe LS, Ledikwe JH, Beach AM, Rolls BJ. Dietary energy density in the treatment of obesity: a year-long trial comparing 2 weight-loss diets. Am J Clin Nutr 2007;85(6):1465-77. PMID: 17556681. doi:10.1093/ajcn/85.6.1465. https://pubmed.ncbi.nlm.nih.gov/17556681/
59. Hall KD, Ayuketah A, Brychta R, Cai H, Cassimatis T, Chen KY et al. Ultra-Processed Diets Cause Excess Calorie Intake and Weight Gain: An Inpatient Randomized Controlled Trial of Ad Libitum Food Intake. Cell Metab 2019;30(1):67-77.e3. PMID: 31105044. doi:10.1016/j.cmet.2019.05.008. https://pubmed.ncbi.nlm.nih.gov/31105044/
60. Robinson E, Almiron-Roig E, Rutters F, de Graaf C, Forde CG, Tudur Smith C et al. A systematic review and meta-analysis examining the effect of eating rate on energy intake and hunger. Am J Clin Nutr 2014;100(1):123-51. PMID: 24847856. doi:10.3945/ajcn.113.081745. https://pubmed.ncbi.nlm.nih.gov/24847856/
61. Hall KD, Guo J, Courville AB, Boring J, Brychta R, Chen KY et al. Effect of a plant-based, low-fat diet versus an animal-based, ketogenic diet on ad libitum energy intake. Nat Med 2021;27(2):344-353. PMID: 33479499. doi:10.1038/s41591-020-01209-1. https://pubmed.ncbi.nlm.nih.gov/33479499/
62. Struik NA, Brinkworth GD, Thompson CH, Buckley JD, Wittert G, Luscombe-Marsh ND. Very Low and Higher Carbohydrate Diets Promote Differential Appetite Responses in Adults with Type 2 Diabetes: A Randomized Trial. J Nutr 2020;150(4):800-805. PMID: 31953540. doi:10.1093/jn/nxz344. https://pubmed.ncbi.nlm.nih.gov/31953540/
63. Holt SH, Miller JC, Petocz P, Farmakalidis E. A satiety index of common foods. Eur J Clin Nutr 1995;49(9):675-90. PMID: 7498104. https://pubmed.ncbi.nlm.nih.gov/7498104/
64. DiMeglio DP, Mattes RD. Liquid versus solid carbohydrate: effects on food intake and body weight. Int J Obes Relat Metab Disord 2000;24(6):794-800. PMID: 10878689. doi:10.1038/sj.ijo.0801229. https://pubmed.ncbi.nlm.nih.gov/10878689/
65. Mourao DM, Bressan J, Campbell WW, Mattes RD. Effects of food form on appetite and energy intake in lean and obese young adults. Int J Obes (Lond) 2007;31(11):1688-95. PMID: 17579632. doi:10.1038/sj.ijo.0803667. https://pubmed.ncbi.nlm.nih.gov/17579632/
66. Spiegel K, Tasali E, Penev P, Van Cauter E. Brief communication: Sleep curtailment in healthy young men is associated with decreased leptin levels, elevated ghrelin levels, and increased hunger and appetite. Ann Intern Med 2004;141(11):846-50. PMID: 15583226. doi:10.7326/0003-4819-141-11-200412070-00008. https://pubmed.ncbi.nlm.nih.gov/15583226/
67. Al Khatib HK, Harding SV, Darzi J, Pot GK. The effects of partial sleep deprivation on energy balance: a systematic review and meta-analysis. Eur J Clin Nutr 2017;71(5):614-624. PMID: 27804960. doi:10.1038/ejcn.2016.201. https://pubmed.ncbi.nlm.nih.gov/27804960/
68. Nedeltcheva AV, Kilkus JM, Imperial J, Schoeller DA, Penev PD. Insufficient sleep undermines dietary efforts to reduce adiposity. Ann Intern Med 2010;153(7):435-41. PMID: 20921542. doi:10.7326/0003-4819-153-7-201010050-00006. https://pubmed.ncbi.nlm.nih.gov/20921542/
69. Schubert MM, Desbrow B, Sabapathy S, Leveritt M. Acute exercise and subsequent energy intake. A meta-analysis. Appetite 2013;63:92-104. PMID: 23274127. doi:10.1016/j.appet.2012.12.010. https://pubmed.ncbi.nlm.nih.gov/23274127/
70. Schubert MM, Sabapathy S, Leveritt M, Desbrow B. Acute exercise and hormones related to appetite regulation: a meta-analysis. Sports Med 2014;44(3):387-403. PMID: 24174308. doi:10.1007/s40279-013-0120-3. https://pubmed.ncbi.nlm.nih.gov/24174308/
71. King NA, Hopkins M, Caudwell P, Stubbs RJ, Blundell JE. Individual variability following 12 weeks of supervised exercise: identification and characterization of compensation for exercise-induced weight loss. Int J Obes (Lond) 2008;32(1):177-84. PMID: 17848941. doi:10.1038/sj.ijo.0803712. https://pubmed.ncbi.nlm.nih.gov/17848941/
72. Martin CK, Johnson WD, Myers CA, Apolzan JW, Earnest CP, Thomas DM et al. Effect of different doses of supervised exercise on food intake, metabolism, and non-exercise physical activity: The E-MECHANIC randomized controlled trial. Am J Clin Nutr 2019;110(3):583-592. PMID: 31172175. doi:10.1093/ajcn/nqz054. https://pubmed.ncbi.nlm.nih.gov/31172175/
73. Dorling J, Broom DR, Burns SF, Clayton DJ, Deighton K, James LJ et al. Acute and Chronic Effects of Exercise on Appetite, Energy Intake, and Appetite-Related Hormones: The Modulating Effect of Adiposity, Sex, and Habitual Physical Activity. Nutrients 2018;10(9). PMID: 30131457. doi:10.3390/nu10091140. https://pubmed.ncbi.nlm.nih.gov/30131457/
74. Leidy HJ, Campbell WW. The effect of eating frequency on appetite control and food intake: brief synopsis of controlled feeding studies. J Nutr 2011;141(1):154-7. PMID: 21123467. doi:10.3945/jn.109.114389. https://pubmed.ncbi.nlm.nih.gov/21123467/
75. Ohkawara K, Cornier MA, Kohrt WM, Melanson EL. Effects of increased meal frequency on fat oxidation and perceived hunger. Obesity (Silver Spring) 2013;21(2):336-43. PMID: 23404961. doi:10.1002/oby.20032. https://pubmed.ncbi.nlm.nih.gov/23404961/
76. Ravussin E, Beyl RA, Poggiogalle E, Hsia DS, Peterson CM. Early Time-Restricted Feeding Reduces Appetite and Increases Fat Oxidation But Does Not Affect Energy Expenditure in Humans. Obesity (Silver Spring) 2019;27(8):1244-1254. PMID: 31339000. doi:10.1002/oby.22518. https://pubmed.ncbi.nlm.nih.gov/31339000/
77. Sutton EF, Beyl R, Early KS, Cefalu WT, Ravussin E, Peterson CM. Early Time-Restricted Feeding Improves Insulin Sensitivity, Blood Pressure, and Oxidative Stress Even without Weight Loss in Men with Prediabetes. Cell Metab 2018;27(6):1212-1221.e3. PMID: 29754952. doi:10.1016/j.cmet.2018.04.010. https://pubmed.ncbi.nlm.nih.gov/29754952/
78. Karl JP, Smith TJ, Wilson MA, Bukhari AS, Pasiakos SM, McClung HL et al. Altered metabolic homeostasis is associated with appetite regulation during and following 48-h of severe energy deprivation in adults. Metabolism 2016;65(4):416-27. PMID: 26975533. doi:10.1016/j.metabol.2015.11.001. https://pubmed.ncbi.nlm.nih.gov/26975533/
79. Dulloo AG, Jacquet J, Girardier L. Poststarvation hyperphagia and body fat overshooting in humans: a role for feedback signals from lean and fat tissues. Am J Clin Nutr 1997;65(3):717-23. PMID: 9062520. doi:10.1093/ajcn/65.3.717. https://pubmed.ncbi.nlm.nih.gov/9062520/
80. Dulloo AG, Jacquet J, Montani JP, Schutz Y. How dieting makes the lean fatter: from a perspective of body composition autoregulation through adipostats and proteinstats awaiting discovery. Obes Rev 2015;16 Suppl 1:25-35. PMID: 25614201. doi:10.1111/obr.12253. https://pubmed.ncbi.nlm.nih.gov/25614201/
81. Dulloo AG. Physiology of weight regain: Lessons from the classic Minnesota Starvation Experiment on human body composition regulation. Obes Rev 2021;22 Suppl 2:e13189. PMID: 33543573. doi:10.1111/obr.13189. https://pubmed.ncbi.nlm.nih.gov/33543573/
82. Kalm LM, Semba RD. They starved so that others be better fed: remembering Ancel Keys and the Minnesota experiment. J Nutr 2005;135(6):1347-52. PMID: 15930436. doi:10.1093/jn/135.6.1347. https://pubmed.ncbi.nlm.nih.gov/15930436/
83. Keys A, Henschel A, Mickelsen O, Taylor HL. The Biology of Human Starvation (Vols. 1–2). Minneapolis, MN: University of Minnesota Press; 1950. (Book; no PMID/DOI; citation form as given in the reference list of Dulloo AG, Rev Endocr Metab Disord 2025, PMC12534267.)
84. Hemstreet DE, Weisz GM. One Page in the History of Starvation and Refeeding. Rambam Maimonides Med J 2024;15(2). PMID: 38717179. doi:10.5041/RMMJ.10524. https://pubmed.ncbi.nlm.nih.gov/38717179/
85. Spaulding SW, Chopra IJ, Sherwin RS, Lyall SS. Effect of caloric restriction and dietary composition of serum T3 and reverse T3 in man. J Clin Endocrinol Metab 1976;42(1):197-200. PMID: 1249190. doi:10.1210/jcem-42-1-197. https://pubmed.ncbi.nlm.nih.gov/1249190/
86. Danforth E, Horton ES, O'Connell M, Sims EA, Burger AG, Ingbar SH et al. Dietary-induced alterations in thyroid hormone metabolism during overnutrition. J Clin Invest 1979;64(5):1336-47. PMID: 500814. doi:10.1172/JCI109590. https://pubmed.ncbi.nlm.nih.gov/500814/
87. Vagenakis AG, Burger A, Portnary GI, Rudolph M, O'Brian JR, Azizi F et al. Diversion of peripheral thyroxine metabolism from activating to inactivating pathways during complete fasting. J Clin Endocrinol Metab 1975;41(1):191-4. PMID: 1150863. doi:10.1210/jcem-41-1-191. https://pubmed.ncbi.nlm.nih.gov/1150863/
88. Spencer CA, Lum SM, Wilber JF, Kaptein EM, Nicoloff JT. Dynamics of serum thyrotropin and thyroid hormone changes in fasting. J Clin Endocrinol Metab 1983;56(5):883-8. PMID: 6403568. doi:10.1210/jcem-56-5-883. https://pubmed.ncbi.nlm.nih.gov/6403568/
89. Mathieson RA, Walberg JL, Gwazdauskas FC, Hinkle DE, Gregg JM. The effect of varying carbohydrate content of a very-low-caloric diet on resting metabolic rate and thyroid hormones. Metabolism 1986;35(5):394-8. PMID: 3702673. doi:10.1016/0026-0495(86)90126-5. https://pubmed.ncbi.nlm.nih.gov/3702673/
90. Bisschop PH, Sauerwein HP, Endert E, Romijn JA. Isocaloric carbohydrate deprivation induces protein catabolism despite a low T3-syndrome in healthy men. Clin Endocrinol (Oxf) 2001;54(1):75-80. PMID: 11167929. doi:10.1046/j.1365-2265.2001.01158.x. https://pubmed.ncbi.nlm.nih.gov/11167929/
91. Serog P, Apfelbaum M, Autissier N, Baigts F, Brigant L, Ktorza A. Effects of slimming and composition of diets on VO2 and thyroid hormones in healthy subjects. Am J Clin Nutr 1982;35(1):24-35. PMID: 7064875. doi:10.1093/ajcn/35.1.24. https://pubmed.ncbi.nlm.nih.gov/7064875/
92. Iacovides S, Maloney SK, Bhana S, Angamia Z, Meiring RM. Could the ketogenic diet induce a shift in thyroid function and support a metabolic advantage in healthy participants? A pilot randomized-controlled-crossover trial. PLoS One 2022;17(6):e0269440. PMID: 35658056. doi:10.1371/journal.pone.0269440. https://pubmed.ncbi.nlm.nih.gov/35658056/
93. Hall KD, Chen KY, Guo J, Lam YY, Leibel RL, Mayer LE et al. Energy expenditure and body composition changes after an isocaloric ketogenic diet in overweight and obese men. Am J Clin Nutr 2016;104(2):324-33. PMID: 27385608. doi:10.3945/ajcn.116.133561. https://pubmed.ncbi.nlm.nih.gov/27385608/
94. Ebbeling CB, Swain JF, Feldman HA, Wong WW, Hachey DL, Garcia-Lago E et al. Effects of dietary composition on energy expenditure during weight-loss maintenance. JAMA 2012;307(24):2627-34. PMID: 22735432. doi:10.1001/jama.2012.6607. https://pubmed.ncbi.nlm.nih.gov/22735432/
95. Fontana L, Klein S, Holloszy JO, Premachandra BN. Effect of long-term calorie restriction with adequate protein and micronutrients on thyroid hormones. J Clin Endocrinol Metab 2006;91(8):3232-5. PMID: 16720655. doi:10.1210/jc.2006-0328. https://pubmed.ncbi.nlm.nih.gov/16720655/
96. Redman LM, Smith SR, Burton JH, Martin CK, Il'yasova D, Ravussin E. Metabolic Slowing and Reduced Oxidative Damage with Sustained Caloric Restriction Support the Rate of Living and Oxidative Damage Theories of Aging. Cell Metab 2018;27(4):805-815.e4. PMID: 29576535. doi:10.1016/j.cmet.2018.02.019. https://pubmed.ncbi.nlm.nih.gov/29576535/
97. Heilbronn LK, de Jonge L, Frisard MI, DeLany JP, Larson-Meyer DE, Rood J et al. Effect of 6-month calorie restriction on biomarkers of longevity, metabolic adaptation, and oxidative stress in overweight individuals: a randomized controlled trial. JAMA 2006;295(13):1539-48. PMID: 16595757. doi:10.1001/jama.295.13.1539. https://pubmed.ncbi.nlm.nih.gov/16595757/
98. Müller MJ, Enderle J, Pourhassan M, Braun W, Eggeling B, Lagerpusch M et al. Metabolic adaptation to caloric restriction and subsequent refeeding: the Minnesota Starvation Experiment revisited. Am J Clin Nutr 2015;102(4):807-19. PMID: 26399868. doi:10.3945/ajcn.115.109173. https://pubmed.ncbi.nlm.nih.gov/26399868/
99. Johannsen DL, Knuth ND, Huizenga R, Rood JC, Ravussin E, Hall KD. Metabolic slowing with massive weight loss despite preservation of fat-free mass. J Clin Endocrinol Metab 2012;97(7):2489-96. PMID: 22535969. doi:10.1210/jc.2012-1444. https://pubmed.ncbi.nlm.nih.gov/22535969/
100. al-Adsani H, Hoffer LJ, Silva JE. Resting energy expenditure is sensitive to small dose changes in patients on chronic thyroid hormone replacement. J Clin Endocrinol Metab 1997;82(4):1118-25. PMID: 9100583. doi:10.1210/jcem.82.4.3873. https://pubmed.ncbi.nlm.nih.gov/9100583/
101. Kim B. Thyroid hormone as a determinant of energy expenditure and the basal metabolic rate. Thyroid 2008;18(2):141-4. PMID: 18279014. doi:10.1089/thy.2007.0266. https://pubmed.ncbi.nlm.nih.gov/18279014/
102. Douyon L, Schteingart DE. Effect of obesity and starvation on thyroid hormone, growth hormone, and cortisol secretion. Endocrinol Metab Clin North Am 2002;31(1):173-89. PMID: 12055988. doi:10.1016/s0889-8529(01)00023-8. https://pubmed.ncbi.nlm.nih.gov/12055988/
103. Nakamura Y, Walker BR, Ikuta T. Systematic review and meta-analysis reveals acutely elevated plasma cortisol following fasting but not less severe calorie restriction. Stress 2016;19(2):151-7. PMID: 26586092. doi:10.3109/10253890.2015.1121984. https://pubmed.ncbi.nlm.nih.gov/26586092/
104. Tomiyama AJ, Mann T, Vinas D, Hunger JM, Dejager J, Taylor SE. Low calorie dieting increases cortisol. Psychosom Med 2010;72(4):357-64. PMID: 20368473. doi:10.1097/PSY.0b013e3181d9523c. https://pubmed.ncbi.nlm.nih.gov/20368473/
105. Bergendahl M, Vance ML, Iranmanesh A, Thorner MO, Veldhuis JD. Fasting as a metabolic stress paradigm selectively amplifies cortisol secretory burst mass and delays the time of maximal nyctohemeral cortisol concentrations in healthy men. J Clin Endocrinol Metab 1996;81(2):692-9. PMID: 8636290. doi:10.1210/jcem.81.2.8636290. https://pubmed.ncbi.nlm.nih.gov/8636290/
106. Johnstone AM, Faber P, Andrew R, Gibney ER, Elia M, Lobley G et al. Influence of short-term dietary weight loss on cortisol secretion and metabolism in obese men. Eur J Endocrinol 2004;150(2):185-94. PMID: 14763916. doi:10.1530/eje.0.1500185. https://pubmed.ncbi.nlm.nih.gov/14763916/
107. Fontana L, Villareal DT, Das SK, Smith SR, Meydani SN, Pittas AG et al. Effects of 2-year calorie restriction on circulating levels of IGF-1, IGF-binding proteins and cortisol in nonobese men and women: a randomized clinical trial. Aging Cell 2016;15(1):22-7. PMID: 26443692. doi:10.1111/acel.12400. https://pubmed.ncbi.nlm.nih.gov/26443692/
108. Whittaker J, Harris M. Low-carbohydrate diets and men's cortisol and testosterone: Systematic review and meta-analysis. Nutr Health 2022;28(4):543-554. PMID: 35254136. doi:10.1177/02601060221083079. https://pubmed.ncbi.nlm.nih.gov/35254136/
109. Anderson KE, Rosner W, Khan MS, New MI, Pang SY, Wissel PS et al. Diet-hormone interactions: protein/carbohydrate ratio alters reciprocally the plasma levels of testosterone and cortisol and their respective binding globulins in man. Life Sci 1987;40(18):1761-8. PMID: 3573976. doi:10.1016/0024-3205(87)90086-5. https://pubmed.ncbi.nlm.nih.gov/3573976/
110. Stimson RH, Johnstone AM, Homer NZ, Wake DJ, Morton NM, Andrew R et al. Dietary macronutrient content alters cortisol metabolism independently of body weight changes in obese men. J Clin Endocrinol Metab 2007;92(11):4480-4. PMID: 17785367. doi:10.1210/jc.2007-0692. https://pubmed.ncbi.nlm.nih.gov/17785367/
111. Hill EE, Zack E, Battaglini C, Viru M, Viru A, Hackney AC. Exercise and circulating cortisol levels: the intensity threshold effect. J Endocrinol Invest 2008;31(7):587-91. PMID: 18787373. doi:10.1007/BF03345606. https://pubmed.ncbi.nlm.nih.gov/18787373/
112. Leproult R, Copinschi G, Buxton O, Van Cauter E. Sleep loss results in an elevation of cortisol levels the next evening. Sleep 1997;20(10):865-70. PMID: 9415946. https://pubmed.ncbi.nlm.nih.gov/9415946/
113. Epel ES, McEwen B, Seeman T, Matthews K, Castellazzo G, Brownell KD et al. Stress and body shape: stress-induced cortisol secretion is consistently greater among women with central fat. Psychosom Med 2000;62(5):623-32. PMID: 11020091. doi:10.1097/00006842-200009000-00005. https://pubmed.ncbi.nlm.nih.gov/11020091/
114. Incollingo Rodriguez AC, Epel ES, White ML, Standen EC, Seckl JR, Tomiyama AJ. Hypothalamic-pituitary-adrenal axis dysregulation and cortisol activity in obesity: A systematic review. Psychoneuroendocrinology 2015;62:301-18. PMID: 26356039. doi:10.1016/j.psyneuen.2015.08.014. https://pubmed.ncbi.nlm.nih.gov/26356039/
115. Fichter MM, Pirke KM. Effect of experimental and pathological weight loss upon the hypothalamo-pituitary-adrenal axis. Psychoneuroendocrinology 1986;11(3):295-305. PMID: 3786635. doi:10.1016/0306-4530(86)90015-6. https://pubmed.ncbi.nlm.nih.gov/3786635/
116. Friedl KE, Moore RJ, Hoyt RW, Marchitelli LJ, Martinez-Lopez LE, Askew EW. Endocrine markers of semistarvation in healthy lean men in a multistressor environment. J Appl Physiol (1985) 2000;88(5):1820-30. PMID: 10797147. doi:10.1152/jappl.2000.88.5.1820. https://pubmed.ncbi.nlm.nih.gov/10797147/
117. Henning PC, Scofield DE, Spiering BA, Staab JS, Matheny RW, Smith MA et al. Recovery of endocrine and inflammatory mediators following an extended energy deficit. J Clin Endocrinol Metab 2014;99(3):956-64. PMID: 24423293. doi:10.1210/jc.2013-3046. https://pubmed.ncbi.nlm.nih.gov/24423293/
118. Rossow LM, Fukuda DH, Fahs CA, Loenneke JP, Stout JR. Natural bodybuilding competition preparation and recovery: a 12-month case study. Int J Sports Physiol Perform 2013;8(5):582-92. PMID: 23412685. doi:10.1123/ijspp.8.5.582. https://pubmed.ncbi.nlm.nih.gov/23412685/
119. Pardue A, Trexler ET, Sprod LK. Case Study: Unfavorable But Transient Physiological Changes During Contest Preparation in a Drug-Free Male Bodybuilder. Int J Sport Nutr Exerc Metab 2017;27(6):550-559. PMID: 28770669. doi:10.1123/ijsnem.2017-0064. https://pubmed.ncbi.nlm.nih.gov/28770669/
120. Mitchell L, Slater G, Hackett D, Johnson N, O'connor H. Physiological implications of preparing for a natural male bodybuilding competition. Eur J Sport Sci 2018;18(5):619-629. PMID: 29490578. doi:10.1080/17461391.2018.1444095. https://pubmed.ncbi.nlm.nih.gov/29490578/
121. Mäestu J, Eliakim A, Jürimäe J, Valter I, Jürimäe T. Anabolic and catabolic hormones and energy balance of the male bodybuilders during the preparation for the competition. J Strength Cond Res 2010;24(4):1074-81. PMID: 20300017. doi:10.1519/JSC.0b013e3181cb6fd3. https://pubmed.ncbi.nlm.nih.gov/20300017/
122. Cangemi R, Friedmann AJ, Holloszy JO, Fontana L. Long-term effects of calorie restriction on serum sex-hormone concentrations in men. Aging Cell 2010;9(2):236-42. PMID: 20096034. doi:10.1111/j.1474-9726.2010.00553.x. https://pubmed.ncbi.nlm.nih.gov/20096034/
123. Smith SJ, Teo SYM, Lopresti AL, Heritage B, Fairchild TJ. Examining the effects of calorie restriction on testosterone concentrations in men: a systematic review and meta-analysis. Nutr Rev 2022;80(5):1222-1236. PMID: 34613412. doi:10.1093/nutrit/nuab072. https://pubmed.ncbi.nlm.nih.gov/34613412/
124. Corona G, Rastrelli G, Monami M, Saad F, Luconi M, Lucchese M et al. Body weight loss reverts obesity-associated hypogonadotropic hypogonadism: a systematic review and meta-analysis. Eur J Endocrinol 2013;168(6):829-43. PMID: 23482592. doi:10.1530/EJE-12-0955. https://pubmed.ncbi.nlm.nih.gov/23482592/
125. Whittaker J, Wu K. Low-fat diets and testosterone in men: Systematic review and meta-analysis of intervention studies. J Steroid Biochem Mol Biol 2021;210:105878. PMID: 33741447. doi:10.1016/j.jsbmb.2021.105878. https://pubmed.ncbi.nlm.nih.gov/33741447/
126. Whittaker J. High-protein diets and testosterone. Nutr Health 2023;29(2):185-191. PMID: 36266956. doi:10.1177/02601060221132922. https://pubmed.ncbi.nlm.nih.gov/36266956/
127. Leproult R, Van Cauter E. Effect of 1 week of sleep restriction on testosterone levels in young healthy men. JAMA 2011;305(21):2173-4. PMID: 21632481. doi:10.1001/jama.2011.710. https://pubmed.ncbi.nlm.nih.gov/21632481/
128. Sierksma A, Sarkola T, Eriksson CJ, van der Gaag MS, Grobbee DE, Hendriks HF. Effect of moderate alcohol consumption on plasma dehydroepiandrosterone sulfate, testosterone, and estradiol levels in middle-aged men and postmenopausal women: a diet-controlled intervention study. Alcohol Clin Exp Res 2004;28(5):780-5. PMID: 15166654. doi:10.1097/01.alc.0000125356.70824.81. https://pubmed.ncbi.nlm.nih.gov/15166654/
129. Hayes LD, Elliott BT. Short-Term Exercise Training Inconsistently Influences Basal Testosterone in Older Men: A Systematic Review and Meta-Analysis. Front Physiol 2018;9:1878. PMID: 30692929. doi:10.3389/fphys.2018.01878. https://pubmed.ncbi.nlm.nih.gov/30692929/
130. Pasiakos SM, Berryman CE, Karl JP, Lieberman HR, Orr JS, Margolis LM et al. Effects of testosterone supplementation on body composition and lower-body muscle function during severe exercise- and diet-induced energy deficit: A proof-of-concept, single centre, randomised, double-blind, controlled trial. EBioMedicine 2019;46:411-422. PMID: 31358477. doi:10.1016/j.ebiom.2019.07.059. https://pubmed.ncbi.nlm.nih.gov/31358477/
131. Vermeulen A, Verdonck L, Kaufman JM. A critical evaluation of simple methods for the estimation of free testosterone in serum. J Clin Endocrinol Metab 1999;84(10):3666-72. PMID: 10523012. doi:10.1210/jcem.84.10.6079. https://pubmed.ncbi.nlm.nih.gov/10523012/
132. De Souza MJ, Koltun KJ, Williams NI. The Role of Energy Availability in Reproductive Function in the Female Athlete Triad and Extension of its Effects to Men: An Initial Working Model of a Similar Syndrome in Male Athletes. Sports Med 2019;49(Suppl 2):125-137. PMID: 31696452. doi:10.1007/s40279-019-01217-3. https://pubmed.ncbi.nlm.nih.gov/31696452/
133. Loucks AB, Thuma JR. Luteinizing hormone pulsatility is disrupted at a threshold of energy availability in regularly menstruating women. J Clin Endocrinol Metab 2003;88(1):297-311. PMID: 12519869. doi:10.1210/jc.2002-020369. https://pubmed.ncbi.nlm.nih.gov/12519869/
134. Loucks AB, Verdun M. Slow restoration of LH pulsatility by refeeding in energetically disrupted women. Am J Physiol 1998;275(4):R1218-26. PMID: 9756553. doi:10.1152/ajpregu.1998.275.4.R1218. https://pubmed.ncbi.nlm.nih.gov/9756553/
135. Williams NI, Leidy HJ, Hill BR, Lieberman JL, Legro RS, De Souza MJ. Magnitude of daily energy deficit predicts frequency but not severity of menstrual disturbances associated with exercise and caloric restriction. Am J Physiol Endocrinol Metab 2015;308(1):E29-39. PMID: 25352438. doi:10.1152/ajpendo.00386.2013. https://pubmed.ncbi.nlm.nih.gov/25352438/
136. Lieberman JL, DE Souza MJ, Wagstaff DA, Williams NI. Menstrual Disruption with Exercise Is Not Linked to an Energy Availability Threshold. Med Sci Sports Exerc 2018;50(3):551-561. PMID: 29023359. doi:10.1249/MSS.0000000000001451. https://pubmed.ncbi.nlm.nih.gov/29023359/
137. Hulmi JJ, Isola V, Suonpää M, Järvinen NJ, Kokkonen M, Wennerström A et al. The Effects of Intensive Weight Reduction on Body Composition and Serum Hormones in Female Fitness Competitors. Front Physiol 2016;7:689. PMID: 28119632. doi:10.3389/fphys.2016.00689. https://pubmed.ncbi.nlm.nih.gov/28119632/
138. Papageorgiou M, Elliott-Sale KJ, Parsons A, Tang JCY, Greeves JP, Fraser WD et al. Effects of reduced energy availability on bone metabolism in women and men. Bone 2017;105:191-199. PMID: 28847532. doi:10.1016/j.bone.2017.08.019. https://pubmed.ncbi.nlm.nih.gov/28847532/
139. Ho KY, Veldhuis JD, Johnson ML, Furlanetto R, Evans WS, Alberti KG et al. Fasting enhances growth hormone secretion and amplifies the complex rhythms of growth hormone secretion in man. J Clin Invest 1988;81(4):968-75. PMID: 3127426. doi:10.1172/JCI113450. https://pubmed.ncbi.nlm.nih.gov/3127426/
140. Hartman ML, Veldhuis JD, Johnson ML, Lee MM, Alberti KG, Samojlik E et al. Augmented growth hormone (GH) secretory burst frequency and amplitude mediate enhanced GH secretion during a two-day fast in normal men. J Clin Endocrinol Metab 1992;74(4):757-65. PMID: 1548337. doi:10.1210/jcem.74.4.1548337. https://pubmed.ncbi.nlm.nih.gov/1548337/
141. Clemmons DR, Klibanski A, Underwood LE, McArthur JW, Ridgway EC, Beitins IZ et al. Reduction of plasma immunoreactive somatomedin C during fasting in humans. J Clin Endocrinol Metab 1981;53(6):1247-50. PMID: 7197688. doi:10.1210/jcem-53-6-1247. https://pubmed.ncbi.nlm.nih.gov/7197688/
142. Isley WL, Underwood LE, Clemmons DR. Dietary components that regulate serum somatomedin-C concentrations in humans. J Clin Invest 1983;71(2):175-82. PMID: 6681614. doi:10.1172/jci110757. https://pubmed.ncbi.nlm.nih.gov/6681614/
143. Fontana L, Weiss EP, Villareal DT, Klein S, Holloszy JO. Long-term effects of calorie or protein restriction on serum IGF-1 and IGFBP-3 concentration in humans. Aging Cell 2008;7(5):681-7. PMID: 18843793. doi:10.1111/j.1474-9726.2008.00417.x. https://pubmed.ncbi.nlm.nih.gov/18843793/
144. Klempel MC, Varady KA. Reliability of leptin, but not adiponectin, as a biomarker for diet-induced weight loss in humans. Nutr Rev 2011;69(3):145-54. PMID: 21348878. doi:10.1111/j.1753-4887.2011.00373.x. https://pubmed.ncbi.nlm.nih.gov/21348878/
145. Gälman C, Lundåsen T, Kharitonenkov A, Bina HA, Eriksson M, Hafström I et al. The circulating metabolic regulator FGF21 is induced by prolonged fasting and PPARalpha activation in man. Cell Metab 2008;8(2):169-74. PMID: 18680716. doi:10.1016/j.cmet.2008.06.014. https://pubmed.ncbi.nlm.nih.gov/18680716/
146. Laeger T, Henagan TM, Albarado DC, Redman LM, Bray GA, Noland RC et al. FGF21 is an endocrine signal of protein restriction. J Clin Invest 2014;124(9):3913-22. PMID: 25133427. doi:10.1172/JCI74915. https://pubmed.ncbi.nlm.nih.gov/25133427/
147. Dushay JR, Toschi E, Mitten EK, Fisher FM, Herman MA, Maratos-Flier E. Fructose ingestion acutely stimulates circulating FGF21 levels in humans. Mol Metab 2015;4(1):51-7. PMID: 25685689. doi:10.1016/j.molmet.2014.09.008. https://pubmed.ncbi.nlm.nih.gov/25685689/
148. Byrne NM, Sainsbury A, King NA, Hills AP, Wood RE. Intermittent energy restriction improves weight loss efficiency in obese men: the MATADOR study. Int J Obes (Lond) 2018;42(2):129-138. PMID: 28925405. doi:10.1038/ijo.2017.206. https://pubmed.ncbi.nlm.nih.gov/28925405/
149. Peos JJ, Helms ER, Fournier PA, Ong J, Hall C, Krieger J et al. Continuous versus Intermittent Dieting for Fat Loss and Fat-Free Mass Retention in Resistance-trained Adults: The ICECAP Trial. Med Sci Sports Exerc 2021;53(8):1685-1698. PMID: 33587549. doi:10.1249/MSS.0000000000002636. https://pubmed.ncbi.nlm.nih.gov/33587549/
150. Siedler MR, Lewis MH, Trexler ET, Lamadrid P, Waddell BJ, Bishop SF et al. The Effects of Intermittent Diet Breaks during 25% Energy Restriction on Body Composition and Resting Metabolic Rate in Resistance-Trained Females: A Randomized Controlled Trial. J Hum Kinet 2023;86:117-132. PMID: 37181269. doi:10.5114/jhk/159960. https://pubmed.ncbi.nlm.nih.gov/37181269/
151. Campbell BI, Aguilar D, Colenso-Semple LM, Hartke K, Fleming AR, Fox CD et al. Intermittent Energy Restriction Attenuates the Loss of Fat Free Mass in Resistance Trained Individuals. A Randomized Controlled Trial. J Funct Morphol Kinesiol 2020;5(1). PMID: 33467235. doi:10.3390/jfmk5010019. https://pubmed.ncbi.nlm.nih.gov/33467235/
152. Campbell BI. A Reply to Contrary to the Conclusions Stated in the Paper, Only Dry Fat-Free Mass Was Different between Groups upon Reanalysis-Comment on: "Intermittent Energy Restriction Attenuates the Loss of Fat-Free Mass in Resistance Trained Individuals: A Randomized Controlled Trial". J Funct Morphol Kinesiol 2020;5(4). PMID: 33467301. doi:10.3390/jfmk5040086. https://pubmed.ncbi.nlm.nih.gov/33467301/
153. Wing RR, Jeffery RW. Prescribed "breaks" as a means to disrupt weight control efforts. Obes Res 2003;11(2):287-91. PMID: 12582226. doi:10.1038/oby.2003.43. https://pubmed.ncbi.nlm.nih.gov/12582226/
154. Davoodi SH, Hajimiresmaiel SJ, Ajami M, Mohseni-Bandpei A, Ayatollahi SA, Dowlatshahi K et al. Caffeine treatment prevented from weight regain after calorie shifting diet induced weight loss. Iran J Pharm Res 2014;13(2):707-18. PMID: 25237367. https://pubmed.ncbi.nlm.nih.gov/25237367/
155. Headland M, Clifton PM, Carter S, Keogh JB. Weight-Loss Outcomes: A Systematic Review and Meta-Analysis of Intermittent Energy Restriction Trials Lasting a Minimum of 6 Months. Nutrients 2016;8(6). PMID: 27338458. doi:10.3390/nu8060354. https://pubmed.ncbi.nlm.nih.gov/27338458/
156. Cioffi I, Evangelista A, Ponzo V, Ciccone G, Soldati L, Santarpia L et al. Intermittent versus continuous energy restriction on weight loss and cardiometabolic outcomes: a systematic review and meta-analysis of randomized controlled trials. J Transl Med 2018;16(1):371. PMID: 30583725. doi:10.1186/s12967-018-1748-4. https://pubmed.ncbi.nlm.nih.gov/30583725/
157. Trepanowski JF, Kroeger CM, Barnosky A, Klempel MC, Bhutani S, Hoddy KK et al. Effect of Alternate-Day Fasting on Weight Loss, Weight Maintenance, and Cardioprotection Among Metabolically Healthy Obese Adults: A Randomized Clinical Trial. JAMA Intern Med 2017;177(7):930-938. PMID: 28459931. doi:10.1001/jamainternmed.2017.0936. https://pubmed.ncbi.nlm.nih.gov/28459931/
158. Peos JJ, Norton LE, Helms ER, Galpin AJ, Fournier P. Intermittent Dieting: Theoretical Considerations for the Athlete. Sports (Basel) 2019;7(1). PMID: 30654501. doi:10.3390/sports7010022. https://pubmed.ncbi.nlm.nih.gov/30654501/
159. Seimon RV, Wild-Taylor AL, Keating SE, McClintock S, Harper C, Gibson AA et al. Effect of Weight Loss via Severe vs Moderate Energy Restriction on Lean Mass and Body Composition Among Postmenopausal Women With Obesity: The TEMPO Diet Randomized Clinical Trial. JAMA Netw Open 2019;2(10):e1913733. PMID: 31664441. doi:10.1001/jamanetworkopen.2019.13733. https://pubmed.ncbi.nlm.nih.gov/31664441/
160. Hall KD, Sacks G, Chandramohan D, Chow CC, Wang YC, Gortmaker SL et al. Quantification of the effect of energy imbalance on bodyweight. Lancet 2011;378(9793):826-37. PMID: 21872751. doi:10.1016/S0140-6736(11)60812-X. https://pubmed.ncbi.nlm.nih.gov/21872751/
161. Rosenbaum M, Hirsch J, Gallagher DA, Leibel RL. Long-term persistence of adaptive thermogenesis in subjects who have maintained a reduced body weight. Am J Clin Nutr 2008;88(4):906-12. PMID: 18842775. doi:10.1093/ajcn/88.4.906. https://pubmed.ncbi.nlm.nih.gov/18842775/
162. Fothergill E, Guo J, Howard L, Kerns JC, Knuth ND, Brychta R et al. Persistent metabolic adaptation 6 years after "The Biggest Loser" competition. Obesity (Silver Spring) 2016;24(8):1612-9. PMID: 27136388. doi:10.1002/oby.21538. https://pubmed.ncbi.nlm.nih.gov/27136388/
163. Anderson JW, Konz EC, Frederich RC, Wood CL. Long-term weight-loss maintenance: a meta-analysis of US studies. Am J Clin Nutr 2001;74(5):579-84. PMID: 11684524. doi:10.1093/ajcn/74.5.579. https://pubmed.ncbi.nlm.nih.gov/11684524/
164. Purcell K, Sumithran P, Prendergast LA, Bouniu CJ, Delbridge E, Proietto J. The effect of rate of weight loss on long-term weight management: a randomised controlled trial. Lancet Diabetes Endocrinol 2014;2(12):954-62. PMID: 25459211. doi:10.1016/S2213-8587(14)70200-1. https://pubmed.ncbi.nlm.nih.gov/25459211/
165. Vink RG, Roumans NJ, Arkenbosch LA, Mariman EC, van Baak MA. The effect of rate of weight loss on long-term weight regain in adults with overweight and obesity. Obesity (Silver Spring) 2016;24(2):321-7. PMID: 26813524. doi:10.1002/oby.21346. https://pubmed.ncbi.nlm.nih.gov/26813524/
166. Varkevisser RDM, van Stralen MM, Kroeze W, Ket JCF, Steenhuis IHM. Determinants of weight loss maintenance: a systematic review. Obes Rev 2019;20(2):171-211. PMID: 30324651. doi:10.1111/obr.12772. https://pubmed.ncbi.nlm.nih.gov/30324651/
167. Hall KD, Kahan S. Maintenance of Lost Weight and Long-Term Management of Obesity. Med Clin North Am 2018;102(1):183-197. PMID: 29156185. doi:10.1016/j.mcna.2017.08.012. https://pubmed.ncbi.nlm.nih.gov/29156185/
168. Maclean PS, Bergouignan A, Cornier MA, Jackman MR. Biology's response to dieting: the impetus for weight regain. Am J Physiol Regul Integr Comp Physiol 2011;301(3):R581-600. PMID: 21677272. doi:10.1152/ajpregu.00755.2010. https://pubmed.ncbi.nlm.nih.gov/21677272/
169. Aronne LJ, Hall KD, M Jakicic J, Leibel RL, Lowe MR, Rosenbaum M et al. Describing the Weight-Reduced State: Physiology, Behavior, and Interventions. Obesity (Silver Spring) 2021;29 Suppl 1(Suppl 1):S9-S24. PMID: 33759395. doi:10.1002/oby.23086. https://pubmed.ncbi.nlm.nih.gov/33759395/
170. Thomas DM, Martin CK, Redman LM, Heymsfield SB, Lettieri S, Levine JA et al. Effect of dietary adherence on the body weight plateau: a mathematical model incorporating intermittent compliance with energy intake prescription. Am J Clin Nutr 2014;100(3):787-95. PMID: 25080458. doi:10.3945/ajcn.113.079822. https://pubmed.ncbi.nlm.nih.gov/25080458/
171. Dansinger ML, Gleason JA, Griffith JL, Selker HP, Schaefer EJ. Comparison of the Atkins, Ornish, Weight Watchers, and Zone diets for weight loss and heart disease risk reduction: a randomized trial. JAMA 2005;293(1):43-53. PMID: 15632335. doi:10.1001/jama.293.1.43. https://pubmed.ncbi.nlm.nih.gov/15632335/
172. Gardner CD, Kiazand A, Alhassan S, Kim S, Stafford RS, Balise RR et al. Comparison of the Atkins, Zone, Ornish, and LEARN diets for change in weight and related risk factors among overweight premenopausal women: the A TO Z Weight Loss Study: a randomized trial. JAMA 2007;297(9):969-77. PMID: 17341711. doi:10.1001/jama.297.9.969. https://pubmed.ncbi.nlm.nih.gov/17341711/
173. Alhassan S, Kim S, Bersamin A, King AC, Gardner CD. Dietary adherence and weight loss success among overweight women: results from the A TO Z weight loss study. Int J Obes (Lond) 2008;32(6):985-91. PMID: 18268511. doi:10.1038/ijo.2008.8. https://pubmed.ncbi.nlm.nih.gov/18268511/
174. Gardner CD, Trepanowski JF, Del Gobbo LC, Hauser ME, Rigdon J, Ioannidis JPA et al. Effect of Low-Fat vs Low-Carbohydrate Diet on 12-Month Weight Loss in Overweight Adults and the Association With Genotype Pattern or Insulin Secretion: The DIETFITS Randomized Clinical Trial. JAMA 2018;319(7):667-679. PMID: 29466592. doi:10.1001/jama.2018.0245. https://pubmed.ncbi.nlm.nih.gov/29466592/
175. Johnston BC, Kanters S, Bandayrel K, Wu P, Naji F, Siemieniuk RA et al. Comparison of weight loss among named diet programs in overweight and obese adults: a meta-analysis. JAMA 2014;312(9):923-33. PMID: 25182101. doi:10.1001/jama.2014.10397. https://pubmed.ncbi.nlm.nih.gov/25182101/
176. Garthe I, Raastad T, Refsnes PE, Koivisto A, Sundgot-Borgen J. Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes. Int J Sport Nutr Exerc Metab 2011;21(2):97-104. PMID: 21558571. doi:10.1123/ijsnem.21.2.97. https://pubmed.ncbi.nlm.nih.gov/21558571/
177. Helms ER, Aragon AA, Fitschen PJ. Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation. J Int Soc Sports Nutr 2014;11:20. PMID: 24864135. doi:10.1186/1550-2783-11-20. https://pubmed.ncbi.nlm.nih.gov/24864135/
178. Ashtary-Larky D, Ghanavati M, Lamuchi-Deli N, Payami SA, Alavi-Rad S, Boustaninejad M et al. Rapid Weight Loss vs. Slow Weight Loss: Which is More Effective on Body Composition and Metabolic Risk Factors?. Int J Endocrinol Metab 2017;15(3):e13249. PMID: 29201070. doi:10.5812/ijem.13249. https://pubmed.ncbi.nlm.nih.gov/29201070/
179. Martin CK, Bhapkar M, Pittas AG, Pieper CF, Das SK, Williamson DA et al. Effect of Calorie Restriction on Mood, Quality of Life, Sleep, and Sexual Function in Healthy Nonobese Adults: The CALERIE 2 Randomized Clinical Trial. JAMA Intern Med 2016;176(6):743-52. PMID: 27136347. doi:10.1001/jamainternmed.2016.1189. https://pubmed.ncbi.nlm.nih.gov/27136347/
180. Dorling JL, Bhapkar M, Das SK, Racette SB, Apolzan JW, Fearnbach SN et al. Change in self-efficacy, eating behaviors and food cravings during two years of calorie restriction in humans without obesity. Appetite 2019;143:104397. PMID: 31398376. doi:10.1016/j.appet.2019.104397. https://pubmed.ncbi.nlm.nih.gov/31398376/
181. Trexler ET, Smith-Ryan AE, Norton LE. Metabolic adaptation to weight loss: implications for the athlete. J Int Soc Sports Nutr 2014;11(1):7. PMID: 24571926. doi:10.1186/1550-2783-11-7. https://pubmed.ncbi.nlm.nih.gov/24571926/

---

## Appendix A — Model behaviour (regression tests, NOT data)

The table below is produced by a reference implementation of §4.9–4.10 with a deliberately crude body model (TEE falls 22 kcal/d per kg lost; 7,700 kcal/kg; 75% of loss as fat) so that implementers can unit-test their HPI code. Default subject: man, 90 kg, 30 kg fat, `EI_hab` 2,600 kcal/d, habitual protein 100 g/d, fibre 16 g/d, sleep 7.5 h, no structured exercise. Values: HPI (unmet appetite `E_k`, kcal-eq/d), plan-survival probability.

| Scenario | Day 3 | Day 14 | Day 28 | Day 56 | Day 84 |
|---|---|---|---|---|---|
| A. 25% deficit, habitual composition | 38 (656), 1.000 | 50 (806), 0.997 | 61 (933), 0.992 | 75 (1127), 0.971 | 83 (1266), 0.942 |
| B. 25% deficit, protein 170 g | 19 (370) | 28 (510) | 37 (642) | 54 (847) | 66 (997), 0.979 |
| C. B + fibre 35 g (mixed foods) | 11 (182) | 17 (314) | 24 (450) | 39 (663) | 52 (819), 0.993 |
| D. 40% deficit, habitual composition | 57 (888) | 73 (1096) | 82 (1260) | 91 (1485) | 94 (1625), 0.896 |
| E. Ketogenic VLED 700 kcal, 60 g protein, BHB 0.6 mM | 66 (1000) | 41 (696) | 31 (556) | 30 (543) | 32 (568), 0.992 |
| F. Same VLED, not ketotic (BHB 0.1 mM) | 81 (1229) | 92 (1522) | 95 (1716) | 98 (1922) | 98 (2026), 0.863 |
| H. A + 5.5 h sleep | 50 (798) | 63 (956) | 72 (1083) | 83 (1277) | 89 (1416), 0.919 |
| K. Maintenance, habitual diet | 6 (0) | 6 (0) | 6 (0) | – | – |

Scenario G (A with a 1-week maintenance break every 4th week): HPI 56 on day 21 → 13 on day 28 (break); 67 on day 49 → 20 on day 56; 80 on day 105 → 37 on day 112.
Scenario I (lean man, 80 kg, 11 kg fat, `EI_hab` 3,000, 25% deficit, protein 180 g): HPI 62 / 81 / 94 / 98 at weeks 4 / 8 / 12 / 16 (P_surv 0.883 at 16 wk).
Scenario J (lean woman, 60 kg, 15 kg fat, `EI_hab` 2,100, 25% deficit, protein 110 g): HPI 35 / 49 / 61 / 71 at weeks 4 / 8 / 12 / 16.

Qualitative expectations these reproduce: protein and fibre lower hunger substantially at equal energy [48][49][54]; hunger climbs as weight is lost [47][39]; ketosis produces a transient rise then a plateau near baseline [38]; short sleep raises hunger [66][67]; diet breaks reset the acute and fatigue components but not the fat-mass component [149][150]; leanness drives hunger toward the ceiling [119][118].

## Appendix B — Suggested daily update order

1. Read W, FM, FFM, BF% (01), TEE (02), insulin_rel (04), BHB (05), ExEE (10/09) and the day's schedule.
2. Compute `u`, `φ_L`, `φ_E`, `DC_L`, `DC_T`, `EA`, `EA7`, `K`.
3. Leptin: update `A_lep`, `C_lep`; compute `L_FM`, `L`, `L_rel`, `L_FM_lag`, `S_L(L)`, `S_L(L_FM)`.
4. Ghrelin `G`, `SPI`.
5. T3 (`T3f`, `T3`), `rT3`.
6. Cortisol counters (`n_def`, `n_LC`) and `Cort`.
7. Testosterone `Tt`, `SHBG`, `FT` (men); `R_MD`, `RASI_female` (women).
8. `GH`, `IGF1`.
9. Hunger: `S_ex`, `F`, `K_ad`, `W_ref`, `D`, `S`, `E_raw`, `E_s`, `E_k`, `HPI`.
10. Adherence: `P_surv`; if free-living mode, solve for extra intake `X` against `E_cap` and pass the corrected intake back to 01/02 **for the next day** (avoid algebraic loops).
11. DietStrain; safety flags (§9) → 17; planner metrics → 18.
