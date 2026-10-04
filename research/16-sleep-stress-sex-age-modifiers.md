# 16 — Sleep, stress, sex, menstrual cycle, menopause, age & other person-level moderators

Author: research agent 16. Date of evidence search: 2026-09-30 (PubMed E-utilities + PMC full text + publisher pages).
Conventions: `[n]` = numbered reference in Section 11. `UNVERIFIED` = I could not locate/confirm the number in a
source I actually read. `PROPOSED FIT` = my equation fitted to the cited data points (listed). Evidence grades A–D as in the
protocol. All energy figures kcal (1 MJ = 239 kcal). "d" always means *sleep deficit in hours* (Section 4.1.1).

> Lane note. Cross-references: 01 body-weight ODE / P-ratio, 02 RMR/TEF/NEAT, 03 protein/MPS, 04 insulin/glycogen,
> 05 ketosis, 07 circadian/meal timing, 09 hypertrophy, 10 cardio/VO2max, 12 hormones/appetite, 13 water/glycogen transients,
> 14 anthropometrics/BF% equations, 15 caffeine/alcohol/hydration, 17 safety, 18 planner, 19 bone/performance.
> This file supplies **multipliers/offsets on those modules' parameters**, not the base equations.

---------------------------------------------------------------------------------------------------

## 1. Scope

1. Person-level and lifestyle moderators that change how the core model behaves: **sleep** (duration, quality, timing/shift work),
   **psychological stress**, **biological sex**, **menstrual cycle & hormonal contraception**, **menopause**, **age**,
   **body-fat level as a moderator**, **inter-individual variance / ethnicity**, and **medications/conditions that invalidate the average model**.
2. Diet → sleep is treated as an *output* (caffeine, alcohol, evening meals, very-low-carbohydrate intake, energy deficit, exercise timing).
3. Hard exclusions handled here only as rationale (pregnancy/lactation, <18 y); the safety limits themselves live in 17.
4. Deliverable: a **moderator table** (Section 4.0) with parameter, multiplier/offset formula, evidence grade and a **user-input decision**,
   plus validation targets (Section 7).

**Headline decisions (details in 4.0):**
- Required user inputs: **sex, age**, and **sleep hours per night (per schedule block, default 7.5 h = no effect)**.
- Advanced/optional inputs (default OFF/neutral): sleep quality, shift-work flag, perceived-stress level, menstrual-cycle toggle,
  hormonal contraception, menopause status (derived from age with override) + HRT, and a medication/condition checklist (safety gate).
- NOT user inputs: ethnicity multipliers (only BF%-from-BMI conversion, see 14), "genetics", any hormone levels.
- Sleep is the only lifestyle moderator with A/B-grade *mechanistic* effects big enough to change 8–12-week projections
  (energy-intake drift ≈ +4%/h short of 7.5 h, insulin sensitivity ≈ −7%/h, MPS ≈ −5%/h, possible lean-mass-sparing loss in a deficit).
- Age acts through (i) FFM-adjusted expenditure −0.7%/yr after ~63 y (A), (ii) anabolic resistance (per-meal protein plateau 0.24 → 0.40 g/kg) (B),
  (iii) hypertrophy trainability ≈ 0.72× at 65–75 y (B/C). Sex acts mostly through body composition (already in the model),
  not through separate RMR/hypertrophy multipliers (A/B). The menstrual cycle deserves at most an optional hunger/scale-noise toggle (C).
- Biggest correction to the brief's expectations: Wang 2018 did **not** replicate Nedeltcheva's absolute fat/lean differences (only a
  ratio metric differed); the Poehlman 1995 "menopause lowers RMR" paper is **retracted**; White 2011 measured *self-reported* bloating,
  not scale weight; objective cycle-phase weight changes are small and inconsistent in sign.

---------------------------------------------------------------------------------------------------

## 2. State variables

Static person descriptors are inputs (Section 3). State variables owned by this module:

| Name | Unit | Typical range | What it represents | Initial-value rule |
|---|---|---|---|---|
| `sleepDefFast` | h | 0–4 | Exponentially weighted sleep deficit driving **appetite/hunger, next-day performance** (fast, τ_on 1 d, τ_off 2 d) | Start at `max(0, 7.5 − habitualSleep)` if user gives habitual sleep, else 0 |
| `sleepDefSlow` | h | 0–4 | Deficit driving **insulin sensitivity, MPS, testosterone, P-ratio shift** (slow, τ_on 3 d, τ_off 5 d) | Same as above |
| `sleepDefQualityEq` | h | 0–1.5 | Equivalent-deficit add-on for fragmented sleep / shift work (constant while flags on) | 0 unless flags set (0.75 poor quality; +1.0 shift-work) |
| `caffeineBodyMg` | mg | 0–600 | Caffeine mass in body (first-order decay; dossier 15 supplies intake events) | 0 at wake-up of day 1 (or carry over from previous day) |
| `cycleDay` | d | 1–L (L≈21–35) | Day within menstrual cycle; `phase` derived: menses 1–5, follicular 6–13, ovulatory 14±1, luteal 15–L | User enters last-menses date (or toggle OFF) |
| `sleepQualityScore` | 0–100 | 40–95 | UI **output** heuristic of diet/behaviour impact on sleep (4.2.6) | 75 baseline |
| `moderator vector M_t` | — | — | Daily bundle of multipliers consumed by other modules (4.0.9) | Computed each day |

Static derived values: `ageMult*` (Section 4.8 functions of age), `menopauseStatus ∈ {pre, peri, post}`, `sexFlag`.

---------------------------------------------------------------------------------------------------

## 3. Inputs that drive it

| Input | Unit / values | How it enters | Default | UI level |
|---|---|---|---|---|
| Sex | male / female | selects sex-specific constants (4.4); enables cycle/menopause blocks | required | Required |
| Age | years (18–90; hard-exclude <18, warn 18–24) | 4.8 functions; menopause default | required | Required |
| Sleep duration | h/night actual sleep (schedule block) | `sleepDefFast/Slow` (4.1.1) | 7.5 | Required (per block) |
| Sleep quality | good / fragmented (PSQI>5, untreated apnoea, frequent waking) | `sleepDefQualityEq += 0.75` | good | Advanced |
| Shift work / irregular schedule | bool (eats/sleeps ≥6 h out of phase or rotating) | `+1.0 h` eq. deficit; TEE −3% on night-shift days (4.1.9) | false | Advanced |
| Perceived stress | low / typical / high sustained | intake-drift & adherence noise only (4.3) | typical (no effect) | Advanced |
| Menstrual-cycle modelling | bool + last-menses date + cycle length | hunger offset, scale-noise band (4.5) | OFF | Advanced |
| Hormonal contraception | none / combined / progestin-only / hormonal IUD | disables cycle effects; caffeine t½ ×1.47 (combined) | none | Advanced |
| Menopause status | pre / peri / post (derived: <50 pre; 50–53 peri = transition window around mean FMP age 52.2 y; ≥54 post; user overrides) | 4.7 | derived | Advanced override |
| HRT / menopausal hormone therapy | bool | 4.7 abdominal-fat offset | false | Advanced |
| Medication / condition checklist | multi-select (4.12) | safety gate: hard-exclude / warn / "average model not valid" banner | none | Required acknowledgement |
| Ethnicity | categories | only BF%-from-BMI (14); no energy parameters | not asked in v1 | Optional (14) |
| Smoking | bool | caffeine t½ ×0.56 (4.2.1) | false | Optional |

---------------------------------------------------------------------------------------------------

## 4. Mechanisms & equations

### 4.0 MASTER MODERATOR TABLE (implementation view)

Grades: A meta-analysis/validated model/multiple controlled trials; B few RCTs or consistent mechanistic human data; C limited/indirect; D animal/opinion.
"Input?" = decision on exposing to the user. All formulas use `d`-variables from 4.1.1 unless stated.

#### 4.0.1 Sleep (drivers: `sleepDefFast`=dF, `sleepDefSlow`=dS, both capped as shown)

| Affected parameter | Multiplier / offset | Grade | Input? (default) |
|---|---|---|---|
| Unplanned energy intake (ad-libitum mode only) | `ΔEI = min(0.16, 0.04·dF) × maintenanceKcal` (≈ +100 kcal/day per h short at 2,500 kcal; band 0.025–0.06 per h) | A (direction, magnitude ±) | Sleep hours: INPUT (7.5). "Model unplanned intake drift": ADVANCED (OFF for prescribed-intake mode; ON in ad-libitum mode) |
| Hunger VAS (0–100) | `+4·dF` points (cap +16) | A/B | derived |
| Fat share of weight change in energy deficit (P-ratio) | `ΔP = +0.04·dS·min(1, deficitFrac/0.15)`, cap +0.12 (band 0 to 0.08/h) — only when EB<0 | C | derived |
| Insulin sensitivity (Si) | `Si×(1 − 0.07·min(dS,4))` (band 0.03–0.10 per h) | A/B | derived |
| MPS (myofibrillar, fed/rested) | `×(1 − 0.05·min(dS,4))`; restored by ≥3 HIIE sessions/5 d (C) | B | derived |
| Testosterone (men) | `×(1 − 0.05·min(dS,5))` (women: no data) | B (men) / D (women) | derived |
| Evening cortisol | `+0…+20%` at dS≥2.5; do not use as driver | C/D | derived (12) |
| TEE / RMR | ×1.00 default; optional ×0.97 on night-shift days; ×0.92 RMR only under chronic short sleep **plus** circadian disruption | B/C | shift-work flag |
| VAT share of any fat gain | `+0.05·dS` absolute VAT-share offset (only maintenance/surplus) | C | derived |
| Acute strength / power / endurance | strength `×(1−0.008·min(dF,4))`; power & endurance `×(1−0.015·min(dF,4))`; halve effect for exercise before 12:00 | B | derived |
| Adherence risk (Planner) | short sleep <6 h: 4.5% less weight loss at 12 mo, poor quality 2.2% less (observational, N=296) | C | Planner constraint |

#### 4.0.2 Sex

| Affected parameter | Multiplier / offset | Grade | Input? |
|---|---|---|---|
| RMR/TEE given FFM+FM regression (02) | **no extra sex term** (women −3% in Arciero 1993; Pontzer 2021 finds none). If Mifflin–St Jeor is used, sex is already in it | A/B | INPUT: sex (required) |
| Peak fat oxidation per kg FFM (exercise) | women `×1.12`; Fatmax 52 vs 45 %VO2max | A/B | sex |
| Relative (%) hypertrophy rate | `×1.00` both sexes (Roberts 2020); absolute gain ∝ baseline muscle mass | A | sex |
| Weight-loss composition (P-ratio) | **no sex term** beyond Forbes/Hall dependence on baseline FM/FFM (01); contested (PREVIEW vs Millward) → widen band | C | sex |
| VAT vs SAT partition of fat loss | men lose more VAT & less SAT per unit weight/waist loss; PROPOSED VAT-share-of-loss multiplier men 1.3 / women 0.8 | C | sex |
| Leptin per kg fat (12) | women ×1.5 secretion per kg adipose (≈2× circulating at equal BMI) | B | sex |
| Ketone production (05) | women ×1.10 (PROPOSED; fasting BHB +3%, postprandial +40%) | C/D | sex |
| Energy-availability threshold (women) | LH pulsatility disrupted below 30 kcal/kg LBM/d → safety flag (17) | B | sex |

#### 4.0.3 Age

| Affected parameter | Multiplier / offset | Grade | Input? |
|---|---|---|---|
| FFM+FM-adjusted RMR/TEE | `×(1 − 0.007·max(0, age−63))` (CI of breakpoint 60–66 y) | A | age |
| Per-meal protein needed for max MPS (03) | `plateau_g_per_kg = 0.24 + 0.16·clamp((age−40)/30, 0, 1)` (men data) | B | age |
| Resistance-training hypertrophy rate (09) | `×(1 − 0.28·clamp((age−40)/30, 0, 1))` → 0.72 at ≥70 (band 0.5–1.0) | B/C | age |
| Lean share of weight lost in diet (older, obese) | `×1.3` for ≥65 y diet-only (33% vs typical 25%); with exercise 21% | C | age |
| Background muscle-mass drift | `−0.0037/yr (F), −0.0047/yr (M)` of muscle mass from ~50 y; at ~75 y −0.0065/yr (F), −0.009/yr (M) | B | age |
| Peak VO2 | piecewise −0.45 %/yr (25–40), −1 %/yr (40–60), −1.5 %/yr (60–70), −2.2 %/yr (>70) (PROPOSED interpolation) | B | age |
| 2-h OGTT glucose | `+1.1 mmol/L` after 60 y (adjusted for fatness/fitness) | B | age |
| Testosterone (men) | −1 to −2 %/yr (UNVERIFIED independent source; quoted in [14]) | C | age |
| Bone loss in deficit (older) | hip BMD −3% per ~10% weight loss (diet-only) vs −1% (diet+exercise) | B | age → 19 |

#### 4.0.4 Menstrual cycle, contraception, menopause, pregnancy/lactation

| Affected parameter | Multiplier / offset | Grade | Input? |
|---|---|---|---|
| Luteal hunger/intake | ad-lib mode: `+168 kcal/d` (luteal vs follicular; band +50…+300); prescribed mode: hunger VAS `+5` | B−/C | Cycle toggle ADVANCED (OFF) |
| Scale-weight / water | **no deterministic curve**; optional ±0.5 kg display noise band, phase-unaligned | C/D | same toggle |
| RMR luteal | `×1.00` (optional 1.02); older studies +, post-2000 NS | B | none |
| Substrate oxidation, exercise performance, RT adaptation | `×1.00` | A/B | none |
| Combined oral contraceptive | cycle effects OFF; caffeine t½ ×1.47; fasting BHB +45% (05); hypertrophy 1.0 ± wide band | B/C | HC input |
| Menopause transition | fat +0.7 pp/yr and lean −0.4 pp/yr **beyond** premenopausal drift for ~3.5 y; VAT share of gain ↑ ; no separate RMR term (optional −0.65%/yr) | B/C | derived + override |
| Transmenopause bone | LS −2.5%/yr, FN −1.9%/yr for ~3 y (→19) | B | derived |
| HRT | abdominal fat −6.8% (CI −11.8…−1.9), HOMA-IR −12.9% | A/B | ADVANCED |
| Pregnancy | HARD EXCLUDE | — | checklist |
| Lactation | HARD EXCLUDE; warning text: milk energy cost ≈ 626 kcal/d (net ≈ 454 kcal/d after tissue mobilisation) | B | checklist |

#### 4.0.5 Stress, body-fat level, variance, ethnicity, medications

| Affected parameter | Multiplier / offset | Grade | Input? |
|---|---|---|---|
| Perceived stress → intake | high sustained stress: `+2% of maintenance` (≈ +50 kcal/d, PROPOSED from Hedges g≈0.11) and ×1.5 SD on daily adherence noise; **no** fat-partition or water effect | C | ADVANCED (typical = 0) |
| Body-fat level | Use Forbes/Hall partition (01); lean subjects: early ketonaemia ×2, lean loss ×2–3 in prolonged starvation (Elia) → flags at BF% <10 (M) / <18 (F) | B/C | derived |
| Individual variance | 80% prediction bands (4.11): fat-mass change ±35%, hypertrophy ±64%, RMR ±13%, TEE ±26% | B/C | display only |
| Ethnicity | BF%-from-BMI shift (+3–5 pp Asians) & VAT (14); **no** RMR/TEE multiplier | B | optional (14) |
| Medications / conditions | see 4.12: exclusion / "average model not valid" | A–C | checklist (required) |

#### 4.0.6 Daily moderator vector consumed by other modules (implementation contract)

```ts
interface ModeratorVector {          // computed once per simulated day, from inputs + sleep state
  unplannedIntakeKcal: number;       // 0 unless ad-libitum mode; 4.1.2
  hungerVasOffset: number;           // 0-100 scale; 4.1.2 (+ cycle & stress terms)
  pRatioShift: number;               // add to protein-energy fraction of weight change when EB<0; 4.1.3
  siMult: number;                    // insulin sensitivity multiplier; 4.1.4
  mpsMult: number;                   // myofibrillar MPS multiplier (rested/fed); 4.1.5
  testosteroneMult: number;          // males only; 4.1.5
  teeMult: number; rmrMult: number;  // 1 unless shift-work / age>63; 4.1.6, 4.8
  vatShareOffset: number;            // 4.1.7
  strengthMult: number; powerEnduranceMult: number;  // acute performance; 4.1.8
  hypertrophyRateMult: number;       // age; 4.8
  proteinPlateauGPerKg: number;      // age; 4.8
  leptinPerKgFatMult: number;        // sex; 4.4
  fatOxPerKgFfmMult: number;         // sex; 4.4
  scaleNoiseKg: number;              // display band only; 4.5
}
```

### 4.1 SLEEP

**Mechanism (plain language).** Short or fragmented sleep does not "slow metabolism": measured total energy expenditure is unchanged
(or +≈5% because of extra wakefulness) while *ad-libitum energy intake rises* (mostly unplanned late-evening snacking, more fat, less protein).
In parallel, insulin sensitivity falls within 4–7 nights (adipose, hepatic and muscle), muscle protein synthesis and (in men) testosterone fall,
and — in a controlled energy deficit — a larger fraction of the lost mass may be fat-free (one very small crossover RCT; a second RCT reproduced only a ratio metric, not the absolute fat/lean differences — see 4.1.3).
Circadian misalignment (shift work) adds a further drop in RMR/TEF and impaired insulin secretion.

#### 4.1.1 Sleep-deficit state and dynamics (PROPOSED structure)

Reference sleep `h_ref = 7.5 h` of *actual* sleep. In the source trials "adequate" arms were 8.5–10 h time-in-bed; 8.5 h TIB produced 7 h 25 min of actual sleep and 5.5 h TIB produced 5 h 14 min [1]
(for 4–5 h TIB I assume ≈3.8–4.7 h actual sleep, i.e. ≈95% efficiency — UNVERIFIED). Nightly deficit:

```
d_t      = max(0, 7.5 − sleepHours_t) + qualityEq          // qualityEq from 4.1.9 (0 if good sleep, no shift work)
a(τ)     = 1 − exp(−1/τ)                                    // per-night smoothing factor (τ in days)
dF_t     = dF_{t−1} + a(τ_F)·(d_t − dF_{t−1})   with τ_F = 1 d if d_t > dF_{t−1} else 2 d      // appetite / performance
dS_t     = dS_{t−1} + a(τ_S)·(d_t − dS_{t−1})   with τ_S = 3 d if d_t > dS_{t−1} else 5 d      // Si, MPS, T, P-ratio
caps: dF ≤ 4, dS ≤ 4 (5 for testosterone). Sleep above 7.5 h earns NO credit (no "sleep bank" beyond repaying deficit).
```
Worked example — 5 h/night for 7 nights (d = 2.5): dS = 0.71, 1.22, 1.58, 1.84, 2.03, 2.16, 2.26 h at nights 1…7 (a_on=0.283).

| Parameter | Value | Basis |
|---|---|---|
| h_ref | 7.5 h actual sleep | Nedeltcheva 2010 control arm 7 h 25 min actual on 8.5 h TIB [1]; adult guidelines 7–9 h (not a source I fetched) |
| τ_F onset / offset | 1 d / 2 d | one night of 4 h sleep → +559 kcal next day [17]; recovery sleep immediately lowers intake and hunger [11] |
| τ_S onset / offset | 3 d / 5 d | effects on adipocyte insulin signalling by 4 nights [10], whole-body Si by 7 nights [9]; **2 recovery nights did not restore Si/disposition index** [22]; weekend recovery failed to prevent Si loss [21] |
| Asymmetry | recovery slower than onset | [21][22] |

Evidence grade: **B** for existence and rough time-scales; **C** for the specific τ values (no dense time-course exists; Robertson 2013 weekly clamps
under −1.3 h/night showed non-monotonic Si changes over 3 weeks, N=19 men [23]).

#### 4.1.2 Energy intake and hunger

Data (all healthy adults; lab = inpatient ad-libitum feeding):

| Study | Design / population | Sleep contrast | Δ energy intake |
|---|---|---|---|
| Al Khatib 2017 meta [3] | 11 RCTs with data, n=172 (17 studies, n=496 in review) | partial sleep deprivation vs control (protocol details not in abstract) | **+385 kcal/d (95% CI 252–517)**; TEE/RMR no change; more fat, less protein, no carbohydrate change |
| Zhu 2019 meta [4] | 41 RCTs | sleep restriction | +252.8 kcal/d (p=0.011); hunger +13.4 mm on 100-mm VAS; weight +0.34 kg; Si SMD −0.70; **no consistent leptin/ghrelin/EE effect** |
| González-Ortiz 2020 meta [5] | 6 studies | partial deprivation | +149.9 kcal/d (95% CI 10–290) |
| Brondel 2010 [17] | 12 men, crossover | 1 night ~4 h vs ~8 h | +559 ± 617 kcal (22%) next day; pre-meal hunger ↑ |
| Nedeltcheva 2009 [16] | 11 adults, 14 d, ad lib | 5.5 vs 8.5 h TIB (−122 min actual) | snack kcal 1087 vs 866 (+221); meals unchanged; TEE 2526 vs 2390 (NS) |
| Calvin 2013 [18] | 8 d/8 nights, 2/3 of usual sleep vs control | | +559 kcal/d vs control −118: net +677 (148–1,206); activity EE unchanged |
| Covassin 2022 [15] | 12 adults (9 M), 14 d inpatient | 4 h vs 9 h | net +308 kcal/d (59–557); +17% vs +6% from baseline; ↑ protein 13%, fat 17% |
| Markwald 2013 [11] | 16 adults, 5 d | 5 h vs 9 h | TEE +≈5%; excess intake esp. after dinner; **+0.82 ± 0.47 kg** in 5 d |
| Spaeth 2013 [19] | N=225 (198 restricted), 5 nights 4 h vs 10 h | | weight +0.97 ± 1.4 kg vs +0.11 ± 1.9 (d=0.51); late-night (22:00–03:59) +552.9 ± 265.8 kcal |
| **Tasali 2022 [7]** | **RCT, N=80, 21–40 y, BMI 25–29.9, habitual <6.5 h; DLW + weights** | **+1.2 h/night (1.0–1.4) via counselling vs habitual, 2 weeks** | **−270 kcal/d (−393 to −147); slope −162 kcal/d per +1 h (−247 to −78); TEE no change; weight −0.87 kg (−1.39 to −0.35) vs control** |
| Spiegel 2004 [8] | 12 men, 2 d 4 h vs 2 d 10 h TIB, controlled intake | | leptin −18%, ghrelin +28%, hunger +24%, appetite +23% (calorie-dense carbohydrate craving +33–45%) |

**PROPOSED FIT (intake drift).** `ΔEI = min(0.16, 0.04·dF) × maintenanceKcal` (0.04 per h ≈ 100 kcal/day per hour short at 2,500 kcal).
Checks (maintenance 2,400): Al Khatib (d≈3.5) predicts 336 vs 385; Zhu (d≈3) 288 vs 253; Covassin net (d≈4.5, cap) 384 vs 308; González-Ortiz (d≈2) 192 vs 150;
Tasali (dF change 1.2 h) −115 vs −270 (real-life slope is at/above the top of the band; use band 0.025–0.06/h and let UI show the upper edge).
Unplanned energy composition default (low confidence): 45% fat / 45% carbohydrate / 10% protein by energy (Al Khatib: fat ↑, protein ↓, carbohydrate unchanged [3];
snack studies show carbohydrate-rich late snacks [16][19]). **Timing:** extra intake is concentrated 19:00–04:00 [16][19] (feeds 07 and the caffeine/alcohol/sleep loop).
Hunger output: `hungerVas += 4·dF` points (Zhu +13.4 mm at typical restriction d≈3; Spiegel +24% at d≈6).

Context: an earlier systematic review of RCTs also concluded that experimental restriction raises food intake and TEE with inconsistent net weight effects [6]; cross-sectional epidemiology (adults: OR 1.55 for obesity with short sleep, −0.35 BMI units per hour of sleep) is consistent but cannot establish causation [29].

Use rule: in **prescribed-intake** Simulator mode the schedule fixes kcal, so the sleep effect appears as (a) higher hunger score and (b) a *risk of
non-adherence*; unplanned intake is added only if the user selects "ad-libitum/free-living mode" or the Planner requests a robustness check.
Hormones: do **not** drive intake from leptin/ghrelin changes — meta-analytic support is weak [4], ad-lib trials found none [16][18];
acylated ghrelin ↑ under deficit + short sleep [1]. If shown as outputs: leptin `×(1 − 0.03·dS)` (grade C/D, Spiegel-based), ghrelin `×(1 + 0.03·dS)`.

Evidence grade: **A** (direction and order of magnitude: several meta-analyses + one objectively measured RCT); magnitude per hour **B** (heterogeneous; lab protocols extreme).
Moderators: sex inconsistent (women lost dietary restraint and gained weight in Markwald [11]; men gained more in Spaeth (d=0.38) [19]; women's weekend intake returned to baseline, men's did not [21]) → **no sex multiplier (D)**.
BMI: most lab samples normal-weight; Tasali overweight (25–29.9) — no BMI moderator.

#### 4.1.3 Energy deficit: partition of weight loss (P-ratio shift) — **replication status**

| Trial | Population | Protocol | Result |
|---|---|---|---|
| **Nedeltcheva 2010 [1]** (Ann Intern Med, PMID 20921542) | N=10 (3 F/7 M), age 41, BMI 27.4; randomised crossover, ≥3 months apart | 14 d, diet fixed at 90% RMR (~1,450 kcal/d vs DLW TEE ~2,137), TIB **8.5 vs 5.5 h** (actual sleep 7 h 25 min vs 5 h 14 min) | Weight loss ≈3 kg both. **Fat lost 1.4 ± 0.9 vs 0.6 ± 0.6 kg (−55%, P=0.043); FFM lost 1.5 vs 2.4 kg (+60%, P=0.002).** Fat share of weight lost **56% vs 25%**. Hunger +0.7 vs −0.1 cm VAS; fasting/postprandial RQ ↑, acylated ghrelin ↑, RMR ↓ (P=0.01), epinephrine ↓; leptin fell with weight only. Composition implied deficit 520 vs 920 kcal/d (i.e. ≈400 kcal/d lower expenditure) but DLW (SD of within-subject TEE difference 340 kcal/d) could not confirm. |
| **Wang 2018 [2]** (Sleep, PMID 29438540) | N=36 (15 CR, 21 CR+SR), 80% women, age 45, BMI 31.3 vs **35.1** (groups differed at baseline), body-fat 38.9 vs 43.0% | 8 wk, diet = 95% of measured RMR; CR+SR: ~1 h less time in bed on 5 nights/wk, ad-lib on 2 (net −169 ± 75 min/**week**, i.e. ≈ −24 min/day) | Weight −3.3 ± 3.2 vs −3.2 ± 2.5 kg; **fat −1.9 ± 2.1 vs −1.8 ± 1.7 kg; lean −0.71 ± 0.93 vs −0.72 ± 1.2 kg (no absolute differences)**. Only the *ratio metric* differed: proportion of mass lost as fat, median **82.7% (IQR 58.6–111.6) vs 58.4% (−12.7–73.6)** (p=0.016). Resting RQ fell only in CR; leptin fell only in CR+SR. |
| Others | — | — | No third RCT with a body-composition endpoint under a controlled deficit found in PubMed (searches: sleep restriction/extension × weight loss/body composition/fat-free mass, to 2026-09). Observational: 296 adults in a 12-month behavioural programme — baseline short sleep (<6 h) lost 4.5 ± 1.3% less weight than normal sleepers (mean loss 6.9%; abstract does not say percentage points vs relative), poor sleep quality 2.2 ± 1.2% less [30]. |

Converting to protein-energy fraction (P-ratio, 01) with the paper's own factors (21% protein in FFM, 4.32 kcal/g protein, 9.46 kcal/g fat) [1]:
`P = 0.21·(FFM_g)·4.32 / (0.21·FFM_g·4.32 + FM_g·9.46)`:
Nedeltcheva 8.5 h: P=0.093; 5.5 h: P=0.277 (ΔP=+0.18 for Δsleep ≈ 2.2 h). Wang: CR P=0.035, CR+SR P=0.037 (ΔP≈0; DXA lean soft tissue used as an FFM proxy).

**PROPOSED FIT (shrunken estimate).** Because one very small RCT shows a large effect, the second larger RCT shows none in absolute terms, and the observational study
shows a sizeable adherence effect, apply half the Nedeltcheva slope:
`pRatioShift = +0.04 · dS · min(1, deficitFraction/0.15)`, cap +0.12, applied only when energy balance is negative;
uncertainty band 0 to +0.08 per h (lower edge **zero** must be displayed). At dS=2.3 this raises a P=0.09 baseline to ≈0.18 (Nedeltcheva ≈0.28).
Keep energy balance unchanged (the ≈400 kcal/d "missing expenditure" is unconfirmed). No effect in surplus: Covassin found no difference in DXA fat or lean gain
between short and normal sleep during ad-lib overfeeding [15].
Evidence grade: **C** (N=10 and N=36, conflicting endpoint patterns, one baseline imbalance, no larger replication; plausible mechanism: ghrelin/RQ shift, reduced MPS [12][13]).

#### 4.1.4 Insulin sensitivity

| Study | Population | Protocol | Effect |
|---|---|---|---|
| Buxton 2010 [9] | 20 healthy men 20–35 y | 5 h TIB × 7 nights vs 10 h; diet controlled; ± modafinil | IVGTT Si **−20 ± 24%** (P=0.001), clamp Si **−11 ± 5.5%** (P<0.04); insulin secretion unchanged, disposition index ↓; salivary cortisol +51% (not correlated with ΔSi) |
| Broussard 2012 [10] | 7 adults (1 F), BMI 22.8 | 4.5 vs 8.5 h TIB × 4 nights | adipocyte half-maximal pAkt insulin dose 0.71 vs 0.24 nM (≈3×); pAkt AUC −30%; whole-body Si ↓ (P=0.02) |
| Depner 2019 [21] | 36 adults; CON 9 h (n=8), SR 5 h ×9 nights (n=14), WR weekend recovery (n=14) | | whole-body Si −13% (SR); WR: whole-body, hepatic, muscle Si −9% to −27% during recurrent restriction |
| Ness 2019 [22] | 15 men | 5 nights 5 h then 2 nights 10 h | Si ↓ (P=0.002); disposition index suppressed **and not recovered after 2 recovery nights**; NEFA rebound normalised |
| Zhu 2019 meta [4] | 41 RCTs | | Si SMD −0.70 (p<0.01) |
| Tasali 2008 [28] | young adults | selective slow-wave suppression, total sleep time unchanged | "marked" fall in Si, no adequate insulin compensation; ΔSi correlated with ΔSWS (numeric magnitude UNVERIFIED — abstract gives none) |
| Buxton 2012 [25] | healthy adults, >5 wk | 3 wk 5.6 h/24 h + 28-h "days" (circadian disruption) | insulin secretion to meal −32%, post-meal glucose ↑, RMR −8%; effects age-independent (young vs older) |
| Robertson 2013 [23] | 19 normal-weight men | habitual TIB −1.5 h (−79 min actigraphy) × 3 wk at home | Si, weight, leptin changed but non-monotonically |

**PROPOSED FIT:** `siMult = 1 − 0.07·min(dS, 4)`. Checks: 5 h × 7 nights (dS≈2.3) → −16% (Buxton −11 to −20%, Depner −13%); 4.5 h TIB × 4 nights
(actual ≈4.2 h, d≈3.3, dS≈2.4 at night 4) → −17% (Broussard: whole-body Si "reduced", cellular pAkt AUC −30%); 4 h × 5 nights → up to −25%. Between-person SD is large (±24%): show as band. Feeds 04 (glucose/insulin dynamics) and 06 (HOMA-IR).
Evidence grade: **A/B** (direction; meta-analytic SMD −0.7 across 41 RCTs; magnitude per hour from 4 small inpatient studies, mostly men).

#### 4.1.5 Muscle protein synthesis, testosterone, cortisol

| Outcome | Study | Result |
|---|---|---|
| Myofibrillar protein synthesis | Saner 2020 [12]: 24 men, 5 nights, D₂O + biopsies | 4 h TIB: FSR **1.24 ± 0.21 %/d** vs normal sleep 1.53 ± 0.09 (**−19%**); 4 h + 3 HIIE sessions 1.61 ± 0.14 (restored). No change in p-AKT/p-mTOR, FOXO or LC3 |
| Postprandial MPS (acute) | Lamon 2021 [13]: N=13 (7 M/6 F), 1 night total deprivation | 0.072 → 0.059 %/h (**−18%**, p=0.040); plasma cortisol +21% (p=0.030); testosterone −24% (p=0.029); degradation gene markers unchanged |
| Testosterone (men) | Leproult 2011 [14]: 10 men, 8 nights 5 h vs 3 nights 10 h | daytime (08–22 h) 16.5 vs 18.4 nmol/L (**−10%**, P=0.049); 14–22 h 15.5 vs 17.9 (**−13%**, P=0.02); cortisol profile unchanged; vigor 28 → 19 |
| Chronic lean mass | Nedeltcheva 2010 [1] | FFM loss +60% in deficit (see 4.1.3) — the only chronic data |

**PROPOSED FIT:** `mpsMult = 1 − 0.05·min(dS,4)` (4 h TIB assumed ≈ 3.8 h actual sleep → d=3.7 → −18.5% at steady state: Saner −19%, Lamon −18%; cap −20%);
`testosteroneMult(men) = 1 − 0.05·min(dS,5)` (5 h × 8 nights, dS≈2.4 → −12%: Leproult −10 to −13%; acute total deprivation −24% at cap −25%).
Apply `mpsMult` to the *response* term of MPS in 03/09 (breakdown unchanged in both trials). Optional (grade C, default off): if ≥3 HIIE sessions per 5 days, set `mpsMult=1.0` [12].
Cortisol: conflicting (+51% salivary [9]; +21% acute [13]; unchanged in [14]) → grade C/D; give 12 a range +0…+20% at dS≥2.5, never a driver.
Women: no chronic sleep-restriction hormone data located → apply MPS multiplier to women (Lamon included 6 women) but no testosterone term (D).
Evidence grade: **B** (two controlled human MPS studies with concordant −18/−19%, but small and short; chronic translation to muscle mass is grade C).

#### 4.1.6 Energy expenditure

| Study | Result |
|---|---|
| Markwald 2013 [11] (N=16, 5 d, 5 h) | TEE +≈5% (extra wakefulness); intake exceeded it |
| Al Khatib 2017 [3], Zhu 2019 [4] | no significant change in TEE or RMR |
| Covassin 2022 [15]; Calvin 2013 [18] | EE (incl. activity EE) unchanged |
| Shechter 2014 [20]: 10 women, 3 nights 4 h vs 8 h, whole-room calorimeter | RMR 1.01 vs 0.97 kcal/min (NS), TEF unchanged, fasting RQ lower after short sleep |
| Nedeltcheva 2010 [1] (in deficit) | RMR lower after 5.5 h TIB (P=0.01) |
| Buxton 2012 [25] | RMR **−8%** after 3 wk 5.6 h **with** circadian disruption; partial recovery after 9 d |
| McHill 2014 [27]: 14 adults, simulated night shift | TEE +4% on transition day, **−3%** on night-shift days 2–3; EE −12–16% during daytime sleep; TEF lower after late dinner |

Model: `teeMult = 1.00` for plain short sleep (the brief's "≈+100 kcal awake cost" ≈ Markwald's +5% of ≈2,500 kcal is real but tiny relative to the intake effect; ignore).
With **shift-work flag**: `teeMult = 0.97` on night-shift days; `TEF_late_dinner ×0.85` (PROPOSED; direction from [27], magnitude UNVERIFIED);
`rmrMult = 0.92` only if flag on **and** dS ≥ 2 for ≥ 14 d [25]. Evidence grade: **B** (no EE effect of short sleep; A for "not decreased"); **C** for shift-work terms.

#### 4.1.7 Fat distribution
Covassin [15]: 14 d at 4 h vs 9 h ad-lib: DXA total fat, lean, android fat no different between conditions (P>0.14) but CT total abdominal fat +9% (net +15.2 cm², 95% CI 3.6–26.8, P=0.011),
subcutaneous +8% vs +4% (net 7.4 cm²), **visceral ≈ +11%** (P=0.042 between conditions). **PROPOSED:** for the fat gained in maintenance/surplus,
`vatShareOfGain += 0.05·dS` (absolute). Grade **C** (N=12, 9 men, 14 days, single study).

#### 4.1.8 Training performance / recovery (acute)
Craven 2022 meta [24] (69 publications, 227 outcomes; 89% male): overall −7.56% (95% CI −11.9 to −3.13); by category strength **−2.85%** (−4.47 to −1.23), anaerobic power −6.26% (−9.10 to −3.41),
endurance −5.55% (−8.12 to −2.99), HIIE −6.15% (−10.5 to −1.77). By protocol: deprivation strength −3.00%; *early* restriction (delayed bedtime) strength −1.16% (−2.57 to +0.25);
*late* restriction (early waking) strength −4.45% (−9.30 to +0.41), HIIE −11.5%. ≈0.4% performance loss per hour awake before the task; **AM tasks largely unaffected**.
**PROPOSED:** `strengthMult = 1 − 0.008·min(dF,4)`, `powerEnduranceMult = 1 − 0.015·min(dF,4)`, halved if the session starts before 12:00. Grade **B** (meta-analysis, very high heterogeneity I²=98%).
Recovery/hypertrophy consequence is carried by `mpsMult`; no separate "recovery" multiplier has verified data (grade D).

#### 4.1.9 Sleep quality, timing and shift work
- **Quality (fragmentation, low SWS).** Selective slow-wave suppression lowers Si without changing sleep time [28]; poor sleep quality (PSQI) predicted 2.2 ± 1.2% less weight loss vs 4.5 ± 1.3% for short duration [30].
  `qualityEq = 0.75 h` (band 0.5–1.5; = ~half the short-sleep effect) added to `d_t`. Grade **C**.
- **Timing / delayed bedtime.** Late bedtime days had extra intake of ≈553 kcal between 22:00 and 03:59 and 130% of requirement [19]; delayed circadian phase after restriction [11][21].
  No separate parameter; the intake-timing profile in 4.1.2 already places the extra kcal late.
- **Shift work / circadian misalignment.** 12-h misalignment: leptin −17%, glucose +6% with insulin +22%, cortisol rhythm reversed, sleep efficiency −20%, mean arterial pressure +3% (N=10) [26];
  3 of 8 subjects reached prediabetic postprandial glucose. `qualityEq += 1.0 h` with the shift-work flag (PROPOSED), plus the EE terms in 4.1.6. Grade **C** (small lab studies; epidemiology in 07).
- **Long sleep (>9 h)** and naps: not modelled (no dose-response data in this dossier).

#### 4.1.10 Sleep extension / recovery
Extension in habitual short sleepers reduces intake and body weight (Tasali [7]); the model already yields this through the falling `dF`.
Weekend catch-up is **not** an effective repair (Si −9 to −27% persists [21]; Si/disposition index not restored after 2 nights [22]), which the asymmetric τ_S reproduces.
Evidence grade: **B**.

#### 4.1.11 Parameter summary (sleep)

| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| h_ref | 7.5 | h | 7–8 | [1] |
| k_EI | 0.04 (cap 0.16) | fraction of maintenance per h | 0.025–0.06 | [3][4][5][7][15][17][18] |
| k_hunger | 4 (cap 16) | VAS points per h | 2–6 | [4][8] |
| k_P | 0.04 (cap 0.12) | ΔP per h | 0–0.08 | [1][2] |
| k_Si | 0.07 | per h | 0.03–0.10 | [9][10][21] |
| k_MPS | 0.05 | per h | 0.03–0.07 | [12][13] |
| k_T (men) | 0.05 | per h | 0.03–0.07 | [13][14] |
| k_VAT | 0.05 | absolute VAT-share per h | 0–0.10 | [15] |
| k_strength / k_power | 0.008 / 0.015 | per h | ±50% | [24] |
| qualityEq poor / shift | 0.75 / 1.0 | h | 0.5–1.5 | [26][28][30] |
| τ_F on/off; τ_S on/off | 1/2 d; 3/5 d | days | ±50% | [17][11][9][10][22][21] |

### 4.2 DIET → SLEEP (outputs; feedback into sleep hours is OFF by default)

Design decision: the user *enters* sleep hours (actual). Diet-induced sleep loss is shown as an **impact estimate** ("this caffeine timing is predicted to cost ~40 min of sleep")
and used as a Planner soft-constraint. An optional advanced toggle "apply predicted diet-induced sleep loss to tonight's sleep" subtracts `TSTloss/60` h — leave OFF to avoid double counting.

#### 4.2.1 Caffeine (dose × time before bed)

| Fact | Value | Source / grade |
|---|---|---|
| Pooled effect of caffeine on next sleep | total sleep time −45 min; sleep efficiency −7%; sleep-onset latency +9 min; WASO +12 min; N1 +6.1 min (+1.7%); N3 −11.4 min (−1.4%) (24 studies) | [31] Gardiner 2023, A |
| Cut-off to avoid TST loss | coffee 107 mg per 250 mL: ≥ **8.8 h** before bed; pre-workout 217.5 mg: ≥ **13.2 h** before bed | [31] |
| Home RCT dose-timing | 400 mg at 0, 3 or 6 h before habitual bedtime each significantly disturbed sleep vs placebo; authors conclude that caffeine 6 h before bed has an important disruptive effect (numeric TST losses not in the abstract/PMC text I could extract) | [32] Drake 2013, B |
| Half-life (healthy non-smoking women, 162 mg) | **5.37 h** (clearance 1.75 mL/min/kg, Vd 0.75 L/kg) | [33] Abernethy & Todd 1985, C (n small) |
| Combined oral contraceptive users | half-life **7.88 h** (×1.47), clearance 1.05 mL/min/kg | [33] |
| Smokers | clearance 114 ± 40 vs 64 ± 20 mL/min in non-smokers (≈×1.8) → half-life ×0.56 | [34] Joeres 1988, C |
| Inter-individual variation | 89% of AUC variance genetic (CYP1A2) once smokers and OC users excluded (twin data, as summarised); sex has no significant effect on CYP1A2 activity | [35] review, B/C; individual half-life range UNVERIFIED |

**PROPOSED FIT.** Body caffeine decays first-order: `C(t) = Σ_i dose_i · 2^(−(t − t_i)/t½)`, `t½ = 5.4 h` (7.9 h if combined OC; ×0.56 if smoker).
Residual at bedtime `R = C(t_bed)`. Gardiner's two "safe" cut-offs correspond to residuals `107·2^(−8.8/5.37) = 34 mg` and `217.5·2^(−13.2/5.37) = 40 mg`, i.e. a consistent
**no-TST-loss threshold R\* ≈ 37 mg** (this consistency is the main support for the fit). Above it:
`TSTloss_min = min(120, 0.40·max(0, R − 37))`, `SOL +0.20·TSTloss`, `WASO +0.27·TSTloss`, `SE −0.155 pp per min TSTloss`, `N3 −0.25·TSTloss`
(slope 0.40 min/mg chosen so a typical pooled residual of ≈150 mg gives Gardiner's −45 min; ratios from the pooled effects above).
Check: 400 mg at 6 h → R=184 mg → −59 min (Drake: disruptive, direction agrees); 400 mg at 3 h → R=272 mg → −94 min; 400 mg at 0 h → cap.
Grade: **B** for existence/timing logic (meta-analysis + RCT), **C** for slope. Interaction: dossier 15 supplies caffeine mg/time; sleep loss then follows from this equation.

#### 4.2.2 Alcohol
Gardiner 2025 meta-analysis [36] (27 studies): REM onset delayed, REM duration reduced; **REM disruption occurs even at ≤0.50 g/kg (≈2 standard drinks) and worsens with dose**;
sleep-onset and deep-sleep latency shortened only at ≥0.85 g/kg (≈5 drinks), which likely worsens later REM disruption; effects on TST, SE and WASO too uncertain to quantify.
Autonomic: 1–2 drinks (BAC ≈0.02%) vs 3–4 drinks (≈0.05%), 26 adults (11 F): nocturnal heart rate ↑, HRV (vagal) ↓, baroreflex sensitivity ↓, sympathetic activity ↑, dose-dependent [37].
Model: no TST equation (grade D for magnitudes); use in `sleepQualityScore` (4.2.6) and to flag "alcohol within 4 h of bed" in Planner outputs. Energy (7 kcal/g) and hydration handled in 15. Grade **A** (direction), **D** (magnitude).

#### 4.2.3 Evening meal timing and macronutrients

| Finding | Source | Grade |
|---|---|---|
| 12 men, iso-energetic 90%-carbohydrate meals (3,212 kJ ≈ 768 kcal): sleep-onset latency **9.0 ± 6.2 min** after high-GI (jasmine rice) meal 4 h before bed vs **17.5 ± 6.2** after low-GI (P=0.009); high-GI meal 1 h before bed 14.6 ± 9.9 min (worse than 4 h, P=0.01); no other sleep variable changed | [38] Afaghi 2007 | C (n=12 men) |
| Meta-analysis, 11 articles/27 trials: carbohydrate quantity and glycaemic load explain variance in onset latency (R²=25.9% and 50.8%); carbohydrate *quality* did not change stages | [40] Vlahoyiannis 2021 | B |
| 52 adults: nocturnal (dinner/late-snack) intake correlated with worse latency/efficiency/WASO (sex-specific correlations) — cross-sectional | [41] Crispim 2011 | C/D |
| 26 adults (inpatient, habitual-sleep arm): ad-libitum eating day vs controlled diet → less SWS (P=0.043), longer latency (P=0.0085); fibre ↑ → less N1 and more SWS; % saturated fat ↑ → less SWS; sugar and other non-fibre carbohydrate ↑ → more arousals | [42] St-Onge 2016 | C (associational) |

No study isolates "large late meal" per se from total intake; treat as C/D. Model: heuristic contributions to `sleepQualityScore` only.

#### 4.2.4 Very-low-carbohydrate intake and sleep architecture
14 healthy non-obese men, 48 h of ~<1% carbohydrate / 61% fat / 38% protein vs mixed diet (isoenergetic 2,400 kcal): SWS% **17.7% (acute) / 17.8% (ketosis phase) vs 13.9%** (P=0.02);
REM% reduced (P=0.006 acute, n=11; P=0.05 ketosis, n=14) [39]. Meta-analysis: low- vs high-carbohydrate intake raises N3 duration (ES 0.37, 95% CI 0.18–0.56) and proportion (ES 0.51, 0.33–0.69) and shortens REM [40].
Only 48 h; keto-adaptation over weeks untested (D). No effect on sleep *hours* is implied; report as architecture information. Grade **B** short-term / **D** long-term.

#### 4.2.5 Energy deficit and leanness
- CALERIE 2 (N=220, BMI 22–28, 2 y, CR arm lost 7.6 kg vs 0.4 kg): **sleep duration improved at 12 mo** (PSQI duration difference −0.26, 95% CI −0.49 to −0.02) and greater weight loss correlated with better sleep quality (ρ=0.28); mood and tension also improved [45].
  → a *moderate* deficit in non-obese adults does not impair sleep. Grade **B** (single large RCT, self-report sleep).
- Extreme leanness/deficit: single case report of natural bodybuilding prep (body fat 14.8% → 4.5%; testosterone 9.22 → 2.27 ng/mL; total mood disturbance 6 → 43; resting HR 53 → 27 bpm); sleep not reported in abstract [46]; energy availability <30 kcal/kg LBM/d disrupts LH pulsatility [68] but sleep was not measured. Grade **D**.
- Nedeltcheva: hunger ↑ *because of* short sleep during deficit [1]; the reverse direction (deficit-induced night hunger → shorter sleep) has no quantified human evidence I could find.
Model: no sleep penalty for deficits; add flag "very low energy availability may worsen sleep, mood and hormones" (17).

#### 4.2.6 Exercise timing and `sleepQualityScore` (UI heuristic)
- Evening exercise meta-analysis (23 studies): REM latency +7.7 min, SWS +1.3 pp, N1 −0.9 pp; no adverse effect overall; vigorous exercise ending ≤1 h before bed may lower SE (−3.2 pp for higher relative exercise stress), increase WASO (+21.9 min); moderators vanished when one study was removed [43]. Physical-activity meta-analysis (66 studies): acute exercise small benefits (TST, SOL, SE, N1, SWS), moderate on WASO; regular exercise small–medium on latency, moderate on sleep quality [44]. Grade **B**.
- **`sleepQualityScore` = 75 − TSTloss_caffeine_min/3 − 6·(alcoholGPerKg/0.25 within 4 h of bed, cap 20) − 5·[largest meal ≤2 h before bed] − 5·[vigorous exercise ending ≤1 h before bed] + 3·[fibre ≥25 g] − 3·[saturated fat >12% en] − 3·[free sugar >10% en] + 3·[regular exercise ≥150 min/wk]**, clamp 0–100.
  PROPOSED HEURISTIC: weights are **not** physiologically calibrated (grade D); the score is a UI aid and is never fed back into the simulation.

### 4.3 PSYCHOLOGICAL STRESS

**Mechanism.** Stress raises cortisol/sympathetic tone and changes eating behaviour in a heterogeneous way (more energy-dense "comfort" food in some, appetite loss in others; restraint moderates),
and disturbs sleep (handled in 4.1). Cross-sectional links between long-term cortisol exposure and central adiposity exist but causal direction is unclear.

| Evidence | Result | Source |
|---|---|---|
| Meta-analysis, stress and eating in healthy adults (54 studies, N=119,820) | stress → overall intake Hedges g **0.114**; unhealthy food g 0.116; healthy food g −0.111; only moderator found: dietary restraint; large unexplained heterogeneity | [47] Hill 2022, A (small effect) |
| Meta-analysis of 14 longitudinal cohorts, stress → adiposity | pooled r = **0.014** (95% CI 0.002–0.025); 69% of analyses non-significant; stronger in men, longer follow-up, better quality studies; "effects very small" | [48] Wardle 2011, A |
| Hair cortisol vs adiposity, 146 cohorts, n=34,342 (cross-sectional) | HairF–BMI r=0.10 (0.08–0.13); HairE–waist r=0.18 (0.11–0.24; 11.0 cm waist per unit log10 HairE) | [49] van der Valk 2022, B (cross-sectional) |
| Cortisol awakening response vs hair cortisol and obesity | trait (hair) cortisol correlates with BMI/waist; state (CAR) does not | [50] Ostinelli 2021, B |
| Lab stress and body shape, 59 premenopausal women | high waist-to-hip women had greater cortisol reactivity; lean high-WHR women failed to habituate (cross-sectional) | [51] Epel 2000, C |
| Wound healing, 13 caregivers vs 13 controls | healing 48.7 ± 2.9 vs 39.3 ± 3.0 d (+24%) | [52] Kiecolt-Glaser 1995, C |

What is solid enough to model: **only a small intake/adherence drift**. Everything else is either cross-sectional (cortisol–fat), too small (r=0.014), or has no human data I could locate
(stress-induced water retention, stress-specific recovery multiplier).
**Equations (PROPOSED):** if `stress = high sustained`: in ad-libitum mode `ΔEI = +0.02 × maintenance` (band 0–0.04; derived from g≈0.11 × an assumed between-person intake SD of ≈500–600 kcal ⇒ ≈+55–65 kcal; the SD is UNVERIFIED),
and the daily adherence-noise SD ×1.5; hunger VAS +2. No effect on fat partition, water, RMR, MPS. Restrained eaters: no adjustment (moderator direction unclear).
Grade: **C** (direction B). Input decision: advanced 3-level selector, default "typical" (= no effect); recommended to expose only as a Planner risk flag in v1.

### 4.4 BIOLOGICAL SEX

**Mechanism.** Most sex differences in energy metabolism are *compositional* (women carry more fat, less organ/muscle mass per kg) and are already carried by
FFM/FM-based equations. What remains after adjustment is small for expenditure, moderate for exercise fat oxidation, and hormonal (leptin, reproductive-axis sensitivity).

#### 4.4.1 RMR / TEE
- Arciero 1993 [59]: 328 men, 194 women; measured RMR 1,740 vs 1,348 kcal/d (+23% men); after controlling FFM, FM and peak VO2, women's RMR **3% lower** (1,563 vs 1,613 kcal/d; adjusted SDs 153 and 127 kcal/d ≈ 8–10%).
  Caution: co-author E. Poehlman was later found to have falsified data in other papers (see retracted study in 4.7); this 1993 record shows no retraction notice, but use only as supporting evidence.
- **Pontzer 2021 [60]** (DLW, n=6,421, 29 countries): `TEE (MJ/d) = 0.677·FFM^0.708` (r²=0.83); in adults 20–60 y sex had no detectable effect on total expenditure once FFM and FM were in the model.
  Residual inter-individual variation in TEE ≥ ±20% after adjusting FFM, FM, sex, age.
- Organ-level: Elia-type specific rates (kcal/kg/d): liver 200, brain 240, heart & kidneys 440, skeletal muscle 13, adipose 4.5, residual 12; >50 y ≈3% lower [71].
- **Model:** with any FFM+FM-based RMR (02) use **no additional sex multiplier**; with Mifflin–St Jeor sex enters through its own offset. Grade **A/B**.

#### 4.4.2 Substrate use
Women oxidise proportionally more fat during submaximal endurance exercise (lower RER; higher intramuscular lipid; lower leucine oxidation) [57][70].
In 300 adults (157 M/143 F): maximal fat oxidation (MFO) 7.8 ± 0.13 mg/kg FFM/min overall; **women 8.3 ± 0.2 vs men 7.4 ± 0.2** (P<0.01, **+12%**); Fatmax 52 ± 1 vs 45 ± 1 %VO2max;
activity level, VO2max and sex explained only 12% of the variance; body fat was not a predictor [58].
**Model:** `fatOxPerKgFfmMult = 1.12` for women (exercise substrate module, 10/05); no resting difference is modelled. Grade **A/B**.
Insulin sensitivity: women's muscle tends to be more insulin sensitive with higher IMCL/leptin/adiponectin, but no numeric multiplier is supportable [70] (C).

#### 4.4.3 Fat distribution, regional lipolysis, essential fat
- At the same BMI women have **10.4 percentage points more body fat** (665 adults, HERITAGE) [69]; regional biology (gluteofemoral storage, sex-steroid effects) reviewed in [63] (qualitative).
- MRI, 81 men/72 women: for a given weight or waist loss **men lose more VAT and less SAT**; total abdominal adipose loss is equal; differences widen with larger loss [61].
  In 24 obese women, energy restriction ± exercise gave preferential VAT loss (VAT:SAT ratio ↓) [62] → both sexes lose VAT preferentially.
- **PROPOSED** (magnitude UNVERIFIED): `vatShareOfLossMult = 1.3 (men) / 0.8 (women)` on the baseline VAT share of fat loss (14 owns the absolute VAT model). Grade **C**.
- Essential-fat floors (commonly quoted ~3–5% men, ~10–13% women): I could not verify a primary source → defer to 14/17 (UNVERIFIED).

#### 4.4.4 Rate and composition of weight loss — contested
| Study | Design | Result |
|---|---|---|
| PREVIEW LED phase, Christensen 2018 [53] | 2,224 overweight adults with prediabetes (1,504 F/720 M); 8 wk at 810 kcal/d (Cambridge plan); mixed DXA/BIA across 8 sites | weight loss 11.8% (M) vs 10.3% (F) (men 16% greater; men had larger energy deficit); FM −9.3 vs −7.1 kg; **FFM −1.9 vs −3.2 kg**; FFM share of weight loss **16.1% (M) vs 31.4% (F)** (mean 25%); differences remained after adjusting for % weight loss; HOMA-IR fell similarly (−1.50 vs −1.35) |
| Millward 2014 [54] | 287 adults (210 F/77 M), DXA, four commercial diets, 2 and 6 months | baseline FFM% of excess weight 40% (M) vs 27% (F) (P-ratio 0.071 vs 0.039); at 2 months men lost 2× the weight and 3× the FFM of women (P-ratio 0.052 vs 0.029); between 2 and 6 months FFM share of loss fell to 7% (M) and 5% (F) (P 0.009 vs 0.006); convergence, no diet effect |
The two studies point in opposite directions for *FFM share* (women higher in PREVIEW; men higher early in Millward). Millward's result is consistent with the Forbes/Hall expectation that a leaner starting composition (men) gives a larger fat-free share of early loss [115] (my inference; Millward's abstract does not invoke it); PREVIEW may reflect
method heterogeneity (BIA vs DXA), a very-low-energy diet and water/glycogen shifts inside "FFM".
**Best-supported estimate:** *no separate sex term* — let the Forbes/Hall dependence on initial FM (01) create sex differences; show a wider band (±0.10 on FFM share, 80% interval). Grade **C** (contested).
Early rate: men lose more absolute weight mainly because of larger absolute deficits [53]; the energy-balance model handles this.

#### 4.4.5 Ketone production / fasting
Fasting plasma BHB (n=6,102) women 123 vs men 119 µmol/L (P<0.001); combined OC use +45% (multivariable), postmenopausal −11%; in men +1%/yr with age [66].
Postprandial BHB incremental AUC after an oral fat load: women 1.37 ± 0.49 vs men 0.98 ± 0.43 mmol·h/L [67]. 38-h fast: women higher FFA and lipolysis, lower glucose, same insulin-mediated glucose uptake [65].
Leanness confounds: lean subjects show ~2× the early-starvation ketonaemia of obese subjects [116]. No controlled multi-day fasting study with a sex comparison found.
**PROPOSED:** `ketoneProdMult = 1.10 (women)`, `×1.45 if combined OC`, `×0.89 if postmenopausal` (05 owns the ketone ODE). Grade **C/D**.

#### 4.4.6 Leptin per kg fat
At equal BMI women's serum leptin is ≈2× men's (n=32 M/63 F; body fat 49% vs 36%); adipose leptin secretion per unit tissue in men ≈2/3 of women's; differences persist after adjusting for body fat [64].
Serum leptin correlates with % body fat (r=0.85; 31.3 vs 7.5 ng/mL in obese vs lean) [72]. **Model:** `leptinPerKgFatMult = 1.5 (women)` (12 owns dynamics). Grade **B**.

#### 4.4.7 Muscle gain: relative vs absolute
Meta-analysis (10 studies/12 outcomes): hypertrophy effect-size difference M–F 0.07 ± 0.06 (P=0.31) → **equal relative hypertrophy**; relative upper-body strength gain favours women (ES −0.60 ± 0.16), lower-body NS [55].
585 adults, 12 wk elbow-flexor training: CSA change ranged −2% to +59%; men +2.5% greater relative CSA gain (P<0.01) but women greater relative strength gains; CV for CSA change 0.48 (M) / 0.51 (F) [56].
**Model:** `%-hypertrophy rate` identical for sexes (multiplier 1.00); absolute kg gain is then proportional to baseline muscle mass (women ≈ smaller absolute). Grade **A**.

#### 4.4.8 Protein requirement and reproductive-axis sensitivity
- No sex-specific per-kg protein requirement is established in the sources read; use g/kg FFM (03). (Lower leucine oxidation in women [57] is mechanistic only.) Grade D for any multiplier.
- **Energy availability (EA = intake − exercise energy, per kg LBM):** in 29 regularly menstruating sedentary women, 5 days in early follicular phase with exercise 15 kcal/kg LBM/d: LH pulsatility unaffected at EA 30 kcal/kg LBM/d,
  disrupted below (pulse frequency ↓, amplitude ↑), worse in women with short luteal phases [68]. **Safety flag:** planned EA <30 kcal/kg LBM/d in women → warning (17); no equivalent male threshold located. Grade **B** (single mechanistic RCT-type study; 45 kcal/kg LBM/d was the "control" level).

### 4.5 MENSTRUAL CYCLE AND HORMONAL CONTRACEPTION

**Mechanism.** Estradiol and progesterone fluctuate rather than switch on/off; the luteal phase (progesterone high, ≈days 15–28) may raise appetite and slightly raise RMR; fluid balance effects are small and person-specific.

| Outcome | Evidence | Grade |
|---|---|---|
| **Energy intake** | Meta-analysis, 15 datasets, 330 women (age 26, BMI 22.4): luteal > follicular, SMD 0.69 (P=0.039), **crude +168 kcal/d**; many methodological inconsistencies [73]. Review: luteal EI and EE increased, more carbohydrate/fat cravings [75]; estrogen inhibits, progesterone/testosterone stimulate intake [90]. Counter-example: carbohydrate intake higher in early follicular (234 g) than mid-luteal (209 g), n=21 [79] | B−/C |
| **RMR** | Meta-analysis, 26 studies/318 women: luteal > follicular ES 0.33 (0.17–0.49), I²=3.8%; studies since 2000 ES 0.23 (−0.00 to 0.47, p=0.055); 47% of 30 studies found an increase [74]. n=21: no RMR difference (p=0.148) [79]. kcal effect not reported in abstracts → cannot convert; older literature suggests a few % (UNVERIFIED) | B (small) |
| **Scale weight / water** | Self-reported "fluid retention" (0–4 scale, 62 women, 765 cycles): peak **day 1 of flow** (0.9 ± 0.1), lowest mid-follicular, rise 0.22 → 0.50 over the 11 days around ovulation; **not associated with estradiol or progesterone** [76]. Plasma volume: 2,276 mL early follicular → 2,232 late follicular → 2,228 mid-luteal (≈−2%, n=45) [77]. DXA/BIA n=30: body mass higher in mid-luteal, total body water and fat unchanged, large individual variability [78]. n=21: body weight **lower** in mid-luteal (65.2 → 64.9 kg, p=0.029) with lower extracellular-water ratio [79]. n=29: no difference in weight or total body water; regional trunk water higher in luteal [80]. n=25 daily weighing: phase weight differences related to sodium intake; BIA-derived FFM shifts with hydration [81] | C/D |
| **Substrate use** | n=19: peak fat oxidation 0.379 / 0.375 / 0.382 g/min (mid-follicular / late-follicular / mid-luteal), Fatmax NS, weight and composition unchanged [82]. Meta-analysis: no difference between phases in relative CHO/fat oxidation at rest or during exercise [83] | A/B |
| **Exercise performance** | 78 studies: trivial reduction in early follicular ES −0.06 (95% credible interval −0.16 to 0.04); low evidence quality; no general guideline possible [84]. Umbrella review: no influence on strength performance or RT adaptations [86] | A/B (low quality) |
| **Insulin sensitivity** | no meta-analysis in non-diabetic women located; effects described as "relatively subtle" [83] | D |
| **Hormonal contraceptives** | Cochrane, 49 RCTs: no evidence of a causal weight effect; "no large effect" [89]. Performance: 42 studies/590 women, trivial and variable, average slightly inferior [85]. RT, 12 wk, N=32: OC users larger arm lean mass (+5.5 ± 3.9 vs +2.9 ± 2.8%) and vastus lateralis CSA (+10.0 ± 4.1 vs +5.3 ± 4.4%), no lower-body strength difference, OC group slept 42 min longer [88]; earlier review conflicting [87]. Combined OC: BHB +45% [66]; caffeine half-life ×1.47 [33] | C |

**Decision: cycle modelling is an optional, default-OFF toggle**, because no effect other than hunger has a robust size, and the scale-weight literature disagrees on sign.
When ON (regular cycle, no hormonal contraception; user gives last-menses date and cycle length L, default 28):
```
lutealFlag_t   = 1 if cycleDay in [ceil(L/2)+1 .. L] else 0          // ~days 15-28 for L=28
hungerVas     += 5 * lutealFlag_t                                       // PROPOSED (grade C)
ΔEI (ad-lib)   = +168 * lutealFlag_t kcal/d   (band +50 … +300)         // Tucker crude difference [73]
scaleNoiseKg   = 0.3   // ± display band added to the generic daily water band; NOT a deterministic curve (sign inconsistent [78][79][80])
RMR, substrate use, performance, hypertrophy: multiplier 1.00 (optional RMR ×1.02 luteal)
```
Hormonal contraception (combined pill/patch/ring): cycle toggle disabled; apply BHB/caffeine terms above; hypertrophy multiplier 1.00 with a wider band (OC effect on hypertrophy unresolved [87][88]).
Progestin-only/hormonal IUD: no data collated — treat as "no cycle toggle".
Grade summary: intake **B−**, RMR **B (small)**, water **C/D**, substrate **A/B**, performance **A/B (low quality)**.

### 4.6 PREGNANCY AND LACTATION (hard exclusion — coordinate 17)
Pregnancy: total energy cost of a 12-kg gestational gain ≈ 321–325 MJ (≈375, 1,200, 1,950 kJ/d = 90, 287, 466 kcal/d in trimesters 1–3) [136]. Lactation (exclusive): milk energy ≈ **2.62 MJ/d (626 kcal/d)** at 749 g/d, efficiency 0.80;
net additional requirement ≈ **1.9 MJ/d (454 kcal/d)** after mobilising ≈0.72 MJ/d (172 kcal/d) from tissue [136]. FFM/FM-adjusted expenditure is unchanged in pregnancy [60], so expenditure changes are body-size driven.
**App behaviour:** checklist item → refuse to simulate; warning text for lactation: "Lactation adds about 450–630 kcal/day of energy demand; deficit diets and fasting are not simulated." Grade **B** (factorial estimates).

### 4.7 MENOPAUSE

**Mechanism.** Falling estradiol shifts fat storage toward visceral depots, lowers fat oxidation, accelerates bone resorption, and modestly reduces lean mass; much of the "menopausal weight gain" is age-related and behavioural (activity fell 2 years before FMP [91]).

| Evidence | Result |
|---|---|
| SWAN body composition [92] (N=1,246; baseline age 47.1; mean FMP age 52.2; DXA; numbers read from the journal's page) | Fat mass **+1.0%/yr (+0.25 kg/yr)** in premenopause → **+1.7%/yr (+0.45 kg/yr)** during the transition (≈2 y before to 1.5 y after FMP; total ≈ +6% = +1.6 kg over 3.5 y) → ~0 slope afterwards. Lean mass **+0.2%/yr → −0.2%/yr** (total −0.5% ≈ −0.2 kg) → ~0 afterwards. Weight itself climbs linearly without acceleration |
| Lovejoy 2008 [91] (156 women, 4 y annual; CT fat, DXA, whole-room calorimetry in n=34) | only women who became postmenopausal (n=51) gained body fat and **VAT** (all gained SAT); sleeping EE fell 7.9% in women who became postmenopausal vs 5.3% in those who stayed premenopausal (1.5×); fat oxidation **−32%**; leisure activity fell 2 y before menopause |
| Ambikairajah 2019 [93] (201 cross-sectional + 11 longitudinal studies) | post- vs pre-menopause: body fat +2.88 pp, waist +4.63 cm, WHR +0.04, visceral fat +26.9 cm², trunk fat +5.49 pp, **leg fat −3.19 pp**; changes attributable predominantly to *age*, menopause adds distribution shift not quantity |
| Davis 2012 review [94] | weight gain per se not attributable to the transition; total and abdominal fat increase; estrogen therapy ameliorates abdominal fat gain |
| HRT meta-analysis [95] (107 RCTs) | abdominal fat **−6.8%** (95% CI −11.8 to −1.9), HOMA-IR −12.9%, new-onset diabetes RR 0.7; oral (not transdermal) raises CRP 37.6% |
| Bone [96][97] (SWAN) | loss begins ≈1 y before FMP, fastest until ≈2 y after ("transmenopause"): cumulative 10-y LS BMD −10.6% (7.38% within transmenopause ≈ 2.5%/yr), FN −9.1% (5.8% ≈ 1.9%/yr); higher BMI slower loss; Chinese/Japanese faster |
| **Poehlman 1995** (Ann Intern Med 123:673; reported RMR −103 kcal/d and FFM −3.0 kg after menopause) [98] | **RETRACTED (Ann Intern Med 2003;139:702). Do not use.** |

**Model (PROPOSED, offsets relative to the premenopausal trajectory; apply only while `menopauseStatus=peri` i.e. years −2…+1.5 around FMP):**
`fatDriftExtra = +0.20 kg/yr` (≈+0.7 pp/yr), `leanDriftExtra = −0.12 kg/yr` (≈−0.4 pp/yr), `vatShareOfGain += 0.10`, optional `sleepingEEExtra = −0.65%/yr` (Lovejoy, n=34; grade C — default off because Pontzer's FFM/FM-adjusted expenditure is flat 20–60 y [60]).
Over a 3–6-month simulation these are ≈ ±0.1 kg, i.e. **negligible compared with deficits/surpluses**; the practical value of the input is (a) VAT partition, (b) bone/protein/resistance-training warnings (LS −2.5%/yr, FN −1.9%/yr during transmenopause), (c) HRT toggle: `abdominalFat ×0.93`, `HOMA-IR ×0.87` (grade A/B).
Menopause status default: `<50 y pre; 50–53 y peri; ≥54 y post` (window from mean FMP age 52.2 y and a transition spanning ≈2 y before to 1.5 y after FMP [92]), overridable by the user (early/late menopause, surgical menopause); postmenopausal: apply age functions only.
Grade: fat/lean drift **B** (single large cohort), RMR term **C**, bone **B**, HRT **A/B**.

### 4.8 AGEING

**Mechanism.** After adjusting for FFM and FM, expenditure is flat from 20 to ~60 y and then declines; muscle mass and (faster) strength erode; muscle becomes less responsive to a given protein dose and to resistance exercise
("anabolic resistance"); glucose tolerance and aerobic capacity decline; deficits in older adults carry a larger lean/bone cost.

#### 4.8.1 Expenditure
Pontzer 2021 [60]: FFM- and FM-adjusted TEE **stable 20–60 y (even in pregnancy)**; segmented-regression break point **63.0 y (95% CI 60.1–65.9)**; thereafter adjusted TEE declines **−0.7 ± 0.1 %/yr**, adjusted basal expenditure similarly
(basal break point 46.5 y, CI 40.6–52.4, imprecise: few basal data at 45–65 y); ≈26% below middle-aged adults in the nineties. Absolute expenditure falls additionally as FFM and FM fall (both decline after ~60 y).
Organ-level specific rates ≈3% lower in >50 y [71]. **Model:** `ageRmrMult = 1 − 0.007·max(0, age − 63)` (age 75 → 0.916; 85 → 0.846); applied *in addition to* the FFM/FM terms.
Unadjusted "metabolism slows in the 40s" is mostly composition: e.g. sleeping EE fell 5.3% over 4 y in premenopausal women [91] alongside FFM/FM change. Grade **A** (DLW, n=6,421; validated across ages).

#### 4.8.2 Muscle mass and strength drift
Quantitative review [99]: cross-sectional median loss **0.47%/yr in men, 0.37%/yr in women**; longitudinal at ~75 y: **0.80–0.98%/yr (M), 0.64–0.70%/yr (F)**; strength loss at 75 y **3–4%/yr (M), 2.5–3%/yr (F)** (2–5× faster than mass).
(The "3–8%/decade" range in the brief is compatible: 3.7–4.7%/decade cross-sectional to ≈8–9%/decade longitudinal at 75; the original single-source figure is UNVERIFIED.)
**Model (background drift, only relevant for multi-year runs):** `muscleDriftPerYr(age,sex) = 0 (<50); linear ramp from 0.0037 (F) / 0.0047 (M) at 50 to 0.0065 (F) / 0.0090 (M) at 75; constant above`. Grade **B**.

#### 4.8.3 Anabolic resistance (per-meal protein) — coordinate 03
- Moore 2015 [100] (retrospective pooled tracer data, healthy men ~71 y vs ~22 y; 0–40 g high-quality protein bolus): basal MPS equal (0.027 vs 0.028 %/h); MPS plateau reached at **0.40 ± 0.19 g/kg (old) vs 0.24 ± 0.06 g/kg (young)** (p=0.055) or **0.60 ± 0.29 vs 0.25 ± 0.13 g/kg LBM** (p<0.01); slope of the ascending limb lower in older men.
- Kumar 2009 [101] (25 young 24 y vs 25 old 70 y men, post-absorptive): MPS vs exercise intensity (20–90% 1RM) is sigmoidal with a plateau at 60–90% 1RM, **blunted in older men**; p70S6K/4EBP1 phosphorylation blunted at 60–90% 1RM; MPS returns to near-basal by 2–4 h in both.
- Obesity adds to it in older men: insulin + amino-acid infusion raised MPS only in healthy-weight (BMI 23.4) not obese (BMI 31.9) men aged 55–75; postprandial leg glucose disposal 63% lower, yet lean mass and strength were equal [117].
- PROT-AGE [103]: >65 y at least **1.0–1.2 g/kg/d**; ≥1.2 g/kg/d if exercising; 1.2–1.5 g/kg/d with acute/chronic disease; exception eGFR <30 mL/min/1.73 m² not on dialysis.
**Model:** `proteinPlateauGPerKg = 0.24 + 0.16·clamp((age − 40)/30, 0, 1)` (0.40 g/kg from 70 y; in absolute terms ≈ 30–35 g per meal for an 80-kg person vs ≈ 20 g young); MPS response = `min(1, dose/plateau)` (piecewise-linear; the flatter older slope is not quantifiable → ignored).
The ramp start (40 y) is PROPOSED — data are 22 vs 71 y, men only. Grade **B** (small acute tracer studies; long-term RCT translation is mixed).

#### 4.8.4 Hypertrophy trainability — coordinate 09
- Kosek 2006 [104] (16 wk, 3 d/wk; 25 older 60–75 y vs 24 young 20–35 y): mean type II fibre size **+23% (older) vs +32% (young)** (IIa +16% vs +25%); type I grew +18% only in young; growth was generally largest in young men (type I: +25% young men vs +4% older men).
- Meta-analysis, 49 studies/1,328 adults ≥50 y [105]: lean body mass +1.1 kg (0.9–1.2); higher-volume programmes more (β=0.05), **older participants less (β = −0.03 kg per year of age, P=0.01)**; heterogeneity I²=84%.
- Older-only meta-analyses: 28 RCTs (≥65 y) muscle size SMD 0.34 (0.16–0.52), fibre area 0.54 (0.24–0.84), leg lean mass NS; age not significant *within* the older cohort [107]; heavy vs moderate loads: hypertrophy small (μ 0.056–0.136), strength gains similar if repetitions sufficient [106].
Fibre-type responses differ by age and sex, but all groups (young and 65–75 y, both sexes) raised 1RM by 27–39% after 9 weeks of heavy training [102].
**Model:** `hypertrophyRateMult = 1 − 0.28·clamp((age − 40)/30, 0, 1)` → 0.72 at ≥70 (= 23/32 from Kosek), band 0.5–1.0. Grade **B/C** (one direct young-vs-old fibre trial, one meta-regression; men and women pooled).

#### 4.8.5 Deficits in older adults (lean and bone)
Villareal 2011 [111]: 107 obese adults ≥65 y, 1 y. Diet: weight **−9.7 ± 5.4 kg (−10%)**, lean **−3.2 ± 2.0 kg (−5%)** → lean = **33%** of weight lost; diet + exercise: −8.6 ± 3.8 kg (−9%), lean −1.8 ± 1.7 kg (−3%) → **21%**; exercise only: lean +1.3 kg (+2%).
Hip BMD −3% (diet) vs −1% (diet-exercise) (P<0.05). Physical Performance Test +12% (diet), +15% (exercise), +21% (both); peak VO2 +10%, +8%, +17%.
Systematic review of >10-kg losses: %FFM lost rises with degree of energy restriction (r²=0.31) and falls with exercise [112]. Typical adult diet-induced lean share ≈25% [53][129].
**PROPOSED:** `leanShareOfLossMult = 1.3` (age ≥65, diet-only), `×0.85` if resistance training present; bone: hip BMD −0.3% per 1% weight loss (diet-only), −0.1% with exercise (→19, 17). Grade **C** (single RCT; obese older adults).

#### 4.8.6 Aerobic capacity, glucose tolerance, hormones, other
- Peak VO2 [108] (810 adults 21–87 y, median 7.9-y follow-up): longitudinal decline **3–6% per decade in the 20s–30s, accelerating to >20% per decade in the 70s+**, larger in men from the 40s, regardless of activity. Cross-sectional summary ≈10%/decade; high-intensity training may reduce loss by ≤50% in young/middle-aged men but not older men [109].
  **Model (PROPOSED interpolation):** peak VO2 change −0.45 %/yr (25–40 y), −1.0 %/yr (40–60), −1.5 %/yr (60–70), −2.2 %/yr (>70). Grade **B** (endpoints), **C** (interpolation). Feeds 10.
- Glucose tolerance [110] (743 healthy BLSA participants 17–92 y): 2-h OGTT glucose 6.61 / 6.78 / 7.83 mmol/L (men young/middle/old) and 6.22 / 6.22 / 7.28 (women); the young→middle difference is explained by fatness/fitness/fat distribution; **age ≥60 still independently adds ≈ +1.1 mmol/L**. Age effects of sleep restriction + circadian disruption on postprandial glucose were the same in young and older adults [25]. Output offset in 04/06. Grade **B**.
- Testosterone (men): the authors of [14] state that normal aging lowers testosterone by roughly 1–2% per year (statement in the letter; independent primary source not retrieved) — grade **C**; feeds 12.
- Fasting tolerance and exercise recovery in older adults: no quantitative human data verified in this dossier → **no multiplier (D)**. Fasting BHB rises ~1%/yr with age in men [66].
- Bone: see 4.7 (menopause) and Villareal above; 19 owns bone.

### 4.9 ADOLESCENTS (<18 y) — hard exclusion (17)
One paragraph of rationale: (1) *Growth and development.* FFM/FM-adjusted expenditure is not at adult level until ≈20 y (break point 20.5 y, 95% CI 19.8–21.2; ≈148% of adult level at 1–2 y falling ~2.8%/yr) [60], so every adult equation in this app (RMR, TEE, Forbes partition, protein plateaus) is invalid for a maturing body;
(2) *Bone mass accrual.* Total-body BMC plateaus at ≈18 y in girls and ≈20 y in boys, with ≈39% of adult BMC accrued in the circumpubertal years; peak bone mass is reached by the end of the second or early third decade [113], so an energy-availability deficit can permanently lower peak bone mass;
(3) *Psychological risk.* Weight-focused messaging in teenagers risks eating disorders; guidance emphasises healthy lifestyle rather than weight [114]; (4) all data in this dossier (sleep, cycle, protein) are adult; pediatric BMI-percentile and growth-velocity logic is out of scope.
Also flag 18–24 y ("growth/bone maturation may be incomplete"): break point 20.5 y and bone plateau ≈18–20 y. Grade **B** for the physiological facts; the exclusion itself is a policy decision.

### 4.10 BODY-FAT LEVEL AS A MODERATOR — coordinate 01
- **Partition:** Forbes's relation makes the fat-free fraction of a weight change a function of initial fat; Hall extended it to macroscopic weight changes and re-expressed it via the P-ratio, matching human under/overfeeding data [115] (equations in 01 — use them; sex/age differences in composition then arise automatically).
- **Lean vs obese under starvation** [116]: prolonged starvation protein loss and protein's share of energy 2–3× lower in obese; urea share of urinary N 2× lower; protein contribution to glucose production ≈½; short-term (first days) hyperketonaemia typically **2× greater in lean**, glucose tolerance impaired more in lean; protein turnover and leucine oxidation rise in lean but not obese. Grade **B/C** (older metabolic-ward literature).
- **Leptin** ∝ body fat (r=0.85) [72]; sex multiplier in 4.4.6.
- **Obesity-related anabolic resistance** [117] (older men): 4.8.3; *no verified multiplier* → `obeseAnabolicMult = 1.0`, add flag for BMI ≥30 & age ≥55.
- **Extreme leanness** (case report, BF 4.5%): testosterone −75%, mood disturbance ×7 [46] (D) — safety flags via 17 at BF <10% (M) / <18% (F) (UI cut-offs PROPOSED).
**PROPOSED implementation:** early-starvation ketogenesis multiplier for fasting days 1–3: `ketoEarlyMult = 1 + clamp((BFhi − BF%)/(BFhi − BFlo), 0, 1)` with (BFhi, BFlo) = (30%, 12%) men, (40%, 22%) women, i.e. ×1.0 at obese levels rising linearly to ×2.0 at lean levels (anchor: lean ≈ 2× obese hyperketonaemia in the first days [116]). Note the sex term in 4.4.5 is kept separately: the body-fat term alone would predict *lower* ketonaemia in women at equal BMI, whereas observed data show women equal or higher [66][67], so both terms are retained with large uncertainty. No other body-fat moderators beyond 01. Grade **C**.

### 4.11 INDIVIDUAL VARIABILITY, GENETICS AND ETHNICITY

| Outcome | Data | Source |
|---|---|---|
| Weight gain from an identical 84,000-kcal overfeed (12 monozygotic male twin pairs, +1,000 kcal/d × 84 d) | mean 8.1 kg, range **4.3–13.3 kg** (CV ≈ 0.28 by range/4); ≈3× more variance between than within pairs (r≈0.5); visceral fat/regional distribution ≈6× (r≈0.7) | [118] |
| 12-month weight change on a lifestyle diet | DIETFITS (N=609): mean −5.3 kg (low-fat) vs −6.0 kg (low-carb); individual changes spanned ≈ **−30 to +10 kg** within each group; no genotype-pattern × diet or insulin-secretion × diet interaction | [120] (range from journal text via WebFetch) |
| Muscle hypertrophy (12 wk unilateral elbow-flexor RT, 585 adults) | CSA change **−2% to +59%**; 1RM 0 to +250%; CV 0.48 (M) / 0.51 (F) | [56] |
| VO2max trainability (481 sedentary adults, 20 wk) | mean +≈400 mL/min, from ≈0 to >1,000 mL/min; heritability up to 47%; 2.5× more variance between than within families | [119] |
| Energy expenditure | TEE residual ≥ ±20% after FFM, FM, sex, age (includes measurement error); adjusted RMR SD ≈ 8–10% (M 127, F 153 kcal/d) | [60][59] |
| Statistical caveat | observed response variance overstates *true* individual response (measurement error, within-subject variation); genetic contribution to exercise response is nonetheless well supported | [123][138] (abstracts read) |

**UI uncertainty bands (PROPOSED; 80% intervals ≈ ±1.28σ; D/C):** fat-mass change in a controlled deficit ±35% of predicted; lean-mass change ±50%; hypertrophy (CSA/lean gain) ±64% (CV 0.5);
RMR ±13% (σ=10%); TEE ±26% (σ=20%); weight gain in surplus ±36% (CV 0.28); free-living 12-month weight change ±(60–100)% (DIETFITS-like adherence spread). Bands are drawn *around* the mechanistic mean, and must be wider than sleep/stress/cycle moderator effects to avoid false precision.
**Ethnicity:** Asian populations have 3–5 pp higher body fat at the same BMI (≈3–4 BMI units lower for the same BF%) [121]; sex adds +10.4 pp in women at equal BMI [69]; BF%-from-BMI equations need sex, age and ethnic group (n=1,626, SEE 2.8–5.4 %fat) [124]. VAT: BMI underestimates visceral fat in Chinese, South Asian and Aboriginal Canadians vs Europeans (n=822); Chinese have progressively more VAT above 9.1 kg total fat; South Asians more VAT below ~37 kg fat; Aboriginal ≈ European [122].
**Decision:** ethnicity is used only for BF%-from-BMI and VAT/risk display (14); **no ethnicity multiplier on RMR/TEE/partition** (not tested in the sources read). Grade **B** (cross-sectional).

### 4.12 MEDICATIONS / CONDITIONS THAT INVALIDATE THE AVERAGE MODEL (disclaimer list; optional future toggles)

| Condition / drug | Why the average model fails | Verified quantitative anchors | Action |
|---|---|---|---|
| Thyroid disease / levothyroxine dosing | expenditure depends on thyroid hormone | 9 patients on chronic T4: REE/FFM **fell ≈15% as TSH rose 0.1 → 10 mU/L** [132] (hyperthyroid opposite; no source read) | "Average model not valid" banner; RMR band ±15% |
| PCOS | insulin resistance, androgens, appetite regulation | lifestyle: weight −1.68 kg (95% CI −2.66 to −0.70; 9 RCTs, low quality) [133]; REE difference vs non-PCOS inconsistent (preprint) [137] | banner; wider bands |
| Type 2 diabetes on insulin/sulfonylureas | hypoglycaemia with deficits, low-carb, fasting; weight-gain drugs | (no source read in this session — UNVERIFIED specifics) | soft-exclude ketogenic/fasting features; consult clinician |
| Type 1 diabetes | ketoacidosis/hypoglycaemia risk | — | hard exclusion (17) |
| **SGLT2 inhibitors** | glycosuria shifts fuel use to fat oxidation and ketogenesis | empagliflozin: BHB 246 → 561 µmol/L after 4 wk in T2D; ↑ lipolysis, lipid oxidation, endogenous glucose production [134] (ketoacidosis risk with low-carb/fasting: regulatory warnings UNVERIFIED here) | exclude from ketogenic/fasting simulation |
| **GLP-1 RA / GIP-GLP-1 (semaglutide, tirzepatide, liraglutide)** | appetite suppression replaces the hunger→intake pathway | STEP 1 (N=1,961; sema 2.4 mg, 68 wk): **−14.9% vs −2.4%** [125]. SURMOUNT-1 (N=2,539; tirzepatide 72 wk): −15.0 / −19.5 / −20.9% vs −3.1% [126]. Sema 1.0 mg 12 wk (N=30): ad-libitum intake **−24%** (−3,036 kJ ≈ −726 kcal), RMR/LBM unchanged, −5.0 kg mostly fat [131]. Lean share of weight lost: SURMOUNT-1 DXA substudy (n=160) weight −21.3%, fat −33.9%, lean −10.9% (placebo −5.3/−8.2/−2.6) ≈ **75% fat/25% lean in both arms** [127]; 22-RCT meta ≈25% [129]; 35-study review median **28.3% (IQR 15.9–39.9)** of weight loss from muscle-based indices [130]; range 15% to 40–60% across studies [128]. STEP 1 DXA sub-study numbers: UNVERIFIED (not retrievable) | Not modelled in v1. If a toggle is added: intake-drive ×0.75 (band 0.6–0.9), lean share ×1.0–1.15, RMR/kg LBM unchanged; hunger outputs invalid |
| Glucocorticoids | catabolic, central fat, insulin resistance | (no verified numbers in this session) | banner: model invalid |
| **Testosterone therapy / anabolic steroids** | hypertrophy and partition far outside physiological range | 43 men, 600 mg testosterone enanthate/wk × 10 wk: FFM +6.1 kg with training; quadriceps CSA +1,174 mm² (training) vs +607 (no training) vs −131 (placebo) [135] | banner/exclude from hypertrophy prediction |
| Antipsychotics, mirtazapine, valproate, beta-blockers, diuretics, stimulants, lithium | weight, appetite, heart-rate and electrolyte effects | none verified | checklist + banner |
| Eating-disorder history, CKD (eGFR<30), liver disease, cancer/cachexia, bariatric surgery | out of scope of average model | PROT-AGE kidney exception [103] | hard exclusion / banner (17) |

### 4.13 PARAMETER TABLE (non-sleep moderators) and time dynamics

| Symbol | Value | Unit | Uncertainty | Source | Time dynamics / notes |
|---|---|---|---|---|---|
| `t½_caffeine` | 5.4 (OC 7.9; smoker ×0.56) | h | individual range wide (UNVERIFIED); genetic ≈89% of AUC variance | [33][34][35] | first-order; residual at bedtime drives sleep loss |
| `R*` (no-loss residual) | 37 | mg caffeine | 34–40 | [31] (derived) | instantaneous at bedtime |
| `k_TST,caffeine` | 0.40 | min per mg above R* | 0.25–0.55 | [31][32] (PROPOSED FIT) | cap 120 min |
| `ageRmrMult` slope | −0.007 | per year after 63 y | −0.6 to −0.8 %/yr; break-point 60–66 y | [60] | static function of age |
| `proteinPlateau(age)` | 0.24 → 0.40 (linear 40 → 70 y) | g/kg per meal | ±0.19 (old), ±0.06 (young) | [100] | static |
| `hypertrophyRateMult(age)` | 1 → 0.72 (linear 40 → 70 y) | × | 0.5–1.0 | [104][105] | static |
| `leanShareOfLossMult` (≥65 y) | 1.3 (0.85 with RT) | × | 1.0–1.6 | [111] | over months of deficit |
| `muscleDrift` | 0.37–0.47 %/yr (age 50) → 0.64–0.98 %/yr (age 75) | of muscle mass per yr | cross-sectional vs longitudinal | [99] | multi-year only |
| `VO2max decline` | 0.45 / 1.0 / 1.5 / 2.2 | %/yr (25–40 / 40–60 / 60–70 / >70 y) | ±30% | [108][109] (interpolated) | static baseline adjustment |
| `glucose2h_age` | +1.1 | mmol/L after 60 y | ±0.4 | [110] | static |
| `fatOxPerKgFfmMult` (women) | 1.12 | × | 1.05–1.20 | [58] | exercise-only |
| `leptinPerKgFatMult` (women) | 1.5 | × | 1.2–2.0 | [64] | steady-state; dynamics in 12 |
| `ketoneProdMult` women / OC / postmenopausal | 1.10 / 1.45 / 0.89 | × | 1.0–1.4 (women) | [66][67] | PROPOSED; static |
| `ketoEarlyMult` (lean) | 1.0 → 2.0 | × | ±0.5 | [116] | fasting days 1–3 only |
| `EA_threshold` (women) | 30 | kcal/kg LBM/d | ±5 | [68] | 5-day exposure in early follicular phase |
| `lutealHunger` | +5 | VAS points | 0–10 | [73][75] (PROPOSED) | ≈days 15–28 (L=28); square wave |
| `lutealEI` | +168 | kcal/d | +50…+300 | [73] | ad-lib mode only |
| `scaleNoise_cycle` | 0.3 | ± kg (display) | 0–0.5; sign inconsistent | [78][79][80] | display band only |
| `fatDriftExtra` (transition) | +0.20 | kg/yr | ±50% | [92] | ≈3.5 y window (−2 … +1.5 y around FMP) |
| `leanDriftExtra` (transition) | −0.12 | kg/yr | ±50% | [92] | same window |
| `sleepingEEExtra` (transition, optional) | −0.65 | %/yr | grade C | [91] | default OFF |
| `bone loss` LS / FN (transmenopause) | 2.5 / 1.9 | %/yr | ±30% | [96] | ≈3 y window |
| `HRT` abdominal fat / HOMA-IR | ×0.93 / ×0.87 | × | CI −11.8…−1.9 % (fat) | [95] | steady state after ≥8 wk trials |
| `stressEI` | +0.02 | fraction of maintenance | 0–0.04 | [47] (PROPOSED) | only "high sustained" stress |
| `stressAdherenceSD` | ×1.5 | × | 1.0–2.0 | (PROPOSED) | — |
| UI bands (80%) | ±35 / ±50 / ±64 / ±13 / ±26 / ±36 | % (fat change / lean change / hypertrophy / RMR / TEE / surplus weight gain) | — | [56][59][60][118] (PROPOSED) | scale with horizon |

---------------------------------------------------------------------------------------------------

## 5. Interactions with other subsystems

| Module | Gets from this dossier | Gives to this dossier |
|---|---|---|
| 01 body-weight ODE | `pRatioShift` (sleep), `leanShareOfLossMult` (older), VAT-share offsets; menopause fat/lean drift; age drift | P-ratio baseline (Forbes/Hall), fat mass/FFM state, deficit fraction |
| 02 RMR/TEF/NEAT | `ageRmrMult`, `teeMult`/`rmrMult` (shift work), no sex term with FFM+FM equations | FFM, FM, energy balance |
| 03 protein/MPS | `mpsMult` (sleep), `proteinPlateauGPerKg(age)`, `hypertrophyRateMult` handoff | per-meal protein doses/timing, RT sessions |
| 04 carbohydrate/insulin | `siMult` (sleep), age 2-h glucose offset | glycaemic exposure, evening carbohydrate (sleep-onset heuristic) |
| 05 ketosis | `ketoneProdMult` (sex/OC/menopause), `ketoEarlyMult` (leanness) | carbohydrate intake (sleep architecture note) |
| 07 fasting/meal timing/circadian | shift-work flag, late-night intake profile | eating-window clock times, last-meal-to-bed interval |
| 09 hypertrophy | age multiplier; sex = 1.0; OC = 1.0 (wide band) | training volume/timing (HIIE offsets MPS loss, grade C) |
| 10 cardio/VO2max | age decline function; strength/power/endurance sleep multipliers; fat-oxidation ×1.12 (women) | exercise timing (sleep heuristic) |
| 12 hormones/appetite | hunger VAS offsets (sleep, luteal, stress), testosterone (men, sleep, age), leptin ×1.5/kg fat (women), EA threshold 30 kcal/kg LBM | leptin/ghrelin/cortisol dynamics (do not double count sleep effects) |
| 13 diet transitions | scale-noise bands (cycle) | glycogen/water transients |
| 14 anthropometrics | ethnicity/sex BF%-from-BMI shifts, VAT sex/menopause offsets | avatar/BF% inputs |
| 15 fibre/hydration/substances | caffeine PK (`t½` by OC/smoking), alcohol-sleep flags | caffeine/alcohol intake times and amounts |
| 17 safety | exclusions (<18, pregnancy/lactation), EA threshold, older-adult/menopause bone flags, medication checklist | limits |
| 18 planner | sleep as constraint (≥7 h in cutting phases), adherence-risk term, caffeine cut-off rules | candidate regimes |
| 19 outcomes | bone loss offsets, performance multipliers | outcome definitions |

Double-counting rules: (i) sleep effects on hunger enter **only** through `hungerVasOffset`/`unplannedIntakeKcal`, not via leptin/ghrelin state changes; (ii) menopause/age composition drift is applied to *state* (FM, FFM) not to RMR;
(iii) sex differences in composition are carried by FFM/FM, not by additional RMR/partition terms.

**Reconciliation with sibling dossiers** (read from their files on 2026-09-30 ≈14:15 while they were still being edited — re-check before merging):
- 02: `f_age = 1 − 0.007·(A − 63)` for A>63 — identical to `ageRmrMult`.
- 09: `f_age = 1 − 0.0086·(age − 40)`, floor 0.6 (→0.74 at 70 y) vs this file's 0.72 at ≥70 y (ramp then flat). 09 owns hypertrophy; use its version (difference ≈3% at 70 y).
- 03: per-meal plateau older 0.40 g/kg (Moore) — same anchor; 03 owns dose–response shape.
- 12: sleep enters as `D_sleep = 100·clamp(7 − sleep_h, 0, 4)` kcal (≈ this file's 0.04/h × 2,500 kcal, but reference sleep 7.0 h vs 7.5 h here — **pick one global `h_ref`**), ghrelin ×(1 + 0.07·max(0, 7 − h)), cortisol +0.04/h and
  testosterone `F_sleep = 1 − 0.025·clamp(8 − h, 0, 5)` (−7.5% at 5 h vs −12% here; Leproult's −10 to −13% at 5 h × 8 nights [14] favours the steeper slope). **Apply the sleep→intake effect in only one module**, and 12's leptin uses a sex-specific `L0 = a_sex·FM^b_sex`, so do **not** also apply this file's `leptinPerKgFatMult`.
- 15: adopts this file's caffeine PK (`t½` 5.4 h, ×1.47 OC, ×0.56 smoker; `R*`≈37 mg; 0.40 min/mg) — 16 owns the equations, 15 supplies dose/time.
- 13: menstrual water term `W_mc` 0–0.5 kg is consistent with the ±0.3 kg display band here (display-only, sign-agnostic).
- 17: `HC-P1` age ≥18 hard block and EA tiers (30–45 "reduced"; <30 for >14 d "caution") are consistent with 4.4.8/4.9.

---------------------------------------------------------------------------------------------------

## 6. Output metrics for the UI

| Metric | Unit | Good direction | Computation | Grade |
|---|---|---|---|---|
| Sleep-debt index | h | ↓ | `dS` (4.1.1) | B |
| Sleep-driven hunger | VAS points | ↓ | `4·dF` | A/B |
| Insulin-sensitivity change from sleep | % vs rested | ↑ | `(siMult − 1)·100` | A/B |
| Anabolic (MPS) capacity from sleep | % of rested | ↑ | `mpsMult·100` | B |
| Testosterone index (men) | % of baseline | ↑ | `testosteroneMult·100 × age term` | B/C |
| Fat-free share of weight lost | % | ↓ in deficit | from P-ratio incl. `pRatioShift` | C |
| Predicted caffeine sleep loss | min | ↓ | 4.2.1 | B/C |
| Alcohol REM-disruption flag | flag | none | dose ≥ 0.25 g/kg within 4 h of bed | A (dir.) |
| Sleep-quality score | 0–100 | ↑ | 4.2.6 heuristic (UI only) | D |
| Age-adjusted RMR factor | % of FFM/FM-predicted | info | `ageRmrMult·100` | A |
| Per-meal protein plateau | g/kg (and g) | info | 4.8.3 | B |
| Hypertrophy rate factor | × | info | 4.8.4 | B/C |
| Menopause status / VAT-share trend | class | ↓ VAT | 4.7 | B/C |
| Cycle-phase note & scale-noise band | phase, ±kg | info | 4.5 (toggle) | C/D |
| Prediction-band width for chosen outputs | % | ↓ | 4.11 | C |

Planner-usable derived goals: "keep lean-mass loss share ≤ X" (sleep, age-aware), "sleep-compatible regime" (sleep ≥7 h, caffeine cut-off ≥ 8.8 h per 107 mg, no alcohol ≤4 h before bed), "maximise insulin sensitivity" (sleep term), "avoid low-EA weeks" (women).

---------------------------------------------------------------------------------------------------

## 7. Validation targets

Tolerances are for the *moderator effect* (difference between conditions), because absolute outcomes depend on other modules.

| # | Study (subjects, intervention, duration) | Measured outcome | Engine test (tolerance) |
|---|---|---|---|
| V1 | Nedeltcheva 2010 [1]: 10 adults (3 F), age 41, BMI 27.4; 14 d at 90% RMR (≈1,450 kcal/d, TEE ≈2,137), TIB 8.5 h (actual 7.4 h) vs 5.5 h (5.2 h) | fat lost 1.4 vs 0.6 kg; FFM lost 1.5 vs 2.4 kg; fat share 56% vs 25%; hunger +0.8 cm VAS | central `k_P=0.04` (ΔP=+0.088 on P=0.093) → fat share of loss 48% → 30% (≈ −18 pp); upper band edge `k_P=0.08` → 21% (≈ −28 pp) reproduces the measured 48% → 20% (56% → 25% as reported); lower edge = no effect. Direction must match; hunger ≈ +9 VAS points if the reported +0.8 cm is on a 10-cm VAS (scale length not verified), tolerance ±100% |
| V2 | Wang 2018 [2]: 36 adults, BMI 31–35, 8 wk at 95% RMR, net −24 min/day sleep (5 nights −57 min) | weight −3.3 vs −3.2 kg; fat −1.9 vs −1.8; lean −0.71 vs −0.72 kg (no absolute differences); fat-share median 82.7% vs 58.4% | lower band edge (zero effect) must contain the absolute null; small dS (0.4): central −8 pp, upper edge −15 pp on the fat share of loss; the median-ratio gap (−24 pp) is *not* used for calibration because that ratio is unstable (IQR −13% to +74%) |
| V3 | Tasali 2022 [7]: 80 adults, BMI 25–29.9, +1.2 h/night for 2 wk | intake −270 kcal/d (−393, −147); −162 kcal/d per h (−247, −78); weight −0.87 kg vs control | ad-lib mode: predicted −78 to −187 kcal/d (k 0.025–0.06 × 2,600 kcal × 1.2 h; central −125): the upper edge must reach ≥ −147; weight difference vs control ≈ −0.15 to −0.35 kg over 14 d from energy balance alone (observed −0.87 kg includes a +0.39 kg drift in controls and water/glycogen effects; accept correct sign and order of magnitude) |
| V4 | Buxton 2010 [9]; Depner 2019 [21]; Broussard 2012 [10]: 5 h × 7–9 nights; 4.5 h × 4 nights | Si −20 ± 24% (IVGTT), −11% (clamp); −13%; adipocyte AUC −30% | `siMult` at night 7 of 5 h (d=2.5, dS=2.26): 0.84 (band 0.77–0.93; measured 0.80–0.89); after 2 recovery nights of 10 h ≈ 67% of the deficit remains (dS 2.26 → 1.52), consistent with Si not being restored [22] |
| V5 | Leproult 2011 [14]; Saner 2020 [12]; Lamon 2021 [13] | T −10 to −13% (5 h × 8 nights); MyoPS −19% (4 h TIB × 5 nights); acute MPS −18%, T −24% | `testosteroneMult` ≈0.87–0.88 at night 7–8 of 5 h; `mpsMult` 0.85 at night 5 of 4 h TIB (0.815 at steady state; measured 0.81); total deprivation caps −20 to −25% (±5 pp) |
| V6 | Al Khatib 2017 [3]; Brondel 2010 [17]; Zhu 2019 [4]; Covassin 2022 [15] | +385 (252–517), +559 ± 617, +253, +308 (59–557) kcal/d | ad-lib intake for dF=3.5 at 2,400 kcal: 336 kcal (band 210–500) — must overlap all four intervals |
| V7 | Pontzer 2021 [60] | adjusted TEE −0.7%/yr after ~63 y; ~26% lower in nineties; stable 20–60 | `ageRmrMult(75)=0.916`, `(90)=0.81` (paper: ≈0.74 for the nineties, so the linear rule overshoots by ~7 pp; tolerance ±8 pp); exactly 1.0 for 20–63 y |
| V8 | Moore 2015 [100]; Kosek 2006 [104]; Peterson 2011 [105] | MPS plateau 0.40 vs 0.24 g/kg; type II fibre growth +23% vs +32%; LBM +1.1 kg, −0.03 kg/yr of age | plateau(70)=0.40, plateau(22)=0.24; hypertrophy ratio 0.72 ± 0.10 |
| V9 | PREVIEW [53] & Millward [54] (contested) | FFM share men 16% vs women 31% (PREVIEW); men 3× FFM loss at 2 mo, P 0.052 vs 0.029 (Millward) | engine (Forbes/Hall + no sex term) must give a sex difference in the FFM share of early loss that lies between the two reports (PREVIEW: women ≈ +15 pp; Millward: men higher); accept an absolute difference ≤ 15 pp; do not tune to either alone |
| V10 | SWAN [92]; Villareal [111] | fat +1.7%/yr vs +1.0%/yr; lean −0.2%/yr vs +0.2%/yr over MT; older obese diet: lean 33% of loss (21% with exercise), hip BMD −3% vs −1% | drift offsets reproduce ±30%; `leanShareOfLossMult` 1.3 → 0.33 from 0.25; ×0.85 with RT → 0.28 (measured 0.21: tolerance ±0.07) |
| V11 | Gardiner 2023 [31]; Drake 2013 [32] | no TST loss if 107 mg ≥ 8.8 h or 217.5 mg ≥ 13.2 h before bed; 400 mg at 6 h disrupts | residual 34/40 mg → TSTloss ≈ 0 (≤ 2 min); 400 mg at 6 h → ≈ −59 min (±30 min) |
| V12 | Tucker 2025 [73]; Benton 2020 [74]; cycle scale studies [78][79][80] | luteal +168 kcal/d; RMR ES 0.33; weight ±0.3 kg with inconsistent sign | luteal ad-lib intake +168 (band 50–300); no deterministic weight curve; scale band ±0.3 kg |

---------------------------------------------------------------------------------------------------

## 8. Myths / contested claims

1. **"Short sleep slows your metabolism."** Measured TEE/RMR are unchanged or ≈+5% with short sleep; the harm is *intake* (+≈250–385 kcal/d), insulin sensitivity and (in deficit) possibly composition [3][4][11][15][18][20].
2. **"Sleep restriction halves fat loss (Nedeltcheva)."** One N=10 crossover; a second RCT (N=36) found no absolute difference in fat or lean loss, only a lower *proportion* metric with an IQR spanning −13% to 74% and baseline group imbalance [1][2]. Treat as plausible, unreplicated at that magnitude.
3. **"You can catch up on sleep at the weekend."** Weekend recovery did not prevent Si loss (−9 to −27%) [21]; 2 recovery nights did not restore Si/disposition index [22].
4. **"Water retention in the luteal phase hides fat loss by kg."** Objective studies disagree on sign and average ≲0.5 kg; plasma volume is highest in the early follicular phase; self-reported bloating peaks on day 1 of flow and is unrelated to estradiol/progesterone [76][77][78][79][80]. (Note: White 2011 is about self-reported symptoms, not scale weight.)
5. **"Women should periodise diet/training by cycle phase."** Training adaptation, performance and substrate use show no reliable phase effects; only intake (+≈168 kcal/d luteal) has meta-analytic support, with methodological caveats [73][83][84][86].
6. **"Stress hormones make you fat / retain water."** Longitudinal stress–adiposity r=0.014; hair-cortisol links are cross-sectional; no human evidence located for stress-induced water retention [48][49].
7. **"Women build muscle slower."** Relative hypertrophy is equal (ES difference 0.07 ± 0.06) [55]; absolute gain scales with baseline muscle mass.
8. **"Metabolism collapses at 30/40/menopause."** FFM/FM-adjusted expenditure is flat 20–60 y then −0.7%/yr [60]; menopause adds distribution shift (VAT ↑, leg fat ↓) more than quantity, and most gain is age-related [92][93].
9. **"The 1995 menopause study shows RMR −100 kcal/d."** That paper (Poehlman) is **retracted** [98].
10. **"Older adults cannot build muscle."** They can, at ≈0.7× the young fibre-growth rate and needing ≈0.4 g/kg per meal for max MPS [100][104].
11. **"Alcohol helps sleep."** REM is disrupted from ≈2 drinks; sleep-onset shortening occurs only at ≈5 drinks and worsens later REM [36].
12. **"Caffeine half-life is 5–6 h so afternoon coffee is harmless."** After 8.8 h ≈ one third of a 107-mg dose remains (≈34 mg), the residual associated with no TST loss; 400 mg at 6 h disrupts sleep [31][32]; combined OC users clear caffeine ≈1.5× slower [33].
13. **"Keto causes insomnia."** 48 h of very-low-carbohydrate intake raised SWS (13.9 → 17.7%) and lowered REM; long-term data lacking [39][40].
14. **"Genetics tells you which diet works."** DIETFITS: no genotype-pattern × diet or insulin-secretion × diet interaction on 12-month weight loss [120].

---------------------------------------------------------------------------------------------------

## 9. Safety bounds relevant to this topic

- **Hard exclusions:** age <18 (4.9); pregnancy; lactation (energy demand ≈454–626 kcal/d, 4.6); type 1 diabetes; eating-disorder history; eGFR <30 (PROT-AGE exception [103]) — final policy in 17.
- **Women's reproductive axis:** warn when planned energy availability <30 kcal/kg LBM/d (LH pulsatility disrupted in ≥5-day exposure) [68]; the study's non-disrupting reference levels were 30 and 45 kcal/kg LBM/d; the planner target is set in 17; applies especially with high exercise loads.
- **Older adults (≥65 y):** diet-only weight loss cost 33% lean share and hip BMD −3% per ~10% loss [111]; planner must (a) require resistance training, (b) set protein ≥1.2 g/kg/d [103], (c) cap loss rate (numeric cap → 17, UNVERIFIED here).
- **Menopause transition:** bone loss 2.5%/yr at LS, 1.9%/yr at FN for ≈3 y [96] — no aggressive deficit without resistance/impact exercise flag; HRT is a medical decision (no advice).
- **Sleep:** simulator may show short-sleep plans but must warn when sleep <6 h in a deficit (fat-loss quality, hunger, adherence) [1][30] and when <5 h for >3 nights (insulin sensitivity −15 to −25%) [9][10][21]; never prescribe sleep restriction.
- **Stimulants/alcohol:** show caffeine cut-off and alcohol-within-4-h-of-bed warnings; no numeric daily caffeine safety limit is asserted here (15/17).
- **Medications:** SGLT2 inhibitors (ketogenesis ↑), insulin/sulfonylureas (hypoglycaemia), thyroid disease, GLP-1 RA, glucocorticoids, TRT/anabolic steroids invalidate the average model (4.12): banner + exclusion from ketogenic/fasting features where noted.
- **Extreme leanness:** flags at BF <10% (M)/<18% (F) (UI cut-offs; thresholds owned by 17) given testosterone −75% and mood ×7 in a contest-prep case [46].

---------------------------------------------------------------------------------------------------

## 10. Open questions / weakest assumptions

1. **Sleep → lean loss in deficit** rests on N=10 + N=36 with conflicting endpoints; the shrunken `k_P=0.04/h` is a judgement call. A third RCT is the highest-value missing evidence.
2. **Sex balance in sleep science:** Buxton/Leproult/Saner were all-male; Craven meta 89% male; Broussard 6/7 male; Covassin 9/12 male; sex effects inconsistent (Markwald/Spaeth/Depner). Women's testosterone/MPS/Si responses are largely unknown.
3. **Time constants** (τ_F, τ_S) are inferred from a handful of fixed-duration protocols; recovery kinetics after chronic restriction (weeks) are unmeasured.
4. **Real-life vs lab:** lab restriction (4–5 h) is extreme; Tasali's slope (−162 kcal/d/h) exceeds the lab-derived 100 kcal/d/h; unclear if effects saturate below ≈4 h or in habitual short sleepers.
5. **Cycle effects:** conflicting sign for scale weight; RMR effect not convertible to kcal; intake effect from self-reported diaries; insulin-sensitivity phase effect not established in non-diabetic women; hormonal-contraceptive hypertrophy effect unresolved (one RCT +, one review conflicting).
6. **Menopause vs age:** SWAN averages include behavioural change (activity ↓ 2 y before FMP); RMR effect (−2.6 pp over 4 y, n=34) is weak; the only "RMR −100 kcal/d" paper is retracted.
7. **Age × hypertrophy:** ramp start at 40 y and the 0.72 multiplier come from a single trial's fibre data + a meta-regression; men vs women differ within older cohorts.
8. **Anabolic resistance ramp** (40 → 70 y) is an interpolation between 22-y and 71-y male data; women and middle age unmeasured.
9. **Sex differences in FFM share of weight loss** contradict between studies (PREVIEW vs Millward); no adjudication possible without body-composition method harmonisation.
10. **Stress:** effect size on intake is tiny and heterogeneous; assumed between-person intake SD (500–600 kcal) is UNVERIFIED.
11. **Ketone sex/OC multipliers** are extrapolations from fasting/postprandial BHB associations; no controlled multi-day fasting by sex.
12. **UI bands** (±35/50/64/13/26%) are pragmatic composites of CVs from short trials; true individual variance is smaller than observed CVs but heritable components are real [118][119][123][138].
13. **Not searched/verified here:** essential-fat floors; STEP 1 DXA numbers; glucocorticoid and insulin/sulfonylurea effect sizes; older-adult fasting tolerance; exercise-recovery ageing multipliers; hyperthyroid RMR effects.

---------------------------------------------------------------------------------------------------

## 11. References

Source-access note: PubMed web pages were cookie-walled for the fetch tool, so abstracts were read through NCBI E-utilities (efetch/esummary) and, where noted, PMC full-text XML or publisher/PMC pages fetched with WebFetch.
All URLs are `https://pubmed.ncbi.nlm.nih.gov/<PMID>/` unless stated. "FT" = full text (or full results table) read; otherwise abstract only.

**Sleep**
1. Nedeltcheva AV, Kilkus JM, Imperial J, Schoeller DA, Penev PD. Insufficient sleep undermines dietary efforts to reduce adiposity. Ann Intern Med 2010;153:435-41. PMID 20921542; DOI 10.7326/0003-4819-153-7-201010050-00006; PMC2951287 (FT).
2. Wang X, Sparks JR, Bowyer KP, Youngstedt SD. Influence of sleep restriction on weight loss outcomes associated with caloric restriction. Sleep 2018;41(5). PMID 29438540; DOI 10.1093/sleep/zsy027; PMC8591680 (results table read via https://pmc.ncbi.nlm.nih.gov/articles/PMC8591680/).
3. Al Khatib HK, Harding SV, Darzi J, Pot GK. The effects of partial sleep deprivation on energy balance: a systematic review and meta-analysis. Eur J Clin Nutr 2017;71:614-24. PMID 27804960; DOI 10.1038/ejcn.2016.201.
4. Zhu B, Shi C, Park CG, Zhao X, Reutrakul S. Effects of sleep restriction on metabolism-related parameters in healthy adults: a comprehensive review and meta-analysis of randomized controlled trials. Sleep Med Rev 2019;45:18-30. PMID 30870662; DOI 10.1016/j.smrv.2019.02.002.
5. González-Ortiz A, López-Bautista F, Valencia-Flores M, Espinosa Cuevas Á. Partial sleep deprivation on dietary energy intake in healthy population: a systematic review and meta-analysis. Nutr Hosp 2020;37:1052-60. PMID 32960623; DOI 10.20960/nh.03108.
6. Capers PL, Fobian AD, Kaiser KA, Borah R, Allison DB. A systematic review and meta-analysis of randomized controlled trials of the impact of sleep duration on adiposity and components of energy balance. Obes Rev 2015;16:771-82. PMID 26098388; DOI 10.1111/obr.12296.
7. Tasali E, Wroblewski K, Kahn E, Kilkus J, Schoeller DA. Effect of sleep extension on objectively assessed energy intake among adults with overweight in real-life settings: a randomized clinical trial. JAMA Intern Med 2022;182:365-74. PMID 35129580; DOI 10.1001/jamainternmed.2021.8098; PMC8822469 (FT).
8. Spiegel K, Tasali E, Penev P, Van Cauter E. Sleep curtailment in healthy young men is associated with decreased leptin levels, elevated ghrelin levels, and increased hunger and appetite. Ann Intern Med 2004;141:846-50. PMID 15583226; DOI 10.7326/0003-4819-141-11-200412070-00008.
9. Buxton OM, Pavlova M, Reid EW, Wang W, Simonson DC, Adler GK. Sleep restriction for 1 week reduces insulin sensitivity in healthy men. Diabetes 2010;59:2126-33. PMID 20585000; DOI 10.2337/db09-0699.
10. Broussard JL, Ehrmann DA, Van Cauter E, Tasali E, Brady MJ. Impaired insulin signaling in human adipocytes after experimental sleep restriction: a randomized, crossover study. Ann Intern Med 2012;157:549-57. PMID 23070488; DOI 10.7326/0003-4819-157-8-201210160-00005.
11. Markwald RR, Melanson EL, Smith MR, et al. Impact of insufficient sleep on total daily energy expenditure, food intake, and weight gain. Proc Natl Acad Sci USA 2013;110:5695-700. PMID 23479616; DOI 10.1073/pnas.1216951110.
12. Saner NJ, Lee MJ, Pitchford NW, et al. The effect of sleep restriction, with or without high-intensity interval exercise, on myofibrillar protein synthesis in healthy young men. J Physiol 2020;598:1523-36. PMID 32078168; DOI 10.1113/JP278828.
13. Lamon S, Morabito A, Arentson-Lantz E, et al. The effect of acute sleep deprivation on skeletal muscle protein synthesis and the hormonal environment. Physiol Rep 2021;9:e14660. PMID 33400856; DOI 10.14814/phy2.14660.
14. Leproult R, Van Cauter E. Effect of 1 week of sleep restriction on testosterone levels in young healthy men. JAMA 2011;305:2173-4. PMID 21632481; DOI 10.1001/jama.2011.710; PMC4445839 (FT).
15. Covassin N, Singh P, McCrady-Spitzer SK, et al. Effects of experimental sleep restriction on energy intake, energy expenditure, and visceral obesity. J Am Coll Cardiol 2022;79:1254-65. PMID 35361348; DOI 10.1016/j.jacc.2022.01.038; PMC9187217 (FT).
16. Nedeltcheva AV, Kilkus JM, Imperial J, et al. Sleep curtailment is accompanied by increased intake of calories from snacks. Am J Clin Nutr 2009;89:126-33. PMID 19056602; DOI 10.3945/ajcn.2008.26574.
17. Brondel L, Romer MA, Nougues PM, Touyarou P, Davenne D. Acute partial sleep deprivation increases food intake in healthy men. Am J Clin Nutr 2010;91:1550-9. PMID 20357041; DOI 10.3945/ajcn.2009.28523.
18. Calvin AD, Carter RE, Adachi T, et al. Effects of experimental sleep restriction on caloric intake and activity energy expenditure. Chest 2013;144:79-86. PMID 23392199; DOI 10.1378/chest.12-2829.
19. Spaeth AM, Dinges DF, Goel N. Effects of experimental sleep restriction on weight gain, caloric intake, and meal timing in healthy adults. Sleep 2013;36:981-90. PMID 23814334; DOI 10.5665/sleep.2792.
20. Shechter A, Rising R, Wolfe S, Albu JB, St-Onge MP. Postprandial thermogenesis and substrate oxidation are unaffected by sleep restriction. Int J Obes 2014;38:1153-8. PMID 24352294; DOI 10.1038/ijo.2013.239.
21. Depner CM, Melanson EL, Eckel RH, et al. Ad libitum weekend recovery sleep fails to prevent metabolic dysregulation during a repeating pattern of insufficient sleep and weekend recovery sleep. Curr Biol 2019;29:957-67. PMID 30827911; DOI 10.1016/j.cub.2019.01.069.
22. Ness KM, Strayer SM, Nahmod NG, et al. Two nights of recovery sleep restores the dynamic lipemic response, but not the reduction of insulin sensitivity, induced by five nights of sleep restriction. Am J Physiol Regul Integr Comp Physiol 2019;316:R697-R703. PMID 30892916; DOI 10.1152/ajpregu.00336.2018.
23. Robertson MD, Russell-Jones D, Umpleby AM, Dijk DJ. Effects of three weeks of mild sleep restriction implemented in the home environment on multiple metabolic and endocrine markers in healthy young men. Metabolism 2013;62:204-11. PMID 22985906; DOI 10.1016/j.metabol.2012.07.016.
24. Craven J, McCartney D, Desbrow B, et al. Effects of acute sleep loss on physical performance: a systematic and meta-analytical review. Sports Med 2022;52:2669-90. PMID 35708888; DOI 10.1007/s40279-022-01706-y; PMC9584849 (pooled results read via https://pmc.ncbi.nlm.nih.gov/articles/PMC9584849/).
25. Buxton OM, Cain SW, O'Connor SP, et al. Adverse metabolic consequences in humans of prolonged sleep restriction combined with circadian disruption. Sci Transl Med 2012;4:129ra43. PMID 22496545; DOI 10.1126/scitranslmed.3003200; PMC3678519 (FT).
26. Scheer FAJL, Hilton MF, Mantzoros CS, Shea SA. Adverse metabolic and cardiovascular consequences of circadian misalignment. Proc Natl Acad Sci USA 2009;106:4453-8. PMID 19255424; DOI 10.1073/pnas.0808180106.
27. McHill AW, Melanson EL, Higgins J, et al. Impact of circadian misalignment on energy metabolism during simulated nightshift work. Proc Natl Acad Sci USA 2014;111:17302-7. PMID 25404342; DOI 10.1073/pnas.1412021111.
28. Tasali E, Leproult R, Ehrmann DA, Van Cauter E. Slow-wave sleep and the risk of type 2 diabetes in humans. Proc Natl Acad Sci USA 2008;105:1044-9. PMID 18172212; DOI 10.1073/pnas.0706446105.
29. Cappuccio FP, Taggart FM, Kandala NB, et al. Meta-analysis of short sleep duration and obesity in children and adults. Sleep 2008;31:619-26. PMID 18517032; DOI 10.1093/sleep/31.5.619 (cross-sectional: adults OR 1.55, 95% CI 1.43–1.68; −0.35 BMI units per h of sleep; cited for context only).
30. Kline CE, Conroy MB, Brooks MM, Kriska AM, Barinas-Mitchell EJ. Sleep duration and quality as predictors of weight loss and adherence during a behavioral weight loss intervention. Behav Sleep Med 2026;24(4):463-76. PMID 41889166; DOI 10.1080/15402002.2026.2648510.

**Diet → sleep**
31. Gardiner C, Weakley J, Burke LM, et al. The effect of caffeine on subsequent sleep: a systematic review and meta-analysis. Sleep Med Rev 2023;69:101764. PMID 36870101; DOI 10.1016/j.smrv.2023.101764.
32. Drake C, Roehrs T, Shambroom J, Roth T. Caffeine effects on sleep taken 0, 3, or 6 hours before going to bed. J Clin Sleep Med 2013;9:1195-200. PMID 24235903; DOI 10.5664/jcsm.3170; PMC3805807.
33. Abernethy DR, Todd EL. Impairment of caffeine clearance by chronic use of low-dose oestrogen-containing oral contraceptives. Eur J Clin Pharmacol 1985;28:425-8. PMID 4029248; DOI 10.1007/BF00544361.
34. Joeres R, Klinker H, Heusler H, et al. Influence of smoking on caffeine elimination in healthy volunteers and in patients with alcoholic liver cirrhosis. Hepatology 1988;8:575-9. PMID 3371873; DOI 10.1002/hep.1840080323.
35. Grzegorzewski J, Bartsch F, Köller A, König M. Pharmacokinetics of caffeine: a systematic analysis of reported data for application in metabolic phenotyping and liver function testing. Front Pharmacol 2022;12:752826. PMID 35280254; DOI 10.3389/fphar.2021.752826; PMC8914174.
36. Gardiner C, Weakley J, Burke LM, et al. The effect of alcohol on subsequent sleep in healthy adults: a systematic review and meta-analysis. Sleep Med Rev 2025;80:102030. PMID 39631226; DOI 10.1016/j.smrv.2024.102030.
37. de Zambotti M, Forouzanfar M, Javitz H, et al. Impact of evening alcohol consumption on nocturnal autonomic and cardiovascular function in adult men and women: a dose-response laboratory investigation. Sleep 2021;44:zsaa135. PMID 32663278; DOI 10.1093/sleep/zsaa135.
38. Afaghi A, O'Connor H, Chow CM. High-glycemic-index carbohydrate meals shorten sleep onset. Am J Clin Nutr 2007;85:426-30. PMID 17284739; DOI 10.1093/ajcn/85.2.426.
39. Afaghi A, O'Connor H, Chow CM. Acute effects of the very low carbohydrate diet on sleep indices. Nutr Neurosci 2008;11:146-54. PMID 18681982; DOI 10.1179/147683008X301540.
40. Vlahoyiannis A, Giannaki CD, Sakkas GK, Aphamis G, Andreou E. A systematic review, meta-analysis and meta-regression on the effects of carbohydrates on sleep. Nutrients 2021;13:1283. PMID 33919698; DOI 10.3390/nu13041283.
41. Crispim CA, Zimberg IZ, dos Reis BG, et al. Relationship between food intake and sleep pattern in healthy individuals. J Clin Sleep Med 2011;7:659-64. PMID 22171206; DOI 10.5664/jcsm.1476.
42. St-Onge MP, Roberts A, Shechter A, Choudhury AR. Fiber and saturated fat are associated with sleep arousals and slow wave sleep. J Clin Sleep Med 2016;12:19-24. PMID 26156950; DOI 10.5664/jcsm.5384.
43. Stutz J, Eiholzer R, Spengler CM. Effects of evening exercise on sleep in healthy participants: a systematic review and meta-analysis. Sports Med 2019;49:269-87. PMID 30374942; DOI 10.1007/s40279-018-1015-0.
44. Kredlow MA, Capozzoli MC, Hearon BA, Calkins AW, Otto MW. The effects of physical activity on sleep: a meta-analytic review. J Behav Med 2015;38:427-49. PMID 25596964; DOI 10.1007/s10865-015-9617-6.
45. Martin CK, Bhapkar M, Pittas AG, et al. Effect of calorie restriction on mood, quality of life, sleep, and sexual function in healthy nonobese adults: the CALERIE 2 randomized clinical trial. JAMA Intern Med 2016;176:743-52. PMID 27136347; DOI 10.1001/jamainternmed.2016.1189.
46. Rossow LM, Fukuda DH, Fahs CA, Loenneke JP, Stout JR. Natural bodybuilding competition preparation and recovery: a 12-month case study. Int J Sports Physiol Perform 2013;8:582-92. PMID 23412685; DOI 10.1123/ijspp.8.5.582.

**Stress**
47. Hill D, Conner M, Clancy F, et al. Stress and eating behaviours in healthy adults: a systematic review and meta-analysis. Health Psychol Rev 2022;16:280-304. PMID 33913377; DOI 10.1080/17437199.2021.1923406.
48. Wardle J, Chida Y, Gibson EL, Whitaker KL, Steptoe A. Stress and adiposity: a meta-analysis of longitudinal studies. Obesity 2011;19:771-8. PMID 20948519; DOI 10.1038/oby.2010.241.
49. van der Valk ES, Abawi O, Mohseni M, et al. Cross-sectional relation of long-term glucocorticoids in hair with anthropometric measurements and their possible determinants: a systematic review and meta-analysis. Obes Rev 2022;23:e13376. PMID 34811866; DOI 10.1111/obr.13376.
50. Ostinelli G, Scovronec A, Iceta S, et al. Deciphering the association between hypothalamus-pituitary-adrenal axis activity and obesity: a meta-analysis. Obesity 2021;29:846-58. PMID 33783120; DOI 10.1002/oby.23125.
51. Epel ES, McEwen B, Seeman T, et al. Stress and body shape: stress-induced cortisol secretion is consistently greater among women with central fat. Psychosom Med 2000;62:623-32. PMID 11020091; DOI 10.1097/00006842-200009000-00005.
52. Kiecolt-Glaser JK, Marucha PT, Malarkey WB, Mercado AM, Glaser R. Slowing of wound healing by psychological stress. Lancet 1995;346:1194-6. PMID 7475659; DOI 10.1016/s0140-6736(95)92899-5.

**Sex**
53. Christensen P, Meinert Larsen T, Westerterp-Plantenga M, et al. Men and women respond differently to rapid weight loss: metabolic outcomes of a multi-centre intervention study after a low-energy diet in 2500 overweight individuals with pre-diabetes (PREVIEW). Diabetes Obes Metab 2018;20:2840-51. PMID 30088336; DOI 10.1111/dom.13466; PMC6282840 (FT).
54. Millward DJ, Truby H, Fox KR, Livingstone MB, Macdonald IA, Tothill P. Sex differences in the composition of weight gain and loss in overweight and obese adults. Br J Nutr 2014;111:933-43. PMID 24103395; DOI 10.1017/S0007114513003103.
55. Roberts BM, Nuckols G, Krieger JW. Sex differences in resistance training: a systematic review and meta-analysis. J Strength Cond Res 2020;34:1448-60. PMID 32218059; DOI 10.1519/JSC.0000000000003521.
56. Hubal MJ, Gordish-Dressman H, Thompson PD, et al. Variability in muscle size and strength gain after unilateral resistance training. Med Sci Sports Exerc 2005;37:964-72. PMID 15947721.
57. Tarnopolsky MA. Gender differences in substrate metabolism during endurance exercise. Can J Appl Physiol 2000;25:312-27. PMID 10953068; DOI 10.1139/h00-024.
58. Venables MC, Achten J, Jeukendrup AE. Determinants of fat oxidation during exercise in healthy men and women: a cross-sectional study. J Appl Physiol 2005;98:160-7. PMID 15333616; DOI 10.1152/japplphysiol.00662.2003.
59. Arciero PJ, Goran MI, Poehlman ET. Resting metabolic rate is lower in women than in men. J Appl Physiol 1993;75:2514-20. PMID 8125870; DOI 10.1152/jappl.1993.75.6.2514 (co-author later found to have committed research misconduct in other papers; this record has no retraction notice — supporting evidence only).
60. Pontzer H, Yamada Y, Sagayama H, et al. Daily energy expenditure through the human life course. Science 2021;373:808-12. PMID 34385400; DOI 10.1126/science.abe5017; PMC8370708 (FT).
61. Kuk JL, Ross R. Influence of sex on total and regional fat loss in overweight and obese men and women. Int J Obes 2009;33:629-34. PMID 19274055; DOI 10.1038/ijo.2009.48.
62. Ross R, Rissanen J. Mobilization of visceral and subcutaneous adipose tissue in response to energy restriction and exercise. Am J Clin Nutr 1994;60:695-703. PMID 7942575; DOI 10.1093/ajcn/60.5.695.
63. Karastergiou K, Smith SR, Greenberg AS, Fried SK. Sex differences in human adipose tissues – the biology of pear shape. Biol Sex Differ 2012;3:13. PMID 22651247; DOI 10.1186/2042-6410-3-13.
64. Hellström L, Wahrenberg H, Hruska K, Reynisdottir S, Arner P. Mechanisms behind gender differences in circulating leptin levels. J Intern Med 2000;247:457-62. PMID 10792559; DOI 10.1046/j.1365-2796.2000.00678.x.
65. Soeters MR, Sauerwein HP, Groener JE, et al. Gender-related differences in the metabolic response to fasting. J Clin Endocrinol Metab 2007;92:3646-52. PMID 17566089; DOI 10.1210/jc.2007-0552.
66. Knol MGE, van der Vaart A, Kieneker L, et al. Sex-specific determinants of the ketone body β-hydroxybutyrate in the general population. J Clin Endocrinol Metab 2026;111:e995-e1005. PMID 41159535; DOI 10.1210/clinem/dgaf587.
67. Halkes CJ, van Dijk H, Verseyden C, et al. Gender differences in postprandial ketone bodies in normolipidemic subjects and in untreated patients with familial combined hyperlipidemia. Arterioscler Thromb Vasc Biol 2003;23:1875-80. PMID 12933534; DOI 10.1161/01.ATV.0000092326.00725.ED.
68. Loucks AB, Thuma JR. Luteinizing hormone pulsatility is disrupted at a threshold of energy availability in regularly menstruating women. J Clin Endocrinol Metab 2003;88:297-311. PMID 12519869; DOI 10.1210/jc.2002-020369.
69. Jackson AS, Stanforth PR, Gagnon J, et al. The effect of sex, age and race on estimating percentage body fat from body mass index: the Heritage Family Study. Int J Obes 2002;26:789-96. PMID 12037649; DOI 10.1038/sj.ijo.0802006.
70. Lundsgaard AM, Kiens B. Gender differences in skeletal muscle substrate metabolism – molecular mechanisms and insulin sensitivity. Front Endocrinol 2014;5:195. PMID 25431568; DOI 10.3389/fendo.2014.00195.
71. Wang Z, Ying Z, Bosy-Westphal A, et al. Specific metabolic rates of major organs and tissues across adulthood: evaluation by mechanistic model of resting energy expenditure. Am J Clin Nutr 2010;92:1369-77. PMID 20962155; DOI 10.3945/ajcn.2010.29885.
72. Considine RV, Sinha MK, Heiman ML, et al. Serum immunoreactive-leptin concentrations in normal-weight and obese humans. N Engl J Med 1996;334:292-5. PMID 8532024; DOI 10.1056/NEJM199602013340503.

**Menstrual cycle and hormonal contraception**
73. Tucker JAL, McCarthy SF, Bornath DPD, Khoja JS, Hazell TJ. The effect of the menstrual cycle on energy intake: a systematic review and meta-analysis. Nutr Rev 2025;83:e866-e876. PMID 39008822; DOI 10.1093/nutrit/nuae093; PMC11819481.
74. Benton MJ, Hutchins AM, Dawes JJ. Effect of menstrual cycle on resting metabolism: a systematic review and meta-analysis. PLoS One 2020;15:e0236025. PMID 32658929; DOI 10.1371/journal.pone.0236025; PMC7357764 (FT).
75. Davidsen L, Vistisen B, Astrup A. Impact of the menstrual cycle on determinants of energy balance: a putative role in weight loss attempts. Int J Obes 2007;31:1777-85. PMID 17684511; DOI 10.1038/sj.ijo.0803699.
76. White CP, Hitchcock CL, Vigna YM, Prior JC. Fluid retention over the menstrual cycle: 1-year data from the Prospective Ovulation Cohort. Obstet Gynecol Int 2011;2011:138451. PMID 21845193; DOI 10.1155/2011/138451.
77. Aguree S, Bethancourt HJ, Taylor LA, Rosinger AY, Gernand AD. Plasma volume variation across the menstrual cycle among healthy women of reproductive age: a prospective cohort study. Physiol Rep 2020;8:e14418. PMID 32323928; DOI 10.14814/phy2.14418.
78. Koşar ŞN, Güzel Y, Köse MG, Kin İşler A, Hazır T. Whole and segmental body composition changes during mid-follicular and mid-luteal phases of the menstrual cycle in recreationally active young women. Ann Hum Biol 2022;49:124-32. PMID 35696275; DOI 10.1080/03014460.2022.2088857.
79. Wagner M, Wagner A, Löfberg I, et al. Menstrual cycle phase is associated with changes in body weight, bioimpedance, and carbohydrate intake, but not in resting metabolic rate in physically active females. Int J Sport Nutr Exerc Metab 2026 (online 10 Sep 2026). PMID 42722363; DOI 10.1123/ijsnem.2026-0015.
80. Takano Y, Shirai T, Tanaka Y, et al. The difference between subjective symptoms and objective symptom of edema during the menstrual cycle. Sci Rep 2026;16:25009. PMID 42225881; DOI 10.1038/s41598-026-55554-1.
81. Gleichauf CN, Roe DA. The menstrual cycle's effect on the reliability of bioimpedance measurements for assessing body composition. Am J Clin Nutr 1989;50:903-7. PMID 2816797; DOI 10.1093/ajcn/50.5.903.
82. Frandsen J, Pistoljevic N, Quesada JP, et al. Menstrual cycle phase does not affect whole body peak fat oxidation rate during a graded exercise test. J Appl Physiol 2020;128:681-7. PMID 32078462; DOI 10.1152/japplphysiol.00774.2019.
83. D'Souza AC, Wageh M, Williams JS, et al. Menstrual cycle hormones and oral contraceptives: a multimethod systems physiology-based review of their impact on key aspects of female physiology. J Appl Physiol 2023;135:1284-99. PMID 37823207; DOI 10.1152/japplphysiol.00346.2023.
84. McNulty KL, Elliott-Sale KJ, Dolan E, et al. The effects of menstrual cycle phase on exercise performance in eumenorrheic women: a systematic review and meta-analysis. Sports Med 2020;50:1813-27. PMID 32661839; DOI 10.1007/s40279-020-01319-3.
85. Elliott-Sale KJ, McNulty KL, Ansdell P, et al. The effects of oral contraceptives on exercise performance in women: a systematic review and meta-analysis. Sports Med 2020;50:1785-812. PMID 32666247; DOI 10.1007/s40279-020-01317-5.
86. Colenso-Semple LM, D'Souza AC, Elliott-Sale KJ, Phillips SM. Current evidence shows no influence of women's menstrual cycle phase on acute strength performance or adaptations to resistance exercise training. Front Sports Act Living 2023;5:1054542. PMID 37033884; DOI 10.3389/fspor.2023.1054542.
87. Thompson B, Almarjawi A, Sculley D, Janse de Jonge X. The effect of the menstrual cycle and oral contraceptives on acute responses and chronic adaptations to resistance training: a systematic review of the literature. Sports Med 2020;50:171-85. PMID 31677121; DOI 10.1007/s40279-019-01219-1.
88. Engstad MK, Seynnes O, Vesterhus I, et al. Effect of oral contraceptive use on muscle hypertrophy following strength training. Scand J Med Sci Sports 2025;35:e70052. PMID 40219704; DOI 10.1111/sms.70052.
89. Gallo MF, Lopez LM, Grimes DA, et al. Combination contraceptives: effects on weight. Cochrane Database Syst Rev 2014;(1):CD003987. PMID 24477630; DOI 10.1002/14651858.CD003987.pub5.
90. Hirschberg AL. Sex hormones, appetite and eating behaviour in women. Maturitas 2012;71:248-56. PMID 22281161; DOI 10.1016/j.maturitas.2011.12.016.

**Menopause**
91. Lovejoy JC, Champagne CM, de Jonge L, Xie H, Smith SR. Increased visceral fat and decreased energy expenditure during the menopausal transition. Int J Obes 2008;32:949-58. PMID 18332882; DOI 10.1038/ijo.2008.25; PMC2748330.
92. Greendale GA, Sternfeld B, Huang M, et al. Changes in body composition and weight during the menopause transition. JCI Insight 2019;4:e124865. PMID 30843880; DOI 10.1172/jci.insight.124865 (annual rates read from https://insight.jci.org/articles/view/124865).
93. Ambikairajah A, Walsh E, Tabatabaei-Jafari H, Cherbuin N. Fat mass changes during menopause: a metaanalysis. Am J Obstet Gynecol 2019;221:393-409. PMID 31034807; DOI 10.1016/j.ajog.2019.04.023.
94. Davis SR, Castelo-Branco C, Chedraui P, et al. Understanding weight gain at menopause. Climacteric 2012;15:419-29. PMID 22978257; DOI 10.3109/13697137.2012.707385.
95. Salpeter SR, Walsh JM, Ormiston TM, et al. Meta-analysis: effect of hormone-replacement therapy on components of the metabolic syndrome in postmenopausal women. Diabetes Obes Metab 2006;8:538-54. PMID 16918589; DOI 10.1111/j.1463-1326.2005.00545.x.
96. Greendale GA, Sowers M, Han W, et al. Bone mineral density loss in relation to the final menstrual period in a multiethnic cohort: results from SWAN. J Bone Miner Res 2012;27:111-8. PMID 21976317; DOI 10.1002/jbmr.534.
97. Karlamangla AS, Burnett-Bowie SM, Crandall CJ. Bone health during the menopause transition and beyond. Obstet Gynecol Clin North Am 2018;45:695-708. PMID 30401551; DOI 10.1016/j.ogc.2018.07.012.
98. **RETRACTED — do not use as evidence:** Poehlman ET, Toth MJ, Gardner AW. Changes in energy balance and body composition at menopause: a controlled longitudinal study. Ann Intern Med 1995;123:673-5 (retraction: Ann Intern Med 2003;139:702). PMID 7574222; DOI 10.7326/0003-4819-123-9-199511010-00005.

**Ageing**
99. Mitchell WK, Williams J, Atherton P, et al. Sarcopenia, dynapenia, and the impact of advancing age on human skeletal muscle size and strength; a quantitative review. Front Physiol 2012;3:260. PMID 22934016; DOI 10.3389/fphys.2012.00260.
100. Moore DR, Churchward-Venne TA, Witard O, et al. Protein ingestion to stimulate myofibrillar protein synthesis requires greater relative protein intakes in healthy older versus younger men. J Gerontol A Biol Sci Med Sci 2015;70:57-62. PMID 25056502; DOI 10.1093/gerona/glu103.
101. Kumar V, Selby A, Rankin D, et al. Age-related differences in the dose-response relationship of muscle protein synthesis to resistance exercise in young and old men. J Physiol 2009;587:211-7. PMID 19001042; DOI 10.1113/jphysiol.2008.164483.
102. Martel GF, Roth SM, Ivey FM, et al. Age and sex affect human muscle fibre adaptations to heavy-resistance strength training. Exp Physiol 2006;91:457-64. PMID 16407471; DOI 10.1113/expphysiol.2005.032771.
103. Bauer J, Biolo G, Cederholm T, et al. Evidence-based recommendations for optimal dietary protein intake in older people: a position paper from the PROT-AGE Study Group. J Am Med Dir Assoc 2013;14:542-59. PMID 23867520; DOI 10.1016/j.jamda.2013.05.021.
104. Kosek DJ, Kim JS, Petrella JK, Cross JM, Bamman MM. Efficacy of 3 days/wk resistance training on myofiber hypertrophy and myogenic mechanisms in young vs. older adults. J Appl Physiol 2006;101:531-44. PMID 16614355; DOI 10.1152/japplphysiol.01474.2005.
105. Peterson MD, Sen A, Gordon PM. Influence of resistance exercise on lean body mass in aging adults: a meta-analysis. Med Sci Sports Exerc 2011;43:249-58. PMID 20543750; DOI 10.1249/MSS.0b013e3181eb6265.
106. Csapo R, Alegre LM. Effects of resistance training with moderate vs heavy loads on muscle mass and strength in the elderly: a meta-analysis. Scand J Med Sci Sports 2016;26:995-1006. PMID 26302881; DOI 10.1111/sms.12536.
107. de Santana DA, Scolfaro PG, Marzetti E, Cavaglieri CR. Lower extremity muscle hypertrophy in response to resistance training in older adults: systematic review, meta-analysis, and meta-regression of randomized controlled trials. Exp Gerontol 2024;198:112639. PMID 39579806; DOI 10.1016/j.exger.2024.112639.
108. Fleg JL, Morrell CH, Bos AG, et al. Accelerated longitudinal decline of aerobic capacity in healthy older adults. Circulation 2005;112:674-82. PMID 16043637; DOI 10.1161/CIRCULATIONAHA.105.545459.
109. Hawkins S, Wiswell R. Rate and mechanism of maximal oxygen consumption decline with aging: implications for exercise training. Sports Med 2003;33:877-88. PMID 12974656; DOI 10.2165/00007256-200333120-00002.
110. Shimokata H, Muller DC, Fleg JL, et al. Age as independent determinant of glucose tolerance. Diabetes 1991;40:44-51. PMID 2015973; DOI 10.2337/diab.40.1.44.
111. Villareal DT, Chode S, Parimi N, et al. Weight loss, exercise, or both and physical function in obese older adults. N Engl J Med 2011;364:1218-29. PMID 21449785; DOI 10.1056/NEJMoa1008234; PMC3114602 (FT).
112. Chaston TB, Dixon JB, O'Brien PE. Changes in fat-free mass during significant weight loss: a systematic review. Int J Obes 2007;31:743-50. PMID 17075583; DOI 10.1038/sj.ijo.0803483.
113. Baxter-Jones ADG, Faulkner RA, Forwood MR, Mirwald RL, Bailey DA. Bone mineral accrual from 8 to 30 years of age: an estimation of peak bone mass. J Bone Miner Res 2011;26:1729-39. PMID 21520276; DOI 10.1002/jbmr.412.
114. Golden NH, Schneider M, Wood C; AAP Committee on Nutrition, Committee on Adolescence, Section on Obesity. Preventing obesity and eating disorders in adolescents. Pediatrics 2016;138:e20161649. PMID 27550979; DOI 10.1542/peds.2016-1649.

**Body-fat level, variability, ethnicity**
115. Hall KD. Body fat and fat-free mass inter-relationships: Forbes's theory revisited. Br J Nutr 2007;97:1059-63. PMID 17367567; DOI 10.1017/S0007114507691946; PMC2376748.
116. Elia M, Stubbs RJ, Henry CJ. Differences in fat, carbohydrate, and protein metabolism between lean and obese subjects undergoing total starvation. Obes Res 1999;7:597-604. PMID 10574520; DOI 10.1002/j.1550-8528.1999.tb00720.x.
117. Murton AJ, Marimuthu K, Mallinson JE, et al. Obesity appears to be associated with altered muscle protein synthetic and breakdown responses to increased nutrient delivery in older men, but not reduced muscle mass or contractile function. Diabetes 2015;64:3160-71. PMID 26015550; DOI 10.2337/db15-0021.
118. Bouchard C, Tremblay A, Després JP, et al. The response to long-term overfeeding in identical twins. N Engl J Med 1990;322:1477-82. PMID 2336074; DOI 10.1056/NEJM199005243222101.
119. Bouchard C, An P, Rice T, et al. Familial aggregation of VO2max response to exercise training: results from the HERITAGE Family Study. J Appl Physiol 1999;87:1003-8. PMID 10484570; DOI 10.1152/jappl.1999.87.3.1003.
120. Gardner CD, Trepanowski JF, Del Gobbo LC, et al. Effect of low-fat vs low-carbohydrate diet on 12-month weight loss in overweight adults and the association with genotype pattern or insulin secretion: the DIETFITS randomized clinical trial. JAMA 2018;319:667-79. PMID 29466592; DOI 10.1001/jama.2018.0245; PMC5839290 (individual range read via https://pmc.ncbi.nlm.nih.gov/articles/PMC5839290/).
121. Deurenberg P, Deurenberg-Yap M, Guricci S. Asians are different from Caucasians and from each other in their body mass index/body fat per cent relationship. Obes Rev 2002;3:141-6. PMID 12164465; DOI 10.1046/j.1467-789x.2002.00065.x.
122. Lear SA, Humphries KH, Kohli S, et al. Visceral adipose tissue accumulation differs according to ethnic background: results of the Multicultural Community Health Assessment Trial (M-CHAT). Am J Clin Nutr 2007;86:353-9. PMID 17684205; DOI 10.1093/ajcn/86.2.353.
123. Hecksteden A, Kraushaar J, Scharhag-Rosenberger F, Theisen D, Senn S, Meyer T. Individual response to exercise training – a statistical perspective. J Appl Physiol 2015;118:1450-9. PMID 25663672; DOI 10.1152/japplphysiol.00714.2014.
124. Gallagher D, Heymsfield SB, Heo M, et al. Healthy percentage body fat ranges: an approach for developing guidelines based on body mass index. Am J Clin Nutr 2000;72:694-701. PMID 10966886; DOI 10.1093/ajcn/72.3.694.

**Medications / conditions / other**
125. Wilding JPH, Batterham RL, Calanna S, et al. Once-weekly semaglutide in adults with overweight or obesity (STEP 1). N Engl J Med 2021;384:989-1002. PMID 33567185; DOI 10.1056/NEJMoa2032183.
126. Jastreboff AM, Aronne LJ, Ahmad NN, et al. Tirzepatide once weekly for the treatment of obesity (SURMOUNT-1). N Engl J Med 2022;387:205-16. PMID 35658024; DOI 10.1056/NEJMoa2206038.
127. Look M, Dunn JP, Kushner RF, et al. Body composition changes during weight reduction with tirzepatide in the SURMOUNT-1 study of adults with obesity or overweight. Diabetes Obes Metab 2025;27:2720-9. PMID 39996356; DOI 10.1111/dom.16275; PMC11965027.
128. Neeland IJ, Linge J, Birkenfeld AL. Changes in lean body mass with glucagon-like peptide-1-based therapies and mitigation strategies. Diabetes Obes Metab 2024;26(Suppl 4):16-27. PMID 38937282; DOI 10.1111/dom.15728.
129. Karakasis P, Patoulias D, Fragakis N, Mantzoros CS. Effect of glucagon-like peptide-1 receptor agonists and co-agonists on body composition: systematic review and network meta-analysis. Metabolism 2025;164:156113. PMID 39719170; DOI 10.1016/j.metabol.2024.156113.
130. Batsis JA, Gavras A, Gross DC, et al. Effect of incretin-based and nonpharmacologic weight loss on body composition: a systematic review. Ann Intern Med 2026;179:996-1013. PMID 41996180; DOI 10.7326/ANNALS-25-00478.
131. Blundell J, Finlayson G, Axelsen M, et al. Effects of once-weekly semaglutide on appetite, energy intake, control of eating, food preference and body weight in subjects with obesity. Diabetes Obes Metab 2017;19:1242-51. PMID 28266779; DOI 10.1111/dom.12932; PMC5573908.
132. al-Adsani H, Hoffer LJ, Silva JE. Resting energy expenditure is sensitive to small dose changes in patients on chronic thyroid hormone replacement. J Clin Endocrinol Metab 1997;82:1118-25. PMID 9100583; DOI 10.1210/jcem.82.4.3873.
133. Lim SS, Hutchison SK, Van Ryswyk E, Norman RJ, Teede HJ, Moran LJ. Lifestyle changes in women with polycystic ovary syndrome. Cochrane Database Syst Rev 2019;3:CD007506. PMID 30921477; DOI 10.1002/14651858.CD007506.pub4.
134. Ferrannini E, Baldi S, Frascerra S, et al. Shift to fatty substrate utilization in response to sodium-glucose cotransporter 2 inhibition in subjects without diabetes and patients with type 2 diabetes. Diabetes 2016;65:1190-5. PMID 26861783; DOI 10.2337/db15-1356.
135. Bhasin S, Storer TW, Berman N, et al. The effects of supraphysiologic doses of testosterone on muscle size and strength in normal men. N Engl J Med 1996;335:1-7. PMID 8637535; DOI 10.1056/NEJM199607043350101.
136. Butte NF, King JC. Energy requirements during pregnancy and lactation. Public Health Nutr 2005;8:1010-27. PMID 16277817; DOI 10.1079/phn2005793.
137. Kirwan R, Peele L, Nuckols G, et al. Resting energy expenditure of women with and without polycystic ovary syndrome: a systematic review and meta-analysis. medRxiv preprint 2026 (not peer-reviewed). PMID 41409676; DOI 10.64898/2025.12.03.25341536.
138. Ross R, Goodpaster BH, Koch LG, et al. Precision exercise medicine: understanding exercise response variability. Br J Sports Med 2019;53:1141-53. PMID 30862704; DOI 10.1136/bjsports-2018-100328; PMC6818669.
