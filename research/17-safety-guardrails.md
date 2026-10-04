# 17 — Safety guardrails: hard constraints (Planner), warning rules (Simulator), gating, wording, regulatory framing

*Status: research draft, 2026-09-30. Author: research agent 17. Not medical or legal advice — see §4.6 and §10 for what still needs clinical and legal review.*

## 1. Scope

This dossier is the safety envelope for a client-only web app that (1) **simulates** any user-entered diet / fasting / exercise regime and (2) **prescribes** day-by-day regimes. It gives the engineering team:

* **(a)** machine-encodable **HARD constraints** for the Planner (§2) — the Planner must never output a regime outside them;
* **(b)** **WARNING rules** for the Simulator (§3) with user-facing text ≤ 200 characters;
* **(c)** the **onboarding gate**, population rules, the **tiered fasting rule set** (owner scope update: water-only fasting 24 h → >7 d and repeated fasts), medication gate, eating-disorder (ED) safeguarding and wording rules (§4);
* **(d)** **disclaimer copy** (short footer + full page), FDA/EU/FTC regulatory framing, GDPR/localStorage notes, and how to communicate uncertainty (§4.6–4.8);
* **(e)** references (§11, numbered `[n]`).

Sections follow the research protocol, adapted: §2–§4 are rule tables (variable, bound, condition, rationale, source, grade/severity); §5 interactions; §6 UI safety metrics; §7 validation ("golden") tests; §8 myths; §9 evidence digest by domain; §10 open questions; §11 references.

**Method caveat (important).** All numbers below were located in a source I opened (PubMed abstract, PMC full text, guideline text, regulator PDF/page). Where I could only read an abstract, or where the number is my own engineering judgement rather than a published threshold, it is labelled **`PROPOSED`** (engineering judgement anchored to cited data points) or **`UNVERIFIED`**. Several sources were blocked to my tooling (NCBI Bookshelf, BJSM, ODS, Wiley/ASPEN, Cell Press) and the session's web-search budget ran out mid-task; §10 lists what that affected. Correction to the brief: Levinson 2017 (MyFitnessPal in EDs) is in *Eating Behaviors*, not *Int J Eat Disord* [75].

### 1.1 Conventions

* **Evidence grade** (protocol): A = meta-analysis / validated model / several controlled human trials; B = few RCTs or consistent human mechanistic data; C = limited or indirect human data; D = animal / expert opinion / engineering judgement.
* **Severity** (Simulator): `info` (blue; no acknowledgement) · `caution` (amber; shown inline and in export) · `danger` (red; interstitial + explicit acknowledgement before results render; results watermarked "SIMULATION — NOT A RECOMMENDATION").
* **Planner action** on violation: `BLOCK_APP` (both features off) · `BLOCK_PLANNER` (Simulator stays available with `danger` banners) · `RESTRICT` (Planner search space shrinks — see modes) · `CLIP` (project the offending variable to the bound) · `REJECT` (discard candidate regime) · `INSERT_BREAK` (planner must insert a maintenance block) · `REQUIRE_OPTIN` (feature only after explicit opt-in + acknowledgement).
* **User modes** derived from onboarding (§4.1): `M0` standard · `R1` ED-risk restricted · `R2` clinician-first restricted · `H` hard-stop (BLOCK_APP or BLOCK_PLANNER).
* Sex-specific floors use the **sex parameter of the physiological model** (dossier 16); the app should say plainly that this is a physiological parameter, not an identity statement.

### 1.2 Decisions requested from the owner (each has a recommended default)

1. **Fasting tiers** (§4.3): T0–T1 default; T2 and T3 opt-in with acknowledgement; **T4 (3–7 d) and VLED/PSMF blocks only behind an "expert mode" flag with a clinician-supervision attestation; T5 (> 7 d) never in the Planner.** Rationale: no guideline endorses unsupervised fasting beyond ~72 h or unsupervised < 800 kcal/d, and supervised water-only data still show ≥ grade-3 adverse events in 20 % by day 5.
2. **Energy floors** 1200 (F) / 1500 (M) kcal/d weekly mean, deficit ≤ 25 % (30 % if BMI ≥ 30), rate ≤ 0.5–1 %BW/wk and ≤ 1.5 kg/wk, EA ≥ 30 kcal/kg FFM/d, BMI ≥ 20 to start a deficit — encoded as **hard filters**, never objective terms.
3. **Block the app for < 18** and block the Planner for pregnancy/breastfeeding, type 1 diabetes and insulin/sulfonylurea/SGLT2-inhibitor users.
4. **SCOFF-adapted gate** for the Planner as a risk flag, plus universal ED safeguards for everyone (§4.1, §4.5).
5. **Blood-marker outputs as relative trends only** (no absolute clinical values, no reference-range shading, no disease-risk scores) to stay inside FDA General Wellness / EU wellness carve-outs (§4.6).
6. **Persist to localStorage only after opt-in**; keep "data never leaves the browser" literally true (§4.7).
7. **Counsel and clinician review** before release of: T3/T4/V copy, disclaimers, the medication table, and the regulatory positioning (§10).

---

## 2. Planner HARD constraints (deliverable a)

### 2.1 Derived quantities the engine must expose

| Symbol | Definition | Unit | Source dossier |
|---|---|---|---|
| `BW, H, BMI` | body weight, height, BW/H² | kg, m, kg/m² | 14 |
| `FFM, FM, BF%` | modelled fat-free mass, fat mass, FM/BW. Slider/BMI-derived BF% has SEE ≈ 2.8–5.4 percentage points [69] — treat as uncertain ±4 | kg, % | 01, 14 |
| `RW` | reference weight for protein floors: `min(BW, 27.5·H²)` (`PROPOSED`; align with dossier 03) | kg | 03 |
| `TDEE_d` | modelled total daily energy expenditure including exercise, at the current adaptation state | kcal/d | 02, 10 |
| `EI_d`, `EI_7` | planned intake for day d; trailing 7-day mean | kcal/d | user/planner |
| `deficit_pct_7` | `100·(1 − EI_7 / TDEE_7)` | % | derived |
| `EEE_d` | exercise energy expenditure (net of resting) | kcal/d | 10 |
| `EA_d`, `EA_7` | energy availability `(EI_d − EEE_d)/FFM`; trailing 7-d mean [1][2] | kcal/kg FFM/d | derived |
| `TM` | tissue mass = BW minus modelled glycogen + bound water and fluid-shift terms, so day-1 water loss does not trip rate rules | kg | 01, 04 |
| `rate_14` | −slope of `TM` over trailing 14 d, in kg/wk and %BW/wk | | derived |
| `cum_loss` | `(BW_0 − BW_t)/BW_0` | % | derived |
| `fast_h` | consecutive hours since last intake > 50 kcal | h | 07 |
| `fastH_7` | fasted hours in trailing 7 d | h | derived |
| `WHtR` | waist / height (needs optional waist input) | ratio | 14 |

### 2.2 Constraint table

`Grade` is the grade of the evidence behind the bound; `PROPOSED` marks engineering judgement (bound not published as such). "Src" = §11 reference numbers.

| ID | Variable | Bound | Applies when | Window | Action | Rationale (short) | Src | Grade |
|---|---|---|---|---|---|---|---|---|
| **Eligibility / profile** | | | | | | | | |
| HC-P1 | age | ≥ 18 y | always | profile | BLOCK_APP | Dieting in adolescents is the strongest known predictor of new EDs (severe dieters ×18, moderate ×5 in 14–15-y girls); AAP: focus on healthy lifestyle not weight; IOC: body-composition work in <18 only for medical purposes | [71][73][1] | B |
| HC-P2 | pregnant / breastfeeding flag | must be false | Planner | profile | BLOCK_PLANNER | Restrictive low-energy diets contraindicated in pregnancy/lactation; safety of IF/fasting/keto not studied; lactation ketoacidosis case; weight-gain targets are clinical (IOM 2009 table) | [43][47][45][101] | B/C |
| HC-P3 | ED-risk mode `R1` (Q3 yes/"prefer not to say", or SCOFF-adapted score ≥ 2) | Planner outputs **maintenance or surplus energy only**; no deficit, no fasting > 12 h, no carbohydrate restriction < 100 g, no numeric weight-loss goal | Planner | profile | RESTRICT | NICE: people can have an ED at any weight; assess/counsel before restrictive diets; calorie-tracker use associated with ED symptoms; SCOFF pooled Se 0.86 / Sp 0.83 (≈ 14 % of true cases are missed — universal safeguards still apply) | [7][74][75][76][79] | B/C |
| HC-P4 | BMI (current) / projected BMI | start any deficit only if BMI ≥ 20.0; projected BMI ≥ 19.0 on every day | any deficit | daily | REJECT / CLIP to maintenance | WHO/NICE underweight < 18.5; audit found ~1/5 of top apps allowed underweight goals and authors recommend blocking BMI < 18.5 goals; women reached BMI 18.7–19.0 after 4-mo prep. Margins 1.5 / 0.5 BMI cover ±3 kg BF-slider error (`PROPOSED`) | [7][77][67] | B (18.5) / D (margins) |
| HC-P5 | projected BF% (estimated) | ≥ **10 %** (male) / ≥ **18 %** (female); no new deficit block if BF% < floor + 2 | any deficit | daily | CLIP | No accepted health-based optimum exists [68]; commonly quoted essential-fat ranges (~2–5 % M, 10–13 % F; **UNVERIFIED** here) lie below these floors; male at 4.5 % BF: HR 27 bpm, T −75 %, POMS TMD 6→43; women −35–50 % fat mass: leptin/T3/E2/T ↓, menstrual irregularity; "minimum 12–14 % F" quoted. Floors = physiological minimum + ~4–5 points for estimation error (`PROPOSED`) | [66][67][68][69] | D |
| HC-P6 | diabetes on insulin, sulfonylurea/meglitinide, SGLT2 inhibitor; any type 1 diabetes | must be false | Planner | profile | BLOCK_PLANNER | Hypoglycaemia; euglycaemic DKA precipitated by low-carbohydrate diets, fasting, extensive exercise, dehydration, alcohol; ADA: very-low-carb needs practitioner to cut insulin/hypoglycaemic drugs | [44][47][43] | B |
| HC-P7 | other medical / medication flags (Q10–Q13, §4.4) | → mode `R2` | Planner | profile | RESTRICT (see 4.2) | Screening logic mirrors PAR-Q+ / ACSM (symptoms, known CV/metabolic/renal disease, intended intensity) | [85][86][87] | B |
| HC-P8 | age 65–74 | deficit ≤ 15 %, `rate_14` ≤ 0.5 %BW/wk, protein ≥ 1.2 g/kg RW, fasting ≤ tier T1, resistance training encouraged | Planner | profile | RESTRICT | Older adults need ≥ 1.0–1.2 g/kg; diet-only −10 % BW cost −5 % lean mass and −3 % hip BMD (−3 %/−1 % with exercise); both SAEs in the water-fasting chart review were men aged 70 and 73 | [48][49][12] | B |
| HC-P9 | age ≥ 75, or SARC-F ≥ 4 | no deficit; maintenance / protein / RT only | Planner | profile | RESTRICT | SARC-F ≥ 4 predicts sarcopenia-related disability, hospitalisation, mortality | [50][48] | B |
| **Energy** | | | | | | | | |
| HC-E1 | `EI_7` | ≥ **1200** kcal/d (female) / ≥ **1500** kcal/d (male) | any deficit; no clinician-supervised flag | 7 d | CLIP up / REJECT | AHA/ACC/TOS typical prescription 1200–1500 (F), 1500–1800 (M); < 800 only in a medical setting; NICE 2025: even 800–1200 "low-energy diets" only inside a specialist service for BMI ≥ 30 | [6][7] | A/B |
| HC-E2 | `EI_d` on "restricted days" (50 < EI_d < 1000 F / < 1200 M) | ≥ 500 (F) / ≥ 600 (M) kcal; ≤ **2** such days per rolling 7 d, never consecutive | 5:2-type patterns | daily | REJECT | 5:2 arm: ≈ 2710 kJ (~650 kcal) on 2 d/wk for 6 mo matched continuous restriction in 107 overweight women (weekly mean 25 % deficit) | [18] | B |
| HC-E3 | `deficit_pct_7` | ≤ cap(BMI, age, BF%) — default **25 %**; 30 % if BMI ≥ 30; 20 % if BMI < 25; 15 % if age ≥ 65; 10 % if BF% ≤ floor + 4 (§2.3) | any deficit | 7 d | CLIP | AHA lists "30 % energy deficit" as an option; CALERIE 25 % target (BMI 25.1) → 2-y bone loss; Garthe 19 % deficit preserved LBM vs 30 % did not; MATADOR 33 % (BMI 34, 2-wk blocks) | [6][26][4][24] | B/C |
| HC-E4 | `EA_7` | ≥ **30** kcal/kg FFM/d (both sexes) | any regime with exercise | 7 d | CLIP (raise EI or cut EEE) | LH pulsatility intact at 30, disrupted below (5-d lab study, 29 sedentary women); bone-formation markers already suppressed at 30, resorption ↑ at 10. REDs 2023: 30 is debated, not universal; males tolerate lower (~9–25) so 30 is a conservative cross-sex bound | [2][3][1] | B (F) / D (M) |
| HC-E5 | `rate_14` | ≤ min(cap_pct·BW, 1.5 kg)/wk; cap_pct = 1.0 % (BMI ≥ 30 or BF% ≥ 30 M / 40 F), 0.5 % (BF% ≤ floor + 6), otherwise 0.75 % | any deficit | 14 d | CLIP | Gallstone risk rises exponentially above 1.5 kg/wk; 0.5–1 %/wk recommended to protect lean mass; 0.7 %/wk kept LBM (+2.1 %) vs 1.4 %/wk (−0.2 %) in athletes; rapid loss does not increase regain (RCT) so cap is about harms, not regain | [29][5][4][28] | B/C |
| HC-E6 | `cum_loss` in one plan | ≤ 20 % of starting BW | any deficit | plan | CLIP | Relative loss > 24 % of initial BW is a gallstone risk factor; Minnesota semi-starvation lost > 25 % with anaemia, oedema, apathy | [31][70] | C/D |
| HC-E7 | continuous deficit block | if `deficit_pct_7` ≥ 15 %: ≤ **12 wk**, then ≥ 1 wk (default 2 wk) at maintenance (absolute deficit ≤ 5 %); if 5–15 %: ≤ 26 wk then ≥ 2 wk | any deficit | block | INSERT_BREAK | 1 wk energy balance per 3 wk restriction gave equal fat loss/FFM retention with less hunger (RCT n = 61); 2-wk on/off blocks lost more (n = 47); NICE caps LED/VLED at 12 wk; 2-y CR at 25 % causes bone loss | [25][24][7][26] | C (`PROPOSED`) |
| HC-E8 | surplus | `EI` ≤ 120 % TDEE; gain ≤ 0.5 %BW/wk (≤ 0.25 % if WHtR 0.5–0.59); **no planned weight-gain surplus** if waist > 102 cm (M) / > 88 cm (F), WHtR ≥ 0.6, or BMI ≥ 30 | any surplus | 14 d | CLIP / REJECT | Off-season guidance: ~10–20 % surplus, 0.25–0.5 %BW/wk; AHA waist cut-points; NICE WHtR 0.5–0.59 "increased", ≥ 0.6 "high" risk | [64][6][7] | C |
| **Macronutrients** | | | | | | | | |
| HC-M1 | protein floor | ≥ 0.8 g/kg RW always; ≥ **1.2 g/kg RW** if `deficit_pct_7` > 10 % or age ≥ 65 or RT ≥ 2 d/wk in deficit; ≥ 1.0 g/kg RW at maintenance if age ≥ 65 | always | 7 d | CLIP up | RDA 0.8 g/kg is a minimum to avoid N loss; 2.4 vs 1.2 g/kg in a 40 % deficit gave +1.2 vs +0.1 kg lean mass; PROT-AGE ≥ 1.0–1.2 (>65 y) | [53][54][48] | A/B |
| HC-M2 | protein cap | ≤ min(**35 % E**, **3.1 g/kg FFM**); soft target ≤ 2.2 g/kg RW; ≤ **1.3 g/kg RW** if CKD-risk flag | always | 7 d | CLIP | > 35 % E risks hyperammonaemia/nausea ("rabbit starvation"); suggested max ≈ 25 % E / 2–2.5 g/kg; 2.3–3.1 g/kg FFM used in lean dieting athletes; no GFR harm in healthy adults (28 RCTs) | [58][55][57][52][51] | B/C |
| HC-M3 | fat | ≥ max(**15 % E**, **30 g/d**) when EI ≥ 800; plus ≥ 1 meal with ≥ 10 g fat/d when `deficit_pct_7` ≥ 20 % or `rate_14` ≥ 0.75 %/wk; if tracked: linoleic ≥ 2 % E, α-linolenic ≥ 0.25 % E (target 4 % / 0.5 %) | always | 7 d | CLIP up | 520 kcal + < 2 g fat: gallstones 4/6 vs 900 kcal + 30 g fat (one 10-g fat meal): 0/7; higher-fat diets RR 0.09 for stones; adult EFA deficiency < 1–2 % E linoleic; lower-fat diets ↓ T in men; 15–20 % E is the lower end used in contest prep | [33][34][31][62][63][5] | B/C |
| HC-M4 | carbohydrate | no floor for eligible adults. Net carbs < 50 g/d ("ketogenic range") only in mode `M0`, no KD contraindication (§4.2), with sodium + fluid plan; ≤ 12 wk per block then a re-assessment prompt (lipids, symptoms) | low-carb regimes | block | RESTRICT / REQUIRE_OPTIN | IOM RDA 130 g/d is a brain-glucose reference; ketones replace glucose as CNS fuel in fasting; KD: LDL-C +1.82 mM in 4 wk in every one of 17 women; keto-flu symptoms 2–4 wk | [112][13][46][43] | C |
| HC-M5 | fibre | soft floor 14 g / 1000 kcal (≈ 25 F / 38 M); EFSA AI 25 g/d | any | 7 d | soft objective | IOM fibre AI; EFSA AI | [113][59] | B |
| HC-M6 | sodium | planned 1.5–2.3 g/d (AI–CDRR); up to **4.0 g/d** only in fasting tiers T3–T4 and first 14 d of < 50 g carbs (or documented heavy sweating); never < 1.0 g/d | always | daily | CLIP | NASEM AI 1.5 g/d, CDRR 2.3 g/d; fasting/keto natriuresis peaks days 1–4 (100–150 mEq/d ≈ 2.3–3.4 g Na) and subsides ~14 d | [60][13][21] | B/D |
| HC-M7 | supplemental potassium | ≤ **1.0 g/d**; ≤ 2.0 g/d only in T4 opt-in; **none** in mode R2 renal / ACEi / ARB / K-sparing diuretic flags | always | daily | CLIP | No UL set (normal kidneys), but case reports of cardiac abnormalities/death at very large doses; DRI AI 2.6 g F / 3.4 g M | [60] | D |
| HC-M8 | supplemental magnesium | ≤ **350 mg/d** elemental | always | daily | CLIP | IOM 1997 UL (diarrhoea limiting) | [61] | B |
| HC-M9 | fluids | beverages 1.5–4.0 L/d; ≤ 1 L/h; fasting tiers ≥ 2.0 and ≤ 4.0 L/d; prescribe "to thirst" not fixed volumes for exercise | always | daily | CLIP | EFSA total-water AI 2.5 L M / 2.0 L F; NICE nutrition support 30–35 mL/kg; drink-to-thirst is safe and effective, deficits ≤ 3 % BM tolerated; SAE of hyponatraemia (day 9) in a water-only fast on distilled water | [59][8][65][12] | C/D |
| HC-M10 | alcohol | Planner never prescribes; alcohol input disabled in Planner | Planner | — | REJECT | Group 1 carcinogen, no safe level (WHO); DKA precipitant with SGLT2i; NICE refeeding risk factor | [99][44][8] | B |
| HC-M11 | caffeine | ≤ **400 mg/d**, ≤ **200 mg** per dose | any | daily | CLIP | EFSA 2015 and FDA | [94][95] | A/B |
| HC-M12 | creatine | maintenance ≤ 5 g/d (3–5 typical); loading ≤ 0.3 g/kg/d for ≤ 7 d; disabled if kidney flag | any | daily | CLIP | ISSN: safe up to 30 g/d for 5 y in healthy people | [96] | B |
| **Fasting (detail §4.3)** | | | | | | | | |
| HC-F1 | fast length (h with ≤ 50 kcal) | per tier: T0 ≤ 20 h (see HC-F5); T1 20–24 h **default-allowed**; T2 24–48 h **opt-in**; T3 48–72 h **opt-in + upgraded eligibility**; T4 3–7 d **expert mode only** (clinician-supervision attestation); T5 > 7 d **never** | fasting | per fast | REQUIRE_OPTIN / REJECT | Supervised water-only stays: any AE ≥ grade 3 by day 5/10/15 = 20/28/32 %; SAEs (dehydration d3, hyponatraemia d9) in men aged 73/70 | [12][11][13] | C |
| HC-F2 | spacing / frequency | T1 ≤ 3 non-consecutive per wk; T2 ≤ 3/wk if ≤ 36 h, ≤ 2/wk if 36–48 h, ≥ 24 h eating between; T3 ≥ 7 d gap and ≤ 2 per 30 d; T4 ≥ 28 d gap and ≤ 1 per 12 wk; `fastH_7` ≤ 108 h; weekly mean intake still ≥ HC-E1 | fasting | 7–90 d | REJECT | ADF every other day (36-h fasts) for 4 wk without adverse effects in healthy non-obese adults; remainder `PROPOSED` | [16] | B/D |
| HC-F3 | refeeding after fast | T2: moderate first meal; T3: 2-d ramp (≈ 50 % then 80–100 % of maintenance); T4: ≥ max(4 d, 0.5 × fast days) ramp 50/50/75/100 %, thiamine ≥ 200 mg/d ×5 d + multivitamin | fasting ≥ 48 h | post-fast | INSERT ramp | NICE: intake ≈ 0 for > 5 d → ≤ 50 % of requirements first 2 d; thiamine 200–300 mg/d; medically supervised stays refed for ½ fast length; ASPEN: negligible intake > 7 d = significant refeeding risk | [8][12][10] | C/D |
| HC-F4 | exercise on fasting days | T1: no maximal efforts in last 4 h; T2: light–moderate, no HIIT; T3–T4: light walking ≤ 60 min, no RT | fasting | fast | CLIP | 24-h fast cut high-intensity cycling time-to-fatigue (hypoglycaemia); 3.5-d fast: strength −10 %, HR ↑ at 45 % VO2max; supervised programs minimise activity | [20][19][12][11] | C |
| HC-F5 | daily eating window | ≥ 6 h by default; 4 to < 6 h opt-in; < 4 h (incl. single-meal patterns) never in Planner; protein/energy floors (HC-E1, HC-M1) must be met inside the window; R1: window ≥ 12 h | any daily-window regime | daily | REJECT / REQUIRE_OPTIN | Studied daily restriction ranges (18–20 h/d fasting) exist in diabetes/IF literature but safety of very short windows is unsourced; hard to meet protein/fibre/micronutrient needs; ED risk (`PROPOSED`) | [47][17] | D |
| **Exercise** | | | | | | | | |
| HC-X1 | weekly run distance (novice, < 6 mo consistent running) | week-on-week increase ≤ **30 %** (start walk–run) | running | 2 wk | CLIP | > 30 % progression → HR 1.59 (0.96–2.66) for distance-related injuries; the "10 % rule" did not reduce injuries in an RCT (n = 532) | [89][90][91] | C |
| HC-X2 | resistance training (novice) | 2–3 d/wk; 8–12 RM loads; load steps 2–10 %; ≤ 10 hard sets/muscle/wk at start, ≤ +2 sets/wk (`PROPOSED`) | RT | wk | CLIP | ACSM position stand | [88] | B/D |
| HC-X3 | exercise volume ramp (sedentary start) | initial ≤ 150 min/wk moderate-equivalent; increases ≤ 30 %/wk (`PROPOSED`); ≥ 1 full rest day/wk | exercise | wk | CLIP | WHO ≥ 150 min/wk target; Nielsen 30 % | [93][89] | D |
| HC-X4 | exercise clearance | any PAR-Q+-style flag → light–moderate only; vigorous requires clinician-cleared attestation | exercise | profile | RESTRICT | ACSM screening: current activity, symptoms/known disease, intended intensity | [87][86] | B |
| HC-X5 | heat | if "hot climate/indoor heat" flag: no vigorous outdoor sessions; hydration to thirst | exercise | session | CLIP | ACSM heat-illness position stand | [92][65] | C |
| **Goal handling** | | | | | | | | |
| HC-G1 | infeasible goals | if the requested goal or date needs any bound violated → refuse, show earliest feasible date and the binding constraint(s) | always | plan | REJECT | Honary: apps should stop underweight/unrealistic goals and explain why | [77] | D |
| HC-G2 | priority conflicts | safety constraints outrank user goal rank; never trade a hard bound for a higher-ranked goal | always | plan | REJECT | Brief principle 5 | — | — |

### 2.3 Parametrised functions (`PROPOSED FIT`)

**Deficit cap** `cap_def(BMI, age, BF%)` (percent of `TDEE_7`):

```
cap = 25
if BMI >= 30: cap = 30
if BMI < 25:  cap = 20
if age >= 65: cap = min(cap, 15)
if BF% <= BFfloor + 4: cap = min(cap, 10)
```

Data points used: AHA "30 % deficit" option [6]; CALERIE 25 % target in BMI 25.1 adults [26]; Garthe slow arm 19 %/fast arm 30 % in lean athletes [4]; MATADOR 33 % in BMI ≈ 34 men in 2-wk blocks [24]; Longland ≈ 40 % for 4 wk in young trained men (not adopted: short, supervised) [54]; 5:2 weekly mean 25 % [18].

**Rate cap** `cap_pct(BMI, BF%)` (percent BW per week; also ≤ 1.5 kg/wk):

```
cap_pct = 0.75                                        # default (Garthe 0.7 %/wk best arm; Helms 0.5-1 %)
if BF% <= BFfloor + 6: cap_pct = 0.5                  # leaner -> slower (M <= 16 %, F <= 24 %)
if BMI >= 30 or BF% >= (30 if male else 40): cap_pct = 1.0
# also: rate <= 1.5 kg/wk always; age 65-74 -> min(cap_pct, 0.5)
```

Data points: Weinsier 1.5 kg/wk [29]; Helms 0.5–1 %/wk, with leaner competitors dieting for shorter periods and more gradually towards the end [5]; Garthe 0.7 vs 1.4 %/wk [4]; Purcell rapid arm aimed at 15 % in 12 wk (≈ 1.25 %/wk, supervised trial) [28] (not adopted).

**Energy-availability zones** (for warnings/metrics): `≥ 45` adequate; `30–45` reduced (acceptable for fat loss, short-term); `< 30` problematic [1].

### 2.4 Engine interface sketch (for dossier 18)

```ts
type Severity = 'info' | 'caution' | 'danger';
type Action = 'BLOCK_APP'|'BLOCK_PLANNER'|'RESTRICT'|'CLIP'|'REJECT'|'INSERT_BREAK'|'REQUIRE_OPTIN';
interface HardConstraint {
  id: string;                       // 'HC-E1'
  window: 'profile'|'daily'|'7d'|'14d'|'block'|'plan'|'per-fast';
  applies: (p: Profile, plan: PlanDay[], t: number) => boolean;
  check:   (p: Profile, plan: PlanDay[], t: number) => { ok: boolean; clipTo?: number; binding?: string };
  action: Action;
  grade: 'A'|'B'|'C'|'D'; proposed: boolean; refs: number[];
}
// Planner loop: candidate -> for each day t evaluate all applicable constraints -> CLIP if possible else REJECT.
// Return to UI the binding constraint ids so the explanation ("why can't I go faster?") is exact.
```

Constraints are evaluated on the **modelled** trajectory (dossiers 01–05), not on user-entered targets, because glycogen/water transients and metabolic adaptation change `TDEE_7`, `EA_7` and `rate_14`.

### 2.5 Constants (single source of truth; mirror in `src/engine/safety/params.ts`)

```yaml
# Every value below is defined in the §2.2 table; PROPOSED values are marked.
version: 1
energy:
  floor_kcal_per_day: { female: 1200, male: 1500 }          # 7-d mean (HC-E1)
  restricted_day: { band_upper_kcal: { female: 1000, male: 1200 }, min_kcal: { female: 500, male: 600 }, max_per_7d: 2, consecutive: false }
  deficit_cap_pct: { default: 25, bmi_ge_30: 30, bmi_lt_25: 20, age_ge_65: 15, lean_within_4pts_of_bf_floor: 10 }   # PROPOSED shape
  ea_kcal_per_kg_ffm: { hard_min: 30, adequate_ge: 45 }
  rate_cap_pct_bw_per_wk: { default: 0.75, lean_within_6pts_of_bf_floor: 0.5, high_adiposity: 1.0, age_65_74: 0.5 }  # PROPOSED shape
  rate_cap_abs_kg_per_wk: 1.5
  cum_loss_max_pct: 20
  deficit_blocks: { high: { threshold_pct: 15, max_weeks: 12, break_weeks_min: 1, break_weeks_default: 2 },
                    moderate: { range_pct: [5, 15], max_weeks: 26, break_weeks_min: 2 } }
  surplus: { max_pct_of_tdee: 120, gain_pct_bw_per_wk_max: 0.5, gain_pct_bw_per_wk_max_if_whtr_0_5_to_0_59: 0.25,
             block_if: { waist_cm: { male: 102, female: 88 }, whtr_ge: 0.6, bmi_ge: 30 } }
body:
  bmi: { underweight: 18.5, start_deficit_min: 20.0, projected_min: 19.0 }        # margins PROPOSED
  bf_floor_pct: { male: 10, female: 18 }                                          # PROPOSED
  bf_warn_pct: { caution: { male: 12, female: 20 }, danger: { male: 8, female: 15 } }
macros:
  protein: { floor_g_per_kg_rw: 0.8, floor_deficit_or_age65_g_per_kg_rw: 1.2, floor_age65_maintenance: 1.0,
             cap_pct_energy: 35, cap_g_per_kg_ffm: 3.1, soft_cap_g_per_kg_rw: 2.2, ckd_risk_cap_g_per_kg_rw: 1.3 }
  fat: { min_pct_energy: 15, min_g_per_day: 30, fat_meal_min_g: 10, la_min_pct_e: 2, ala_min_pct_e: 0.25 }
  carbs: { ketogenic_range_g_net: 50, max_block_weeks: 12 }
  fibre_g_per_1000kcal_soft: 14
  sodium_g: { typical: [1.5, 2.3], fasting_t3_t4_or_first_14d_vlc_max: 4.0, hard_min: 1.0 }
  potassium_supplement_g_max: { default: 1.0, t4_optin: 2.0 }
  magnesium_supplement_mg_max: 350
  fluid_l: { beverage_min: 1.5, max: 4.0, max_per_hour: 1.0, fasting_min: 2.0 }
  caffeine_mg: { per_day_max: 400, per_dose_max: 200 }
  creatine_g: { maintenance_max: 5, loading_g_per_kg_day: 0.3, loading_max_days: 7 }
fasting:
  zero_energy_kcal_per_day_max: 50
  daily_window_h: { default_min: 6, optin_min: 4, never_below: 4, r1_min: 12 }
  fast_h_7d_max: 108
  tiers:                      # hours of zero-energy fasting
    T0: { max_h: 20 }
    T1: { max_h: 24, permission: default, max_per_week: 3, consecutive: false, min_eating_gap_h: 24 }
    T2: { max_h: 48, permission: optin, bmi_min: 20, max_per_week: { le_36h: 3, gt_36h: 2 }, min_eating_gap_h: 24 }
    T3: { max_h: 72, permission: optin_plus, bmi_min: 22, bf_min_pct: { male: 15, female: 25 }, min_gap_days: 7, max_per_30d: 2 }
    T4: { max_h: 168, permission: expert_mode, bmi_min: 25, min_gap_days: 28, max_per_12wk: 1, max_per_year: 4 }
    T5: { permission: never }
    V:  { eff_kcal: [400, 800], permission: expert_mode, bmi_min: 30, max_block_days: 14, min_gap_days: 14, protein_g_per_kg_ibw: [1.2, 1.5] }
  age_max_tier: { '65_74': T1 }
  refeed: { T3: { days: 2, pct_of_maintenance: [50, [80, 100]] },
            T4: { days_min: 4, days_rule: 'max(4, ceil(0.5*fast_days))', pct_of_maintenance: [50, 50, 75, 100], thiamine_mg_per_day: 200, thiamine_days: 5 } }
  sodium_g_per_day: { T2_ge_36h: [1.5, 2.5], T3: [2.0, 3.0], T4: [2.0, 3.0] }
  fluid_l_per_day: [2.0, 3.0]
exercise:
  run_weekly_distance_increase_max_pct: 30
  rt_novice: { sessions_per_week: [2, 3], rm_range: [8, 12], load_step_pct: [2, 10], hard_sets_per_muscle_start_max: 10, sets_increase_per_week_max: 2 }
  sedentary_start_min_per_week_max: 150
  volume_increase_per_week_max_pct: 30
  rest_days_per_week_min: 1
  fasting_day_caps: { T1: no_maximal_last_4h, T2: light_moderate, T3: walk_le_60min, T4: walk_le_60min }
```

---

## 3. Simulator WARNING rules (deliverable b)

The Simulator may run any regime. It evaluates all rules below on the **modelled** trajectory and shows the highest severity per day/block on the timeline plus a summary list. `danger` requires an explicit acknowledgement checkbox ("I understand this is a simulation, not a recommendation") before results render; `caution` is inline; `info` is collapsible. Message text is ≤ 200 characters **including** placeholders `{…}`; wording follows §4.5 (no moralising, no diagnosis, no guarantees). "Src" = §11 numbers. Severity thresholds that are `PROPOSED` are marked †.

| ID | Trigger | Severity | Message (≤ 200 chars) | Src |
|---|---|---|---|---|
| **Energy, rate, body size** | | | | |
| W-E01 | `EI_7` < floor (1200 F / 1500 M) and ≥ 800 | caution | Your average intake ({EI} kcal/day) is below the {floor} kcal/day usually treated as the minimum without professional support. This is a simulation, not advice. | [6][7] |
| W-E02 | `EI_7` < 800 for ≥ 3 days, not a T1–T4 fast | danger | Under 800 kcal/day is a very-low-energy diet: guidelines say medical supervision only, for up to 12 weeks. Serious heart-rhythm problems were reported with prolonged use. | [6][7][38] |
| W-E03 | `deficit_pct_7` > cap (default 25 %) and ≤ 40 % † | caution | Your deficit is {d}% of maintenance. Above about {cap}% the model shows more muscle loss and stronger hunger and hormone effects. Real-world results vary. | [6][4][26] |
| W-E04 | `deficit_pct_7` > 40 % † | danger | A deficit over 40% of maintenance is beyond what is usually studied outside clinical or research supervision. The projection is for an average person; individual risk is higher. | [54][4] |
| W-E05 | `rate_14` > cap_pct and ≤ 1.5 kg/wk | caution | You would lose about {r}% of body weight per week. Slower loss (about {cap}%/week) protects muscle and lowers the risk of gallstones, hair shedding and fatigue. | [29][5][4][35] |
| W-E06 | `rate_14` > 1.5 kg/wk | danger | Losing more than 1.5 kg (3.3 lb) a week sharply raises gallstone risk in studies, alongside faster muscle loss. Consider a slower pace or medical supervision. | [29][31] |
| W-E07 | `EA_7` in 30–35 for > 14 d † | caution | Energy left after exercise is about {EA} kcal/kg lean mass/day. Staying near 30 for weeks can disturb hormones, bone and recovery. Eat more or train less to move up. | [1][2][3] |
| W-E08 | `EA_7` < 30 | danger | Energy left after exercise is {EA} kcal/kg lean mass/day, below the ~30 level linked to reproductive-hormone and bone changes in lab studies. Not sustainable for health. | [2][3][1] |
| W-E09 | `EA_7` 35–45 | info | Energy availability is {EA} kcal/kg lean mass/day. Values of 30–45 are "reduced": acceptable for a short fat-loss phase, not for months. | [1] |
| W-E10 | continuous deficit ≥ 15 % for > 12 wk † | caution | You have been in a deficit of 15% or more for {n} weeks. A 1–2 week maintenance break is a common safeguard and did not reduce fat loss in trials. | [25][24][7] |
| W-E11 | `cum_loss` > 20 % | caution | Total loss so far is {x}% of your starting weight. Losses above about 20–25% carry higher risk of gallstones, muscle loss and nutrient shortfalls. | [31][70] |
| W-E12 | `cum_loss` > 24 % | danger | Losing more than 24% of body weight is linked with gallstones and, in the Minnesota semi-starvation study, anaemia, weakness, oedema and low mood. Please involve a clinician. | [31][70] |
| W-E13 | projected BMI < 20 (≥ 18.5) † | caution | This plan takes your BMI to {bmi}, close to the underweight range (below 18.5). Consider a goal at or above 20 and how your body-fat input may be off by a few points. | [7][77][69] |
| W-E14 | BMI < 18.5 on any day | danger | A BMI below 18.5 is the underweight range, linked with bone, hormone and other health problems. If this is your real weight or goal, please speak with a clinician. | [7][1][77] |
| W-E15 | est. BF% < 12 (M) / 20 (F) † | caution | Estimated body fat ({bf}%) is low. Very lean phases lowered hormones, mood and strength in studies; your body-fat input may also be off by about ±4 points. | [66][67][69] |
| W-E16 | est. BF% < 8 (M) / 15 (F) † | danger | Estimated body fat ({bf}%) is in a range where studies show large hormone, heart-rate and mood changes. Sustained levels this low are not advised without medical support. | [66][67][68] |
| W-E17 | `rate_14` ≥ 0.75 %/wk for ≥ 8 wk † | info | Fast weight loss can trigger temporary hair shedding a few months later (mean loss 15% at ~3.5 kg/month in one clinic series). It usually grows back. | [35][36][7] |
| W-E18 | sex = F and (`EA_7` < 45 for ≥ 4 wk or BF% < 20) † | caution | Lighter, irregular or missing periods are an early sign intake is too low for your activity. If that happens, eat more and see a clinician; this simulator cannot assess it. | [2][67][1] |
| W-E19 | deficit ≥ 15 % > 26 wk or `EA_7` < 45 > 12 wk † | info | Prolonged calorie restriction lowers bone density slightly (hip −0.01 to −0.015 g/cm² in trials). Exercise helps limit the loss. | [27][26][49] |
| W-E20 | `EA_7` < 30 for > 14 d | caution | Low energy availability has been linked with more illness and lost training days in athletes. The model cannot predict your individual immune response. | [1] |
| **Macronutrients, fluids, substances** | | | | |
| W-M01 | protein < 0.8 g/kg RW | caution | Protein of {p} g/kg is below the 0.8 g/kg adult minimum (RDA). Muscle loss is likely over time. | [53] |
| W-M02 | protein < 1.2 g/kg RW and (deficit > 10 % or RT) | info | In a deficit, {p} g/kg protein is low for keeping muscle. Trials use 1.2–2.4 g/kg, higher when you are leaner or training hard. | [54][55][57] |
| W-M03 | protein > 35 % E | danger | Protein above 35% of energy risks nausea and excess ammonia and crowds out other nutrients. A suggested ceiling is about 25% of energy. | [58] |
| W-M04 | protein > 3.1 g/kg FFM | caution | Protein above 3.1 g/kg lean mass is beyond the range studied in lean dieting athletes; benefits beyond it are unproven. | [55][57] |
| W-M05 | protein > 1.3 g/kg RW and CKD-risk flag | danger | With kidney disease, guidelines advise about 0.8 g/kg and avoiding above 1.3 g/kg. Please check with your kidney team before a high-protein plan. | [51] |
| W-M06 | fat < 15 % E or < 30 g/d (EI ≥ 800) | caution | Fat is {f} g/day. During faster weight loss, too little fat is linked to gallstones; include some fat at main meals (aim for at least 10 g). | [33][34][31] |
| W-M07 | fat < 10 g/d for ≥ 7 d | danger | Very low fat during rapid weight loss caused gallstones in 4 of 6 people in one trial, and essential fatty-acid needs go unmet. Add fat, or slow the loss. | [33][62] |
| W-M08 | net carbs < 50 g/d (ketosis begins) | info | Below ~50 g net carbs the model enters ketosis. Expect 2–4 weeks of "keto flu" (tiredness, headache), more urination and salt loss; keep fluids and sodium up. | [43][21][60] |
| W-M09 | net carbs < 50 g/d for ≥ 4 wk | caution | After 4 weeks of very-low-carb, LDL cholesterol rose in all 17 healthy women in one trial (+1.8 mmol/L). Consider a lipid blood test after 8–12 weeks. | [46] |
| W-M10 | net carbs < 50 g/d and any of: pregnant/breastfeeding, SGLT2i/insulin, T1D, pancreatitis, fat-oxidation disorder, porphyria, underweight, ED flag | danger | Very-low-carb eating can be dangerous with insulin or SGLT2 drugs, pancreatitis, fat-metabolism disorders, porphyria, pregnancy or breastfeeding. Not without your clinician. | [42][43][44][45] |
| W-M11 | fibre < 14 g/1000 kcal for > 4 wk | info | Fibre is {x} g per 1000 kcal (target 14+). Low fibre with low intake can mean constipation and missing micronutrients. | [113][59] |
| W-M12 | sodium < 1.5 g/d during fasting or net carbs < 50 g | caution | Salt loss is greatest on days 1–4 of fasting or very-low-carb eating (up to ~2.3–3.4 g sodium/day). Too little sodium can cause dizziness, headache and fainting. | [13][21] |
| W-M13 | sodium > 2.3 g/d for > 4 wk (no fasting/keto/sweat exception) | info | Sodium above 2.3 g/day over months is linked with higher long-term cardiovascular risk in the national reference intakes. | [60] |
| W-M14 | fluids < 1.5 L/d | caution | Your fluid intake looks low. Total water of about 2.0 L (women) or 2.5 L (men) a day, including food, is the EU adequate intake. Less can worsen headaches and dizziness. | [59] |
| W-M15 | fluids > 4 L/d or > 1 L/h | caution | Very high fluid intake can dilute blood sodium (confusion, seizures). Drink to thirst. One supervised water-only fast ended in hospital this way. | [65][12] |
| W-M16 | supplemental potassium > 1 g/d | caution | High-dose potassium supplements can cause dangerous heart-rhythm problems, especially with kidney disease or some blood-pressure medicines. Do not use without medical advice. | [60] |
| W-M17 | supplemental magnesium > 350 mg/d | info | Magnesium supplements above 350 mg/day commonly cause diarrhoea; that is the tolerable upper level for supplements. | [61] |
| W-M18 | alcohol > 14 units/wk | caution | More than 14 units of alcohol a week is above UK low-risk guidance; WHO says no level of alcohol is completely safe. | [97][99] |
| W-M19 | alcohol on a fast ≥ T2 day, on a < 800 kcal day, or within 24 h of a T3+ fast | danger | Alcohol during fasting or very-low-energy eating adds risks (ketoacidosis with some diabetes drugs; refeeding problems after long fasts). Avoid it on these days. | [44][8] |
| W-M20 | > 2 standard drinks on one occasion | caution | More than 2 standard drinks on one occasion is linked with more injuries and other harms, whatever your weekly total. | [98] |
| W-M21 | caffeine > 400 mg/d or > 200 mg/dose | caution | Caffeine above 400 mg/day (about 4 cups of coffee), or 200 mg at once, is beyond what EFSA and FDA consider safe for most adults. | [94][95] |
| W-M22 | caffeine ≥ 100 mg within 6 h of bedtime | info | Even 100 mg of caffeine close to bedtime can shorten and disturb sleep in some adults. | [94] |
| W-M23 | creatine > 5 g/d maintenance or loading > 7 d | info | Creatine maintenance is 3–5 g/day; loading (about 0.3 g/kg/day) is used for up to a week. If you have kidney disease, ask your clinician first. | [96] |
| W-M24 | net carbs < 50 g/d and (kidney-stone history or fluids < 2.5 L/d) † | caution | Ketogenic eating can raise kidney-stone risk (about 2.5–4% of children on medical ketogenic diets). Drink plenty of fluids, and ask a clinician first if you have had stones. | [42][43] |
| **Fasting and very-low-energy patterns (detail §4.3)** | | | | |
| W-F01 | fast T1 (20–24 h) | info | Fasts up to 24 h were well tolerated in healthy adults in trials. Skip fasting if you take diabetes or blood-pressure medicine, are pregnant, or have had an eating disorder. | [17][47][43] |
| W-F02 | fast T2 (24–48 h) | caution | Fasts of 24–48 h can cause lightheadedness, headache and low energy. Keep drinking, add salt, keep exercise light, and stop if you feel faint or unwell. | [12][13][16] |
| W-F03 | fast T3 (48–72 h) | caution | In medically supervised water-only fasts, near-fainting occurred in about 28% of stays and raised blood pressure in 29%. Plan salt and fluids, tell someone, and ease back into eating. | [12] |
| W-F04 | fast T4 (3–7 d) | danger | Water fasts of 3–7 days are studied under medical supervision (serious events ~20% by day 5). Risks: fainting, arrhythmia, low sodium, gout, refeeding problems. Not to be attempted alone. | [12][11][13] |
| W-F05 | fast T5 (> 7 d) | danger | Fasts beyond 7 days carry serious risks, including low sodium and heart-rhythm problems; deaths were reported in historical prolonged-fasting programs. Medical supervision only. | [12][13] |
| W-F06 | fast ≥ 48 h without sodium and fluid plan | caution | No salt or fluid plan for this fast. Sodium loss peaks around days 3–4 (about 2.3–3.4 g/day); plain water alone risks low blood sodium. Consider ~2–3 g sodium/day and 2–3 L fluid. | [13][12] |
| W-F07 | spacing rule HC-F2 violated (simulator) | caution | These fasts are closer together than the model's recovery assumptions allow (glycogen, protein and salt balance). Results after this point are less reliable. | [16] |
| W-F08 | fast ≥ 72 h and no refeeding ramp | danger | After fasting over 3 days, restart food gradually (about half your usual energy for the first 2 days). Big meals raise refeeding-syndrome risk (low phosphate, potassium, magnesium). | [8][9] |
| W-F09 | hard exercise on a fasting day ≥ 24 h | caution | Hard exercise while fasting cut endurance and risked low blood sugar in studies; arm strength fell ~10% after 3.5 days. Keep long-fast days light. | [20][19] |
| W-F10 | fast ≥ T3 and BMI < 25 (or lean-mass flag) † | caution | Long fasts have mostly been studied in people with excess body fat; leaner people lose more muscle and have less reserve. | [13][11] |
| W-F11 | fast ≥ T3 | info | Fasting raises blood uric acid (about +46% in a 4–21-day cohort), which can trigger gout attacks or kidney stones in people prone to them. | [11][13] |
| W-F12 | block with EI < 800 kcal and protein-focused (PSMF-like) | danger | This is a very-low-energy "protein-sparing" pattern. Real programs add vitamins and minerals, drink 2+ L water, use supervision and stop within about 12 weeks. | [41][7][38] |
| W-F13 | ≥ 3 fasts ≥ T2 in 14 d or `fastH_7` > 108 h | caution | You are fasting most of the week. Studied alternate-day plans ran 4 weeks in healthy adults; longer or heavier patterns lack safety data. | [16] |
| W-F14 | daily eating window < 4 h (or single meal/day) † | caution | A daily eating window under 4 hours makes it hard to reach protein, fibre and micronutrient needs and can worsen dizziness or binge urges. Consider a longer window. | [47][17] |
| **Exercise** | | | | |
| W-X01 | novice weekly run distance increase > 30 % | caution | Weekly running distance rises {x}%. Beginners who added more than ~30% had higher injury rates (HR ≈ 1.6). Increase by less than 30% a week. | [89] |
| W-X02 | novice RT: > 10 sets/muscle/wk at start or > +2 sets/wk † | info | Big jump in weekly training sets. Guidelines suggest 2–3 sessions a week for beginners and load steps of 2–10%. | [88] |
| W-X03 | no full rest day for ≥ 14 d † | info | No full rest day for {n} days. Plan at least one rest day a week; the model assumes recovery time. | `PROPOSED` |
| W-X04 | hot-climate flag and vigorous outdoor session | caution | Hot conditions raise heat-illness risk, especially if dehydrated, not acclimatised or on some medicines. Lower the intensity, drink to thirst, stop if dizzy or confused. | [92][65] |
| W-X05 | PAR-Q-style flag and vigorous exercise | danger | Your screening answers suggest getting clinician clearance before vigorous exercise. This simulation assumes an otherwise healthy adult. | [87][86] |
| **Surplus and metabolic markers** | | | | |
| W-S01 | gain rate > 0.5 %BW/wk | caution | Weight gain of {g}%/week is faster than the ~0.25–0.5%/week used for lean gain; the extra is mostly fat in the model. | [64] |
| W-S02 | surplus > 20 % for > 12 wk | info | A surplus above ~20% for months mostly adds fat, not muscle, in the model. | [64] |
| W-S03 | waist > 102 cm (M) / 88 cm (F) or WHtR ≥ 0.5 with planned gain | caution | Waist above {102/88} cm (or over half your height) is linked with higher cardiometabolic risk. Gaining more is not advised; consider talking to a clinician. | [6][7] |
| **Population / medication context** | | | | |
| W-P01 | pregnant or breastfeeding and any deficit, fast or net carbs < 100 g | danger | This tool is not designed for pregnancy or breastfeeding. Dieting, fasting and very-low-carb eating are not advised without your clinician. | [43][101][45] |
| W-P02 | mode R1 and any restrictive regime | danger | You told us eating or weight can be a struggle. Restrictive plans can make that harder. Support is available (see the help card). You deserve care at any weight. | [7][74][75] |
| W-P03 | age ≥ 65 and (deficit > 15 % or fast > T1) | caution | For adults over 65, faster loss costs more muscle and bone. Guidelines favour smaller deficits, ≥ 1.0–1.2 g/kg protein and strength training. | [48][49][12] |
| W-P04 | diabetes medicine flag and any restriction | danger | Diabetes medicines (insulin, sulfonylureas, SGLT2 inhibitors) can cause low blood sugar or ketoacidosis with fasting, low-carb eating or big deficits. Ask your clinician first. | [44][47] |
| W-P05 | heart / BP / kidney / liver flag and fast > T1, deficit > 15 % or net carbs < 100 g | caution | With heart, blood-pressure, kidney or liver conditions, fasting, big deficits and very-low-carb eating can be risky. Please speak with your clinician first. | [43][51][12] |
| W-P06 | gout / kidney-stone / gallstone flag and fast ≥ T2 or net carbs < 50 g or rate > 0.75 %/wk | caution | Fasting, ketosis and rapid loss can raise uric acid and stone risk. If you have gout, kidney stones or gallstones, please check with your clinician first. | [13][11][29][43] |
| W-P07 | medication flag (diuretic, ACEi/ARB, lithium, QT-prolonging, chemotherapy) and fast > T1 or net carbs < 50 g | caution | Some medicines interact with fasting, dehydration and salt shifts (blood pressure, potassium, lithium levels). Ask your clinician or pharmacist before changing how you eat. | [43][8][23][22] |
| **Model uncertainty and outputs** | | | | |
| W-U01 | always (results header) | info | Projection for an average person with your inputs. Individual results vary widely, in either direction. Not medical advice. | [110][111] |
| W-U02 | inputs outside model-development range (e.g. BMI > 45, age > 70, EI < 500 for > 7 d) † | caution | Your inputs are outside the ranges studied to build this model, so the projection is an extrapolation with low confidence. | [110] |
| W-U03 | BF%/muscle from sliders | info | Body-fat and muscle inputs from sliders can be off by about ±4 percentage points; outputs that depend on them inherit that error. | [69] |
| W-U04 | blood-marker outputs shown (LDL, glucose, insulin sensitivity…) | info | Blood-marker curves are model trends for an average person, not lab predictions. They cannot diagnose or rule out any condition. | [103] |
| W-U05 | autophagy / longevity outputs shown | info | Autophagy and longevity-signal curves are exploratory: human evidence is limited. Please do not treat them as proven health benefits. | [107] |

**Persistent banner for every `caution`/`danger` scenario** (≤ 200 chars): *"Stop and get help if you feel faint, have chest pain or an irregular heartbeat, are confused, keep vomiting, or have severe headache, cramps or abdominal pain."* (`PROPOSED` from the adverse-event profiles in [11][12]; 159 chars).

Message-length check for this table is scripted: see the end of §7.

---

## 4. Gates, populations, fasting tiers, medications, ED safeguarding, regulatory framing

### 4.1 Onboarding gate specification (deliverable c)

**Design rules.** ≤ 3 screens (< 60 s); plain, non-diagnostic language ("this isn't a diagnosis — it helps us pick safe defaults"); every item has "Prefer not to say"; the screen runs once before *either* feature and again (planner-specific items only) before the first prescription; results are stored **on device as flags only** — `{mode, flags[], clearedAt}` — never the raw answers; clearance expires after 12 months (PAR-Q+ clearance is valid for max 12 months and lapses if health changes [86]) and is re-asked when age, weight/BMI category, medication or health status changes. Item wording below is **original / adapted** — PAR-Q+ is © the PAR-Q+ Collaboration and SCOFF is a published instrument; if you want either verbatim, obtain permission/confirm licence, and note that adapting SCOFF item 4 (below) means its validation figures do not transfer.

| ID | Item (draft wording) | Response | Mapping | Basis |
|---|---|---|---|---|
| Q1 | How old are you? | number | < 18 → `BLOCK_APP` (resource page). 65–74 → mode `R2-age` (HC-P8). ≥ 75 → HC-P9 | [71][73][48][49] |
| Q2 | Are you pregnant or breastfeeding, or planning a pregnancy in the next few months? | pregnant/breastfeeding / planning / no / prefer not | pregnant or breastfeeding → `BLOCK_PLANNER`; planning → `R2` (no deficit, no fasting > T1); prefer-not → treated as "no" but shows the notice | [43][101][2] |
| Q3 | Have you ever been diagnosed with, or treated for, an eating disorder? | yes / no / prefer not | yes or prefer-not → `R1` | [7][75] |
| Q4 | Do you make yourself sick (vomit) because you feel uncomfortably full, or to control your weight? *(adapted from SCOFF "S")* | yes/no | +1 | [78][79] |
| Q5 | Do you worry that you have lost control over how much you eat? *(SCOFF "C")* | yes/no | +1 | [78] |
| Q6 | In the last 3 months, have you lost more than 6 kg (13 lb) without meaning to, or through very strict dieting? *(SCOFF "O"; "one stone" ≈ 6.35 kg → 6 kg)* | yes/no | +1 | [78] |
| Q7 | Do you believe you are fat when other people say you are too thin? *(SCOFF "F")* | yes/no | +1 | [78] |
| Q8 | Would you say food dominates your life? *(SCOFF "F")* | yes/no | +1; **score ≥ 2 → `R1`** | [78][79] |
| Q9 | Do you have diabetes, or take any medicine to lower blood sugar? → if yes: insulin / sulfonylurea or meglitinide / SGLT2 inhibitor / metformin only / GLP-1-type or other injection / diet only | select | insulin, sulfonylurea/meglitinide, SGLT2i, any type 1 → `BLOCK_PLANNER` (HC-P6). Others → `R2` | [44][47] |
| Q10 | Has a doctor ever said you have a heart condition, high blood pressure, kidney disease, liver disease, or that you have had a stroke? *(PAR-Q+ Q1 topics + renal/hepatic)* | yes/no | `R2` | [86][51][87] |
| Q11 | Do you regularly take prescription medicines for a long-term condition (for example blood-pressure or "water" tablets, lithium, blood thinners, seizure medicines, steroids)? → class picker (§4.4) | yes/no + list | `R2` + medication rules | [86][43] |
| Q12 | Do you have gout, kidney stones, gallstones, pancreatitis, or a rare metabolic condition (for example porphyria, or a carnitine / fat-oxidation disorder)? | yes/no + list | `R2` + rule-specific blocks (§4.2) | [42][43][13] |
| Q13 | In the past 12 months have you fainted or lost consciousness, felt chest pain, or felt so dizzy you lost your balance? *(PAR-Q+ Q2–Q3 topics)* | yes/no | `R2` (no vigorous exercise; no fasting > T1) | [86][12] |
| Q14 | Do you have a bone, joint or muscle problem that more exercise could make worse? *(PAR-Q+ Q6 topic)* | yes/no | exercise volume/impact restricted | [86] |
| Q15 | Has a doctor ever said you should only exercise under medical supervision? *(PAR-Q+ Q7 topic)* | yes/no | no exercise prescriptions; `R2` | [86] |
| Q16 | Do you drink heavily, or has anyone said alcohol is a problem for you? *(optional)* | yes/no/prefer not | yes → no fasting > T1, no VLED (alcohol history is a refeeding-risk factor; DKA precipitant) | [8][44] |
| Q17 | *(derived)* BMI; optional waist; estimated BF% | — | BMI < 18.5 → "no deficit; consider speaking to a clinician"; HC-P4/P5 | [7][77] |
| Q18 | *(age ≥ 65 only)* SARC-F: difficulty lifting/carrying 4.5 kg; walking across a room; rising from a chair; climbing 10 stairs; number of falls in past year | 0–10 | score ≥ 4 → HC-P9 | [50] |
| Q19 | *(at fasting opt-in only)* In the last 4 weeks: vomiting/diarrhoea/fever, surgery, or acute infection? | yes/no | yes → fasting > T1 blocked for 4 weeks | [12] |

**Branching → mode.** Highest-priority outcome wins: `BLOCK_APP` > `BLOCK_PLANNER` > `R1` > `R2` > `M0`. `R1` and `R2` can co-occur (intersection of restrictions).

**Should we include a SCOFF-like gate? — recommendation: yes, for the Planner, as a *risk flag* not a verdict, alongside universal safeguards.**
* *For:* five items, memorable, free of clinical jargon; original validation Se 100 % / Sp 87.5 % (≥ 2 "yes") in a case-control sample [78]; meta-analysis of 25 studies pooled Se 0.86 (0.78–0.91), Sp 0.83 (0.77–0.88) [79]; calorie-tracking apps are used by ~75 % of people with EDs in one clinical sample, 73 % of users say the app contributed to their ED, and use is associated with more restraint and eating concern in students and men [74][75][76].
* *Against:* pooled sensitivity is lower in men, in binge-eating disorder and in community samples, and the authors conclude there is not enough evidence to use SCOFF to screen the full DSM-5 range in community settings [79]; validity varies with age and body weight and the 22-item EDE-Q performed somewhat better (Se 0.80 / Sp 0.80 at global ≥ 2.8) [80]; a client-side gate can be re-taken until passed.
* *Therefore:* (i) combine SCOFF with the explicit history item (Q3) and treat "prefer not to say" as positive for Planner restrictions; (ii) apply **universal** safeguards to everyone (BMI/BF floors, no numeric "earn/burn" framing, rate caps, help card) because ≈ 1 in 7 true cases screen negative; (iii) never display the word "positive" or imply a diagnosis; say "we've set gentler defaults for you — you can change them with a clinician's advice"; (iv) do not persist item answers (sensitive health data; §4.7).
* *What do responsible apps do?* The only published audit I found (top-100 healthy-eating/fitness apps on Google Play) reported that ~1/5 allowed underweight goal-setting and ~2/3 emphasised appearance goals, and recommended a simple block on goals implying BMI < 18.5 with information about the dangers [77]. Specific commercial apps' policies (e.g. calorie floors, ED screening) could not be verified in this session.

### 4.2 Population rules — hard-stop vs warn

`Hard` = Planner action is a block/restrict that cannot be dismissed by acknowledgement; `Warn` = Planner may proceed within restricted bounds and shows a "talk to your clinician" interstitial; Simulator always warns (severity in §3).

| Population / condition | Class | Planner | Simulator | Why (numbers) | Src |
|---|---|---|---|---|---|
| Age < 18 | Hard | BLOCK_APP | BLOCK_APP | ED risk (dieters ×5–×18); AAP | [71][73] |
| Pregnancy / breastfeeding | Hard | BLOCK_PLANNER | danger W-P01 | restriction contraindicated; lactation ketoacidosis pH 7.20 after 10 d LCHF; IOM gain 11.5–16 kg normal BMI; a supervised trial (−0.5 kg/wk in 40 overweight, exclusively breastfeeding women, wk 4–14 postpartum) did not change infant growth — still outside an unsupervised app's remit | [43][45][101][102] |
| Trying to conceive | Warn | R2 (no deficit/fasting) | caution | LH pulsatility disrupted < 30 kcal/kg LBM | [2] |
| ED history / SCOFF ≥ 2 / prefer-not | Hard (R1) | maintenance-surplus only | danger W-P02 | §4.1 | [7][79] |
| BMI < 18.5 | Hard | no deficit/fasting/keto; gain ≤ 0.5 %BW/wk with "see clinician" | danger W-E14 | underweight; ED overlap | [7][77] |
| BF% below floor | Hard | no deficit | danger W-E16 | HC-P5 | [66][67] |
| Type 1 diabetes; insulin / sulfonylurea / meglitinide / SGLT2i | Hard | BLOCK_PLANNER | danger W-P04 | hypoglycaemia; euDKA (glucose < 14 mmol/L possible) | [44][47] |
| Other diabetes (metformin-only, GLP-1-type, diet) | Warn | R2 | caution | very-low-carb diuresis needs practitioner input; fasting evidence limited | [47] |
| CKD (any dx / eGFR < 60) | Hard for protein + K; Warn otherwise | protein ≤ 1.3 g/kg RW; no K supplements; no fasting > T1; no keto | danger W-M05 | KDIGO 0.8 g/kg; avoid > 1.3 | [51][43] |
| Heart disease, arrhythmia, heart failure, stroke, BP ≥ 160/90 or on BP drugs | Warn (R2) | no fasting > T1; deficit ≤ 15 %; no vigorous exercise without clearance | caution W-P05 | 75-y man with CAD had NSTEMI on fasting day 9; starvation QT prolongation; arrhythmia AEs 0.21 % | [11][13][39][87] |
| Liver disease | Warn (R2) | as above; no keto (acute failure contraindicated; advanced disease relative) | caution | | [43][11] |
| Gout | Warn (R2) | no fasting ≥ T2; no keto; rate ≤ 0.5 %/wk | caution W-P06 | fasting uric acid ↑ ~46 %; acute gout reported | [11][13] |
| Kidney stones | Warn | no fasting ≥ T3; keto needs fluids ≥ 2.5 L (`PROPOSED`) | caution | urate stones with fasting; KD stones 2.5–4 % (children) | [13][43][42] |
| Gallstones / gallbladder disease / cholecystectomy | Warn | rate ≤ 0.5 %/wk; fat ≥ 30 g/d; no VLED | caution | Weinsier; VLED gallstones 15–25× | [29][30][43] |
| Pancreatitis (acute) | Hard for keto | no keto | danger W-M10 | fat load worsens | [43] |
| FAO / carnitine disorder; pyruvate carboxylase deficiency; porphyria | Hard | no keto, no fasting ≥ T2 | danger W-M10 | catabolic crisis with fasting/KD | [42][43] |
| Age 65–74 | Warn | HC-P8 | caution W-P03 | | [48][49] |
| Age ≥ 75 / SARC-F ≥ 4 / frail | Hard (no deficit) | HC-P9 | caution | | [50][48] |
| Heavy alcohol use | Hard for fasting > T1 and VLED | | danger W-M19 | NICE refeeding-risk factor | [8] |
| Acute illness, vomiting/diarrhoea, recent surgery (< 4 wk) | Hard (temporary) | no fasting > T1 | caution | dehydration SAE day 3 | [12] |
| High training load (EA < 45 with ≥ 6 h/wk) | Warn | EA floor 30 stays; fasting ≥ T2 not on hard-session days | caution W-E07/W-E08 | REDs | [1] |
| Medications | see §4.4 | | | | |

### 4.3 Tiered water-only fasting rule set (owner scope update)

**Scope.** Water-only fasting (water, unsweetened tea/coffee, electrolytes, plain salted broth ≤ 50 kcal/day; **not** dry fasting) must be supported in both the Simulator and the Planner, including repeated fasts. Tiers are defined by `fast_h`. The app **never** simulates or prescribes fluid restriction (HC-M9 sets a floor). "Healthy unsupervised adult" is the reference population; the clinical fasting literature is almost entirely **supervised, screened and selected**, which is the central caveat for T3–T5.

#### 4.3.1 What the literature says (numbers the tiers rest on)

* **≤ 24 h (T0–T1) — A/B.** 15 RCTs (n = 1365, adults with overweight/obesity): intermittent fasting vs control — fatigue RD 0 % (−1 to 2), headache 0 % (−1 to 2), dropout 1 % (−2 to 4); dizziness +3 % (−0 to 6) in the non-early-TRE subgroup [17]. 5:2 (≈ 650 kcal on 2 d/wk, 6 months) = continuous restriction for weight loss (−6.4 vs −5.6 kg, n = 107) [18]. Cost: a 24-h fast reduced time-to-fatigue at 79–86 % VO2max (e.g. 42 vs 115 min at 86 %), with hypoglycaemia implicated late [20].
* **24–48 h (T2) — B for ≤ 36 h, C for 48 h.** RCT of strict alternate-day fasting (4 weeks; healthy, non-obese, middle-aged; ~37 % calorie reduction; "no adverse effects even after > 6 months" per abstract) [16]. The fast-day length (I recall 36 h, i.e. 24 h + overnight either side) is **UNVERIFIED** — abstract only.
* **48–72 h (T3) — C.** Healthy-volunteer mechanistic work (3.5-d fast, n = 8: isokinetic strength −10 %, exercise HR ↑, aerobic endurance at 45 % VO2max unchanged [19]). Natriuresis of fasting peaks on days 3–4 at 100–150 mEq Na/day (2.3–3.4 g), cumulative 200–350 mEq (4.6–8.0 g) in week 1, with weight loss ≈ 0.9 kg/day mostly salt + water [13][21]. Supervised water-only stays of 2–7 d (n = 446 of 768): cumulative incidence of any AE by day 5 = 0.90; AE ≥ grade 2 = 0.54; ≥ grade 3 = 0.20 (Kaplan–Meier pooled over all stay lengths) [12]. Per-stay AE frequencies (all lengths): fatigue 48 %, insomnia 34 %, nausea 32 %, headache 30 %, raised BP 29 %, near-fainting 28 %, dyspepsia 26 %, palpitations 12 % [12].
* **3–7 d (T4) — C/D.** Same supervised data: ≥ grade 3 AE 0.20 (d5), 0.28 (d10). Buchinger modified fasting (200–250 kcal/d, 3 L fluid, laxative start, light exercise) in 1422 supervised adults (mean age 55, BMI 28.2, 28 % BMI < 25), 5-d group n = 659: AEs < 1 % (arrhythmia 3, hyponatraemia 3, hypoglycaemia 2, hypokalaemia 1, gout 1, tetany 1), no deaths; 2 hospitalisations — a 75-y man with CAD (NSTEMI day 9) and a 67-y woman (vomiting/dizziness/diarrhoea day 4); blood uric acid ↑ ~46 % (338 → 495 µmol/L) [11]. NICE: little/no intake > 5 d → start feeding at ≤ 50 % of requirements for 2 d [8]; ASPEN: negligible intake > 7 d is a single-criterion "significant risk" for refeeding syndrome [10].
* **> 7 d (T5) — D.** Supervised water-only stays 8–14 d (n = 238), 15–21 d (n = 64), 22+ d (n = 20): ≥ grade 3 AE 0.32 by day 15; SAEs in 2 of 768 stays (0.26 %; the paper prints 0.002 %): grade-3 dehydration day 3 (man 73 y) and grade-4 hyponatraemia day 9 (man 70 y, distilled-water-only protocol) [12]. Historical hazards of prolonged fasting: gout and urate nephrolithiasis, postural hypotension (incapacitating in 3/11 obese subjects at 25–62 d), arrhythmias, deaths in 1960s–70s fasting programs and hunger strikes at 45–76 d [13]; the water-only chart review notes that early programs often lacked screening, termination rules and proper refeeding, so inherent danger vs mismanagement cannot be separated [12].
* **Expert-consensus stance on supervision.** The European expert-panel update of the fasting-therapy guidelines says all interventions during fasting should be guided by physicians/therapists trained and certified in fasting therapy [14]; the accompanying evidence review describes *medically supervised* modified fasting (200–500 kcal/d) for 7–21 days [15].
* **Electrolyte supplementation itself is not evidence-based.** Mechanistic rationale only; the keto-initiation review found no clinical study documenting supplementation effects [21]; the sodium doses below replace *measured* losses [13], the potassium/magnesium doses are conservative and `PROPOSED` (grade D).

#### 4.3.2 Policy table

| Tier | `fast_h` | Planner permission | Eligibility beyond the gate (codes §4.3.4) | Spacing / frequency | Simulator severity | Evidence (healthy, unsupervised) |
|---|---|---|---|---|---|---|
| **T0** | ≤ 20 (daily eating window ≥ 4 h) | Default for windows ≥ 6 h; **opt-in** for 4–< 6 h; **never** < 4 h (HC-F5) | mode M0 or R2 (R1: window ≥ 12 h) | daily; energy/protein floors must be met inside the window | info (W-F14 if < 4 h) | C (TRE/IF trials pooled in [17]; windows below 4 h not sourced) |
| **T1** | > 20–24 | **Default** (may appear in any regime) | not R1, not BLOCK; age 18–74 (65–74: T1 is the maximum tier); R2 allowed with HC-P7 restrictions; no EX-B, EX-C, EX-E, EX-H, EX-J, EX-K | ≤ 3 non-consecutive per wk (in addition to T0 daily windows); ≥ 24 h eating between; `fastH_7` ≤ 108 h | info (W-F01) | A/B |
| **T2** | > 24–48 | **Opt-in + acknowledgement** (default OFF) | T1 + mode M0 (no R1/R2 flags), BMI ≥ 20, BF% ≥ floor + 2, Q19 = no, self-declared prior 24-h fast tolerated | ≤ 3/wk if ≤ 36 h; ≤ 2/wk if 36–48 h; ≥ 24 h normal eating between | caution (W-F02) | B (≤ 36 h) / C |
| **T3** | > 48–72 | **Opt-in + acknowledgement + upgraded eligibility** | T2 + BMI ≥ 22, BF% ≥ 15 (M) / 25 (F), no gout / stones / gallbladder history, no high training block, not on any medication in §4.4 | ≥ 7 d normal eating between; ≤ 2 per 30 d | caution (W-F03); danger if any exclusion | C |
| **T4** | > 72 h–7 d | **Expert mode only**: clinician-supervision attestation + double acknowledgement; **never by default** | T3 + BMI ≥ 25, no medication at all except contraceptives/thyroid replacement (`PROPOSED`), refeeding plan accepted | ≥ 28 d between; ≤ 1 per 12 wk; ≤ 4 per year | danger (W-F04) | C/D |
| **T5** | > 7 d | **Never** (Planner). Simulator allowed to 42 d with persistent banner | — | — | danger (W-F05) | D |
| **V** | VLED/PSMF block (`EI_d` 400–800, ≥ 3 d) | **Expert mode only** (same attestation); BMI ≥ 30 (NICE), ≤ 14 d per block, ≥ 14 d at ≥ floor between, protein 1.2–1.5 g/kg IBW, carbs < 30 g, fat 10–20 g, multivitamin/mineral, ≥ 2 L water | T4 codes | ≤ 12 wk cumulative (NICE cap) | danger (W-E02, W-F12) | C |

Recommendation to the owner: keep **T4 and V behind a feature flag** until a clinician reviews the copy, because no guideline endorses unsupervised fasting beyond ~72 h or unsupervised < 800 kcal/day [6][7][12], and the brief's own principle 5 is that the Planner must never prescribe clinically unsafe regimes.

#### 4.3.3 Fluids, electrolytes, exercise, refeeding, acknowledgements per tier

| Tier | Fluids | Sodium (elemental) | Potassium | Magnesium | Exercise | Refeeding | Acknowledgements required |
|---|---|---|---|---|---|---|---|
| T0–T1 | beverages ≥ 1.5 L/d; drink to thirst | usual diet (AI 1.5 g/d); no supplement | — | — | no maximal efforts in last 4 h | first meal normal, no compensatory overeating | A |
| T2 | 2.0–3.0 L/d | 1.5–2.5 g/d from salt/broth if ≥ 36 h | — | optional ≤ 350 mg if cramps | light–moderate (RPE ≤ 5/10), no HIIT, no heavy RT | first meal ≤ 30–40 % of day's energy, protein + some carbohydrate, eaten slowly; normal next day | A, B |
| T3 | 2.0–3.0 L/d (max 4) | **2.0–3.0 g/d from day 2** (5–7.6 g salt; replaces measured peak loss 2.3–3.4 g/d) | optional ≤ 1 g/d if no K flags | 100–200 mg/d optional | light walking/yoga ≤ 60 min (≈ ≤ 45 % VO2max) | 2-day ramp: day 1 ≈ 50 %, day 2 80–100 % of maintenance; no large sugar loads, no alcohol; expect 1–2 kg water rebound | A, B, C |
| T4 | 2.0–3.0 L/d (max 4); daily weight and BP if available | **2.0–3.0 g/d**; up to 4.0 g/d if lightheaded and BP low | 1–2 g/d only if no K flags | 200–300 mg/d (≤ 350) | walking ≤ 60 min; no RT | ramp 50 / 50 / 75 / 100 % of maintenance over ≥ max(4 d, ½ fast length); thiamine ≥ 200 mg/d × 5 d (NICE 200–300 mg/d) + multivitamin; mixed meals; no alcohol | A, B, C, D |
| V | ≥ 2 L/d | per product | per product | per product | light only | return to ≥ floor intake over 1–2 weeks; NICE requires dietitian advice on reintroducing foods [7] | A, B, D |

Acknowledgements: **A** = "I passed the screening honestly; this is not medical advice." **B** = stop rules (below) + "I will end the fast if any occurs." **C** = "I understand studies of this length were supervised; I have someone who knows I'm doing this; I won't drive or use dangerous equipment if lightheaded." **D** = "A clinician knows about and is supervising this."

**Stop rules (all tiers ≥ T2; shown daily as a check-in):** fainting or near-fainting that does not settle after lying down for 10 min; chest pain or irregular/racing heartbeat; new confusion, slurred or difficult speech (the hyponatraemia SAE presented as difficulty speaking); severe or persistent headache; vomiting or diarrhoea for > 6 h (dehydration SAE); muscle cramps, tremor or tingling; severe abdominal or flank pain; a hot swollen joint (gout). `PROPOSED` from the AE profiles in [11][12][13]. Ending the fast triggers the refeeding ramp for the tier already completed.

**Refeeding after > 5 days (protocol details).** Clinical anchors: NICE — after > 5 d of little or no intake, nutrition support at ≤ 50 % of requirements for the first 2 d, then to full needs if monitoring shows no problems; for *high-risk* people start ≤ 10 kcal/kg/d (5 kcal/kg/d if BMI < 14 or negligible intake > 15 d), build to full needs over 4–7 d, thiamine 200–300 mg/d + vitamin B + multivitamin for the first 10 d, and replace K 2–4 mmol/kg/d, phosphate 0.3–0.6 mmol/kg/d, Mg 0.2 mmol/kg/d (IV) or 0.4 mmol/kg/d (oral) [8]. Risk criteria (NICE): **one of** BMI < 16, unintentional loss > 15 % in 3–6 mo, little/no intake > 10 d, low K/PO4/Mg; **or two of** BMI < 18.5, loss > 10 % in 3–6 mo, little/no intake > 5 d, alcohol misuse or insulin/chemotherapy/antacids/diuretics [8]. ASPEN defines refeeding syndrome as a 10–20 % (mild) / 20–30 % (moderate) / > 30 % or organ dysfunction (severe) fall in P, K or Mg within 5 d of restarting calories [9]. The app's rule: any user meeting *any* NICE/ASPEN risk criterion is excluded from T3+ (`BLOCK_PLANNER` for fasting); those not at risk get the T3/T4 ramps above (`PROPOSED`, anchored to NICE ≤ 50 % × 2 d and to the supervised programs' ½-fast-length refeed [12]). Refeeding symptoms to tell users about: swelling of legs/face, palpitations, breathlessness, weakness, confusion. Carbohydrate refeeding produces abrupt sodium/water retention and weight rebound ("oedema") — show it as water in the model [13].

#### 4.3.4 Exclusion codes (used in the policy table)

| Code | Condition | Applies to tiers |
|---|---|---|
| EX-A | age < 18; age ≥ 65 (T1 only allowed) | all (≥ T2 for age ≥ 65) |
| EX-B | pregnant, breastfeeding, trying to conceive | all > 12 h |
| EX-C | ED history, SCOFF ≥ 2, prefer-not (R1) | all > 12 h |
| EX-D | BMI below tier minimum (T1 20*, T2 20, T3 22, T4 25) | tier-specific (*HC-P4) |
| EX-E | diabetes on any glucose-lowering drug; type 1 | all > 12 h |
| EX-F | CKD, liver disease, heart disease/arrhythmia/heart failure, stroke, BP ≥ 160/90 or antihypertensives, orthostatic symptoms | ≥ T2 (T1 → caution) |
| EX-G | gout or uric-acid-lowering drugs; kidney stones; gallstones/gallbladder disease | ≥ T2 (gout) / ≥ T3 (stones) |
| EX-H | fat-oxidation/carnitine disorder, pyruvate carboxylase deficiency, porphyria | ≥ T2 |
| EX-I | lithium, diuretics, ACEi/ARB/MRA, QT-prolonging drugs, chemotherapy, antacids (NICE refeeding factors) | ≥ T2 |
| EX-J | alcohol misuse or recent heavy drinking | ≥ T2 |
| EX-K | acute illness, vomiting/diarrhoea, surgery < 4 wk | ≥ T2 |
| EX-L | high training load / EA < 45 (REDs) | ≥ T3 |

### 4.4 Medication gate

| Medication class | Concern | Rule | Src |
|---|---|---|---|
| Insulin, sulfonylureas, meglitinides | hypoglycaemia with any restriction, fasting, exercise change | `BLOCK_PLANNER` | [47][44] |
| SGLT2 inhibitors | euglycaemic DKA precipitated by low-carb diets, fasting, extensive exercise, dehydration, excess alcohol; case of euDKA after 1 wk KD on an SGLT2i | `BLOCK_PLANNER` | [44][43] |
| Metformin, GLP-1-type agents, other glucose-lowering | diuresis/hypoglycaemia in combination with very-low-carb; appetite suppression can push below floors | `R2`; floors still bind | [47][43] |
| Diuretics (thiazide/loop), ACEi/ARB, MRA (spironolactone), beta-blockers, other antihypertensives | dehydration, electrolyte disturbance, orthostatic hypotension, hyperkalaemia with K supplements; ketogenic diet plus antihypertensives "may lead to a significant decrease in blood pressure"; thiazide/loop diuretics worsen dehydration and electrolyte imbalance on KD | `R2`; no fasting > T1; no K supplements | [43][114][8][60] |
| Lithium | narrow therapeutic range (0.6–1.25 mEq/L); salt/fluid shifts alter levels. Ramadan dawn-to-dusk fasting with hydration did not change levels in 250 patients (not evidence for multi-day fasts) | `R2`; no fasting > T1; no VLC | [22][23]* |
| Anticonvulsants (topiramate, zonisamide) | metabolic acidosis; stone risk with KD | no keto | [42][43] |
| Corticosteroids | hyperglycaemia; bone loss | `R2` | [43] |
| QT-prolonging drugs | starvation prolongs QT; deaths from ventricular arrhythmia on prolonged VLED | `R2`; no fasting > T1; no VLED (mechanistic, grade D) | [13][38][39] |
| Chemotherapy, chronic antacids, insulin (NICE refeeding factors) | refeeding risk | no fasting ≥ T3 | [8] |
| Warfarin / anticoagulants; thyroid hormone | diet-drug interactions; dose adjustment during fasting/weight loss (a supervised program continued thyroid medication at reduced dose [12]) | `R2` — **UNVERIFIED** (not researched beyond [12]) | [12] |

\* Timmer & Sands 1999 abstract was not retrievable; lithium's narrow index and sensitivity to sodium/fluid balance is standard pharmacology but the specific citation content is **UNVERIFIED**.

### 4.5 Eating-disorder safeguarding and wording

**Evidence base (what is and is not established).** Associations, not causation: in 493 college students, calorie-tracker users had higher eating concern and dietary restraint after controlling for BMI, and fitness tracking was independently associated with ED symptoms [74]; in 105 people with EDs ~75 % had used MyFitnessPal and 73 % of users felt it contributed to their ED [75]; in 122 men 56 % had used it, ~40 % felt it contributed to disordered eating, and users scored higher on attitudinal and behavioural ED symptoms with large effect sizes [76]. Design-oriented work found guilt from persuasive models, "number-game" obsession, appearance-focused goals in ~2/3 of top apps, ~1/5 allowing underweight goals, and punishing notifications; one user held 1,200 kcal/day for 7 months with the app never prompting a re-evaluation [77]. Dieting is the strongest predictor of new EDs in adolescents (severe ×18, moderate ×5 in girls) and tracks into adulthood [71][72]; the AAP advises a healthy-lifestyle rather than weight focus [73]. NICE: people can have an ED at any weight; use non-stigmatising language; offer assessment/counselling before restrictive diets if an ED is possible [7]. Evidence that well-designed apps *reduce* ED risk is lacking (grade D); the rules below are risk-minimisation, not proven prevention.

**Design rules (apply to everyone; `R1` users additionally get §2 HC-P3):**

| # | Rule | Basis |
|---|---|---|
| DS-1 | **Refuse underweight targets**: no goal weight/BMI < 20; no plan projecting BMI < 19 (HC-P4); explain in one calm sentence and show the healthy range instead. | [77][7] |
| DS-2 | **Show healthy ranges, not a single "ideal"**: display weight range for BMI 18.5–24.9 (NICE cut-offs; ethnicity-specific thresholds apply to overweight/obesity, not to the underweight floor) and, for waist, WHtR bands 0.4–0.49 healthy / 0.5–0.59 increased / ≥ 0.6 high. Provide "hide BMI/weight" toggle. | [7] |
| DS-3 | **No extreme-goal reinforcement**: no celebrations, streaks, "record low" badges or leaderboards for rate above cap_pct or intake near floors; cap animation of avatar leanness at the BF floor (dossier 14). | [77] |
| DS-4 | **No compensation arithmetic**: never show "you burned X, so you can eat Y"; no red "over budget" states; no exercise-to-food conversions. | [77][74] |
| DS-5 | **No punishing notifications**; default notifications OFF; no "you missed your goal" messages. | [77] |
| DS-6 | **Numbers-off mode**: qualitative bars instead of kcal/weight; body-listening prompts. | [77] |
| DS-7 | **Rapid-change check-in** (soft card, not alarm) when `rate_14` ≥ 1.0 %/wk for 3 wk, `EI_7` < floor for ≥ 5 d, or BMI trending < 20: "How are you doing? Here is support." | [77] `PROPOSED` |
| DS-8 | **Help card** for `R1`, W-P02, BLOCK_APP and any `danger` on ED-linked rules; region-aware; "quick exit" link. Verified contacts: **Beat (UK)** England 0808 801 0677, Scotland 0808 801 0432, Wales 0808 801 0433, N. Ireland 0808 801 0434 — open 3–8 pm Mon–Fri [81]; **Butterfly Foundation (AU)** 1800 33 4673, 7 days 8 am–midnight AEST [82]; **global directory** findahelpline.com [83]; **NEDA (US)** offers a screening tool and treatment finder [84] (no phone number verified — do not hard-code one). Verify all numbers before release and re-verify periodically. | [81][82][83][84] |
| DS-9 | **Universal, not just flagged**: DS-1…DS-5 apply to every user, because SCOFF misses ~14 % of cases and many people do not disclose. | [79] |
| DS-10 | **Privacy**: never persist SCOFF item answers or the word "screen"; persist only the mode flag; offer "Delete my data" on every settings screen. | §4.7 |

**Wording guide** (NICE: focus on health and wellbeing rather than weight; non-stigmatising language in all written and visual communication [7]; guilt and punishment framing linked to harm [77]). The avoid-list is `PROPOSED` (D).

| Avoid | Prefer |
|---|---|
| "cheat day/meal", "clean/dirty", "good/bad/junk food", "guilt-free", "sinful", "blow/ruin it" | "higher-energy day", "planned flexible meal", "more / less nutrient-dense" |
| "earn / burn off / work off" food; "calories left: −200" in red | "energy in and out", "plan vs actual", neutral colours |
| "failed / off track / willpower / lazy" | "the plan didn't fit this week — adjust it" |
| "ideal / goal weight", "problem areas", "beach body", "shred / torch / melt fat", "detox / flush" | "healthy range", "body-composition change", "muscle and fat mass" |
| "obese person", "overweight people" | "person living with overweight / obesity" |
| "you will lose 8 kg by June" | "people like you lose about 6–9 kg (plausible range) by June if they follow this" |
| "should / must / need to" lose | "if you choose to" / "one option is" |
| "proven", "guaranteed", "clinically proven", "boosts immunity", "reverses …" | "in studies…", "the model shows…", "limited evidence (grade C)" |

### 4.6 Regulatory and legal framing (public guidance summarised; **not legal advice** — counsel review required)

**US — FDA General Wellness policy (issued 6 Jan 2026; supersedes the 27 Sep 2019 version) [103].** Two factors: (1) intended only for general wellness, (2) low risk (non-invasive, non-implanted, no lasers/radiation etc.). Category-1 wellness intended uses "that do not make any reference to diseases" explicitly include **weight management** and **physical fitness**; example claims: "promote or maintain a healthy weight, encourage healthy eating, or assist with weight loss goals", and "increase or improve muscle size or body tone". **Not** general wellness: "a claim that a product will treat or diagnose obesity"; "treat an eating disorder, such as anorexia"; treat muscle atrophy. Illustrative Example 3: software that records food consumption to "manage dietary activity for weight management" is a low-risk wellness product and not a device function; Example 8: a product "explicitly contraindicated for use with diabetics and pre-diabetics" can still make a general-wellness claim. For products that estimate/display physiologic parameters, FDA lists disqualifiers — labelling/UI/function that includes "references to specific diseases, clinical conditions, or diagnostic thresholds", alerts recommending clinical action, treatment guidance, claims of clinical accuracy/grade, or intended-use statements targeting diagnosis/monitoring/management — and *permits* a notification that evaluation by a healthcare professional may be helpful if it does not name a disease, characterise the output as abnormal/pathological/diagnostic, include clinical thresholds or treatment recommendations, or provide ongoing alerts. Guidance is non-binding; labelling must be consistent with, and not exceed, the stated intended use. Note: that disqualifier list appears in the guidance's discussion of products that *estimate or report physiologic values*; whether and how far it constrains a non-sensing planner is a question for counsel.

*Consequences for Vitals:* (i) intended use = "educational estimates of diet/fasting/exercise effects for healthy adults' weight management and fitness"; (ii) contraindication/exclusion language ("not for people who take insulin…") is compatible (Example 8) but **avoid** disease-management claims ("helps living well with type 2 diabetes" is a *different* claim category with its own conditions); (iii) **blood-marker outputs** (LDL, glucose, insulin sensitivity, HbA1c-like) mimic clinical values — show them as *relative model trends* ("LDL ▲ vs your starting point, average-person model, grade C"), never as absolute mg/dL with normal/abnormal shading or risk labels, and never as disease-risk predictions; (iv) our `danger` messages should say "speak with a healthcare professional" without naming a diagnosis of the user or characterising a value as abnormal; (v) do not claim to "treat obesity", "reverse" or "prevent" any disease, nor to treat or screen for EDs (the onboarding check is a *safety filter*, not a screening claim); (vi) keep marketing, store listing, and UI consistent with the same intended use.

**US — FDA Clinical Decision Support guidance (29 Jan 2026 version; supersedes the 6 Jan 2026 version) [104].** The non-device CDS exclusion in §520(o)(1)(E) requires the software to support a **health care professional**; the guidance states that software that supports or provides recommendations to *patients or caregivers — not HCPs — meets the definition of a device* (subject to FDA's enforcement-discretion policies). A consumer Planner therefore **cannot rely on the CDS exclusion**; it must sit within the General Wellness policy (or the healthy-lifestyle exclusion in §520(o)(1)(B) [103]). The 2022 Mobile Medical Apps guidance lists enforcement discretion for tools that organise health information, BMI calculators, and tools helping prediabetes patients "develop better eating habits" [105] — again an argument for excluding, not serving, disease populations. **The planner becomes a device risk if** it is marketed for a disease/condition, gives treatment-directing recommendations to people with medical conditions, or outputs clinically-equivalent values.

**EU — MDR / MDCG 2019-11 rev.1 (June 2025) [106].** Software qualifies as medical device software only if it has a **medical purpose** under MDR Art. 2(1) ("diagnosis, prevention, monitoring, prediction, prognosis, treatment or alleviation of disease…"); the guidance says software only intended for non-medical purposes "such as… wellness or fitness apps" does not qualify, and that the **manufacturer's stated intended purpose** is decisive. Rule 11: software informing diagnostic/therapeutic decisions is class IIa (IIb/III if serious/irreversible harm possible); monitoring physiological processes IIa; all other software class I. *Consequences:* keep intended purpose wellness-only in all copy; do not output disease prediction/prognosis (e.g. "diabetes risk score") or therapeutic instructions; be cautious with "prediction" language for biomarkers; do not target patient groups.

**FTC (US) — Health Products Compliance Guidance (Dec 2022) [107].** Applies to health-related apps as well as supplements. Health and safety claims need **competent and reliable scientific evidence**; disclosures must be clear and conspicuous — near the claim, in the same medium, **unavoidable (hyperlinked disclosures are avoidable)**, not contradicted by the ad; fine print in terms & conditions is inadequate; a disclaimer cannot negate an express claim (Example 14: an acne app marketed to treat acne with an "entertainment purposes only" disclaimer was deceptive); if a significant minority take away a misleading claim despite a disclosure, the disclosure is insufficient. *Consequences:* the "average person / not medical advice" line must sit **next to the numbers**, not only in the footer or a linked page; outcome claims ("lose X by date") need typicality qualifiers and substantiation; autophagy/longevity outputs are exploratory (dossier 08) and must not be marketed as benefits; no testimonials/before-after.

**Not researched (flag for counsel):** UK MHRA software guidance; US state dietetics/nutrition-practice licensing (personalised meal/diet plans can be regulated in some states — **UNVERIFIED**); state consumer-health-data laws and the FTC Health Breach Notification Rule (relevant only if any server-side data collection is ever added); app-store health-app policies.

**Where disclaimers must appear.**

| Placement | Content | Reason |
|---|---|---|
| First-run gate + acknowledgement | intended use, 18+, not medical advice, screening explanation | FTC "clear and conspicuous"; FDA intended-use consistency |
| Results header (every projection) | short micro-copy (below) adjacent to numbers | FTC: disclosure near claim; uncertainty |
| Planner prescription card | limits statement + stop rules | safety |
| `danger` interstitials | checkbox acknowledgement | informed use |
| Footer (every page) | short version | baseline |
| "About / Limits" page | full version | reference (not the *only* place) |
| Store listing / marketing / share-images | same intended-use wording | FDA/MDR consistency |

**Disclaimer drafts.**

*Short footer (≤ 230 chars):*
> Vitals is an educational simulator for healthy adults 18+. It estimates trends for an average person — not medical advice, diagnosis or treatment. Talk to a clinician before changing your diet or exercise.

*Results-header micro-copy:*
> Projection for an average person with these inputs — your results will differ. Not medical advice.

*Planner card micro-copy:*
> This plan stays inside published safety limits for healthy adults. It is not personalised medical advice. Stop and get help if you feel unwell.

*`danger` interstitial:*
> This scenario goes beyond limits considered safe without medical supervision. It is shown for education only.  ☐ I understand this is a simulation, not a recommendation.

*Full page ("Important information and limits"):*

> **What Vitals is.** Vitals is an educational tool. It uses published research to estimate how body weight, body composition and related measures may change, for an *average person* with the inputs you give, under a diet, fasting and exercise plan. The Planner suggests plans that stay inside safety limits drawn from clinical guidelines and studies.
>
> **What it is not.** It is not a medical device and does not diagnose, treat, cure or prevent any disease, including obesity or eating disorders. It cannot replace advice from a doctor, registered dietitian or other qualified professional, and it does not know your health history.
>
> **Who it is for.** Adults aged 18 or over without conditions that need medical supervision. It is not designed for anyone who is pregnant or breastfeeding, has or has had an eating disorder, takes medicine for diabetes, or has heart, kidney or liver disease. For many other conditions and medicines you should speak with a clinician first. If a screening question suggests extra care, we limit what the Planner will suggest.
>
> **How to read the projections.** Projections are model estimates for an average person, not predictions for you. Real results vary widely, in both directions, with genetics, sleep, illness, medicines, how closely you follow the plan, and errors in the numbers you enter. Every output has an evidence grade from A (strong human evidence) to D (expert opinion or animal data); grade C and D outputs are exploratory. Blood-marker and autophagy curves are model trends, not laboratory results, and cannot diagnose or rule out anything.
>
> **Safety limits.** The Planner does not suggest average intakes below 1,200 kcal/day (women) or 1,500 kcal/day (men), weight loss faster than about 0.5–1% of body weight per week, less than about 30 kcal per kg of lean mass per day left over after exercise, or a body-mass index in the underweight range. It does not suggest fasts longer than 72 hours by default. The Simulator can show riskier scenarios but labels them clearly. These limits are conservative guides, not guarantees of safety.
>
> **Stop and get help.** Stop and seek medical help if you feel faint, have chest pain or an irregular heartbeat, become confused, keep vomiting, or have severe headache, cramps or abdominal pain. If eating, weight or exercise feels out of control or distressing, please contact a health professional or a helpline — see the help card. You deserve care at any weight.
>
> **Your data.** Everything you enter is processed in your browser. Vitals does not send what you enter to a server. If you choose to save on this device it stays in this browser's storage until you delete it (Settings → Delete my data).
>
> **Evidence and changes.** Sources and evidence grades are shown in the app. Guidance changes; this page was last reviewed on [date].

### 4.7 Privacy and GDPR notes for localStorage-only health data (brief; not legal advice)

* Health inputs are personal data and "data concerning health" is a special category (GDPR Art. 4(15), Art. 9) [108]. "Processing" is any operation on personal data, including collection and storage (Art. 4(2)) [108]. If the app's code runs only in the user's browser and nothing is transmitted to the publisher or a third party, the publisher does not receive or hold the data; whether a client-side-only tool is "processing by a controller" at all is a legal question for counsel (the household exemption in Art. 2(2)(c) covers a *natural person's* own purely personal use, not the software publisher) [108].
* **ePrivacy Art. 5(3)** is the more likely EU touchpoint: it covers *storing* information on, or *accessing* information already stored on, the user's terminal equipment; consent is not needed for storage "strictly necessary" for a service the user explicitly requested. EDPB Guidelines 2/2023 (v2.0, 7 Oct 2024) state that use of information in local storage by an application "would not constitute a 'gaining of access'… as long as the information does not leave the device", but that sending it (or any derivation) to a server or third party would [109]. So: **keep the claim "data never leaves the browser" literally true** — no analytics, error reporters capturing app state, third-party fonts/CDNs that leak IP addresses, or feedback forms that attach state; hosting logs (IP addresses on Netlify) are a separate, unavoidable processing to disclose.
* Recommended pattern: persist to localStorage **only after an explicit "Save on this device" opt-in** (Zustand `persist` should be gated), show plain-language storage notice, one-click **export** and **delete-all**, store mode *flags* rather than raw screening answers, and warn about shared/public devices. Add a strict CSP (XSS could read localStorage).
* If any server-side feature is ever added (accounts, sync, sharing, analytics), Art. 9 explicit consent, DPIA, and US state consumer-health-data laws become relevant — re-open this section.

### 4.8 Communicating uncertainty responsibly

* **Frame** every output as *"projection for an average person like you"*, never "your result"; the phrase sits next to the numbers (FTC [107]).
* **Ranges over points.** Show bands where the literature gives dispersion (e.g. 50 %/90 %); where it does not, show the **evidence grade** and a low-confidence style (hatched band). Communicating epistemic uncertainty produced only a small drop in trust, mostly for *verbal* rather than numeric expressions [110][111] — so prefer numeric ranges plus a one-line verbal caveat.
* **Round to the honest precision**: weights to 0.5 kg (1 lb), dates to weeks, body-fat to whole percent; avoid decimal weights on future days.
* **Three separate uncertainties, three labels:** *input error* (e.g. BF% ±4 points [69]), *individual variability* (people differ), *evidence quality* (A–D).
* **Language:** "in studies…", "the model shows…", "may", never "you will", "guaranteed", "proven"; never imply diagnosis ("you have…", "abnormal", "pre-diabetic").
* **Explain flags:** each caution/danger shows the *binding rule*, the *number*, and a citation so the user sees why; unknown = say so.
* **Show levers, not verdicts:** display what changes the projection (adherence, sleep, protein, training) rather than a single fate.

---

## 5. Interactions with other subsystems

| Dossier | Needs from / gives to this module |
|---|---|
| 01 body-weight models | Needs `BW, FM, FFM` and a **tissue-mass** series `TM` (excludes glycogen-bound water, gut content, fluid shifts) so `rate_14` is not tripped by day-1 water loss (fasting: ≈ 0.9 kg/day in week 1, mostly salt + water [13]). |
| 02 energy expenditure | Needs current `TDEE_7` (post-adaptation) — as adaptive thermogenesis lowers TDEE, a fixed kcal target becomes a *larger* deficit; constraints are evaluated on the modelled value. REDs CAT-2 lists RMR < 30 kcal/kg FFM/d or RMR ratio < 0.90 as an LEA indicator [1] → expose as an output. |
| 03 protein/MPS | Reference weight `RW`, floors/caps HC-M1/M2 must match its recommendations; this dossier only sets safety bounds. |
| 04 carbohydrate/glycogen | Glycogen + water terms for `TM`; low-carbohydrate natriuresis (days 1–4, subsiding ~14 d) drives sodium rules. |
| 05 ketosis | Ketone state gates W-M08/W-M09/W-M10; SGLT2i + ketosis is a hard block. |
| 07 fasting/circadian | Supplies `fast_h`; must add **sodium balance / ECF volume and uric acid** state (natriuresis 100–150 mEq/d peak days 3–4; uric acid +46 % in 4–21 d) so orthostatic-hypotension and gout warnings are model-driven rather than fixed text. |
| 08 autophagy | Outputs must carry evidence grade and "exploratory" label (FTC substantiation). |
| 09/10 training, cardio | `EEE_d` for `EA`; progression caps HC-X1–X3. |
| 11 surplus | HC-E8 bounds; waist/WHtR inputs. |
| 12 hormones | Rossow/Hulmi validation data (T, E2, T3, leptin, HR) for low-EA/low-BF regimes; show hormone outputs as trends (FDA "clinical values" caution). |
| 13 transitions, PSMF, refeeds | PSMF/VLED = tier V here; refeeding ramp and water rebound (carbohydrate refeeding → Na/water retention [13]). |
| 14 anthropometrics | BF% uncertainty (SEE 2.8–5.4 points [69]) enters floor margins; avatar clamp at BF floor (DS-3). |
| 15 micronutrients/hydration/substances | Na/K/Mg/fluid/alcohol/caffeine/creatine numbers here are the *safety envelope*; nutrient adequacy lives there. |
| 16 modifiers | Sex parameter, age bands (65+), menopause, menstrual-cycle flag (W-E18). |
| 18 planner algorithms | Consumes §2.4 interface; needs "binding-constraint" explanations for goal refusal (HC-G1); constraints are hard filters, never objective terms. |
| 19 other outcomes | Bone (−0.01 to −0.015 g/cm² hip in trials [27]), immune, hair, menstrual outputs are *flag-only* here. |

## 6. Output metrics for the UI (safety-related)

| Metric | Unit | Direction of good | Computation | Grade |
|---|---|---|---|---|
| Energy availability | kcal/kg FFM/d | ≥ 45 ideal; 30–45 short-term only; < 30 not acceptable | `EA_7` | B (F) / D (M) |
| Deficit vs maintenance | % | within cap_def | `deficit_pct_7` | B/C |
| Rate of change | %BW/wk, kg/wk | within cap_pct and ≤ 1.5 kg/wk | `rate_14` | B/C |
| Projected BMI band | kg/m² | 20–24.9 (ethnicity-specific cut-offs for overweight per NICE) | from state | B |
| Body fat vs floor | % pts above floor | ≥ 0 | `BF% − BFfloor` | D |
| Fasted hours, 7 d | h | ≤ 108 | `fastH_7` | D |
| Weeks since last maintenance break | wk | ≤ 12 (deficit ≥ 15 %) | block counter | C |
| Protein adequacy | g/kg RW, % E | within HC-M1/M2 | derived | A/B |
| Refeeding-risk flag | bool | false | NICE/ASPEN criteria from BMI, loss %, intake days, alcohol/meds | B |
| **Safety-envelope status** | enum `within / caution / danger / blocked` | `within` | max severity over the window | — |

## 7. Validation targets ("golden tests")

Each row is an input regime → expected classification. They test *rule logic* (not physiology); physiological outcomes belong to dossiers 01–13.

| ID | Input | Expected | Source |
|---|---|---|---|
| GT-01 | F, 30 y, 165 cm, 68 kg, TDEE 2000; EI 1000 kcal/d × 8 wk | Planner: REJECT (HC-E1, HC-E3). Simulator: W-E01 + W-E04 (deficit 50 % > 40 %) | [6][7] |
| GT-02 | Sedentary F, FFM 42 kg, EEE = 15 kcal/kg LBM/d (630 kcal), EA arms 45/30/20/10 → EI 2520/1890/1470/1050 for 5 d | EA 45 within; 30 at bound (OK, W-E07 only if > 14 d); 20 and 10 → W-E08 danger; Planner CLIP to 30 | [2][3] |
| GT-03 | 75 kg male athlete, BF 18 %: −0.7 %/wk vs −1.4 %/wk (same athlete at BF 15 % → cap 0.5 %, so 0.7 % is clipped) | 0.7 %: allowed (cap 0.75); 1.4 %: W-E05 + Planner REJECT | [4][5] |
| GT-04 | Male 26 y, BF 14.8 % → 4.5 % over 6 mo | Planner CLIP at 10 %; Simulator W-E15 at < 12 %, W-E16 at < 8 % (T ↓ 75 %, HR 27 bpm in the case) | [66] |
| GT-05 | F 27 y, BMI 23.5 → 20.6 (−12 % BW) over 4 mo | BMI end OK; BF% floor binds when projected < 18 %; W-E18 menstrual flag; hormone recovery 3–4 mo after refeeding | [67] |
| GT-06 | 100 kg, BMI 33: −1.6 kg/wk vs −1.0 kg/wk | −1.6: W-E06 danger, Planner REJECT; −1.0 (1 %): allowed | [29] |
| GT-07 | F 50 y, BMI 28, 10-d water-only fast | Planner: never (T5). Simulator: W-F05 danger + W-F04-style incidence panel; refeeding ramp required | [12][13] |
| GT-08 | F BMI 30.6, 5:2: 2 × 650 kcal + 5 × 1750 (weekly mean 1436; TDEE 2000 → 28 %) | Passes HC-E1, HC-E2; deficit 28 % ≤ 30 % (BMI ≥ 30). Same pattern at BMI 24 (cap 20 %): CLIP | [18][6] |
| GT-09 | Healthy F BMI 25, 36-h fasts on alternate days for 4 wk (`fastH_7` = 126 h) | Planner REJECT (HC-F2: > 108 h; trial-tested pattern is more aggressive than our envelope by design); Simulator W-F13 caution | [16] |
| GT-10 | BMI 17.5, 6-d fast, alcohol misuse | NICE high-risk (≥ 2 criteria: BMI < 18.5, intake > 5 d, alcohol) → fasting BLOCK; W-F08 | [8] |
| GT-11 | SGLT2-inhibitor user, net carbs 30 g/d | Planner BLOCK; Simulator W-M10 + W-P04 danger | [44] |
| GT-12 | M FFM 65 kg, EEE 900 kcal/d, EI 2400 | EA = 23 → W-E08; Planner CLIP EI to ≥ 2850 | [1] |
| GT-13 | F, 165 cm, 60 kg (BMI 22.0), BF 24 %, wants 55 kg in 8 wk | BMI 20.2 OK; rate 0.63 kg/wk = 1.04 %/wk > 0.5 %/wk cap (BF ≤ floor + 6) → goal refused; earliest feasible date ≈ 17 wk at 0.5 %/wk; the BF floor (18 %) also binds near 55.6 kg if lean mass is preserved | HC-G1 |

### Message-length check (CI)

```python
import re, sys
bad = 0
for ln in open('research/17-safety-guardrails.md', encoding='utf-8'):
    if re.match(r'^\|\s*W-', ln):
        msg = [c.strip() for c in ln.strip().strip('|').split('|')][3]
        if len(msg) > 200: bad += 1; print('TOO LONG', ln[:12], len(msg))
sys.exit(1 if bad else 0)
```
(Placeholders `{…}` count at their template length; the longest current message is 187 characters.)

## 8. Myths and contested claims

| Claim | Evidence |
|---|---|
| "1,200 kcal is a physiological safe minimum" | It is a **prescription convention** (lower bound of the typical AHA/ACC/TOS ranges), not a threshold; NICE 2025 puts even 800–1200 kcal inside specialist services [6][7]. It ignores body size — hence the paired deficit cap and EA rule. |
| "The 1970s liquid-protein deaths were just bad (collagen) protein" | 17 sudden deaths (ventricular arrhythmia) after prolonged (median 5 mo) ~300–400 kcal/d regimens; deaths were **independent of supervision, potassium dose and protein quality**; common factors were marked obesity, prolonged extreme restriction, rapid loss; ECG/pathology resembled starvation (QT prolongation) [38][39]. |
| "30 kcal/kg FFM/d is a universal cliff" | Derived from 5-d lab studies in 29 sedentary women; REDs 2023: debated, males appear to tolerate lower (~9–25), "risks in setting a definitive clinical threshold" [2][1]. We use it as a conservative bound. |
| "Fast weight loss always rebounds more" | RCT (BMI 30–45): 12-wk rapid vs 36-wk gradual loss → 70.5 % vs 71.2 % regain at 144 wk [28]. The reasons to cap rate are gallstones, lean-mass loss, hormones. |
| "Fasting is inherently dangerous" / "inherently safe" | Supervised water-only stays: mostly mild AEs but ≥ grade-3 AEs 20 % by day 5; SAEs in men 70–73 y; historical deaths occurred in unscreened, poorly refed programs [12][13]. Neither slogan is supported. |
| "Keto flu is solved by electrolytes" | Physiological rationale (natriuresis days 1–4) is strong; **no clinical study** documents supplementation effects [21]. |
| "High protein harms healthy kidneys" | 28 RCTs, n = 1358 healthy adults: no adverse GFR effect at ≥ 1.5 g/kg; CKD is different (KDIGO: avoid > 1.3 g/kg) [52][51]. |
| "SCOFF diagnoses eating disorders" | Screening flag: pooled Se 0.86 / Sp 0.83; not validated for the full DSM-5 range in community samples [79]. |
| "A disclaimer at the bottom covers us" | FTC: disclosures must be near the claim, unavoidable, not contradicting it; fine print does not cure a misleading net impression [107]. |
| "Wellness apps sit outside FDA/EU rules" | Only while intended use, claims and outputs stay wellness (FDA GW, MDCG wellness carve-out); disease claims or clinical-value outputs change the analysis [103][106]. |
| "The 10 % rule prevents running injuries" | RCT (n = 532) found no reduction; > 30 % progression showed HR 1.59 (0.96–2.66) in an exploratory cohort; evidence base "very limited" [89][90][91]. |
| "Ramadan-type fasting data show multi-day fasts are safe" | Dawn-to-dusk fasting with nightly eating (e.g. lithium levels stable in 250 patients with hydration) says nothing about > 24 h zero-energy fasts [22]. |

## 9. Evidence digest by domain (safety bounds, rationale, grade)

**Energy floors and deficits.** AHA/ACC/TOS: prescribe 1200–1500 kcal/d (F) / 1500–1800 (M) *or* a 500–750 kcal/d deficit *or* a 30 % deficit; initial goal 5–10 % loss in 6 months; VLCD (< 800) only in limited circumstances by trained practitioners in a medical setting (Class IIa, LoE A) [6]. NICE NG246 (2025): low-energy diets 800–1200 kcal only within a specialist service for BMI ≥ 30 (or overweight + type 2 diabetes); VLEDs (< 800) only for a clinically assessed need to lose weight rapidly; both nutritionally complete, ≤ 12 weeks, supervised, dietitian access; VLED risks include constipation, fatigue, hair loss; offer ED assessment; review medicines; not a long-term strategy [7]. VLCD vs LCD meta-analysis (6 RCTs): 16.1 % vs 9.7 % short-term loss, 6.3 % vs 5.0 % long-term (ns) [37]. *Grade A/B for the guideline bounds; D for the size-scaling caps.*

**Low energy availability.** EA = (EI − EEE)/FFM. Loucks & Thuma: LH pulsatility intact at EA 30, disrupted below (45 vs 10/20/30 with 15 kcal/kg LBM/d exercise, 5 d, 29 women) [2]; bone formation markers suppressed at all restricted levels, resorption ↑ at 10 [3]. REDs 2023: ≥ 45 adequate; 30–45 reduced for fat loss; ≤ 30 health implications; universal 30 debated; males ~9–25; adaptable LEA is "typically a short-term experience"; EDE-Q global > 2.30 (F) / > 1.68 (M) is a primary indicator [1]. *B for women (short lab studies), D for men and free-living.*

**Rate of loss.** Gallstone incidence rises exponentially above 1.5 kg/wk (curve r² 0.98 across 9 groups) [29]; new stones 10–12 % after 8–16 wk on LCD; ≈ 1/3 symptomatic; risk factors: > 1.5 kg/wk, loss > 24 % BW, no-fat VLCD, long overnight fast, high TG [31]; ~500 kcal diets: 25.5 % gallstones at 8 wk [32]; 30 g fat/d with a 10-g fat meal prevented stones (0/7 vs 4/6) [33]; higher-fat diets RR 0.09, UDCA RR 0.33 (NNT 9) but sequential analysis did not confirm [34]. Lean-mass: 0.7 vs 1.4 %/wk [4]; 0.5–1 %/wk, leaner → slower [5]. Hair: telogen effluvium in a 140-patient clinic series at mean 15 % loss and 3.5 kg/month; women and older adults more vulnerable; VLED hair-loss risk in NICE [35][36][7]. *Grade B (gallstones), C (lean mass, hair).*

**Body-size floors.** BMI 18.5–24.9 healthy (NICE); Asian etc. lower thresholds for *overweight* (23 / 27.5), not underweight [7]. BF: no accepted optimum [68]; BF estimates SEE 2.8–5.4 points [69]; case data: male BF 14.8 → 4.5 % (HR 53 → 27, BP 132/69 → 104/56, T 9.22 → 2.27 ng/mL, mood disturbance 6 → 43; recovered within 6 mo, strength not fully) [66]; women, −12 % BW, −35–50 % fat mass over 4 mo: leptin, T3, T, E2 ↓, menstrual irregularity ↑, recovery 3–4 mo (T3, T not fully); 6/27 < 10 % BF; lowest BMI 18.7–19.0 [67]; Minnesota semi-starvation: > 25 % weight loss, anaemia, fatigue, apathy, weakness, irritability, oedema [70]. *Grade D for numeric floors.*

**Deficit duration / diet breaks.** MATADOR (n = 47 men, BMI ~34): 8 × 2 wk deficit at 67 % of maintenance alternating with 2-wk balance: 14.1 vs 9.1 kg loss, weight stable in balance blocks [24]; ICECAP (n = 61 resistance-trained): 4 × 3 wk + 3 × 1 wk balance = continuous 12 wk for fat/FFM, less hunger, no difference in ED behaviours [25]. CALERIE (n = 218, BMI 25.1, 25 % CR, 2 y, −7.5 kg): lumbar −0.013, hip −0.017, femoral neck −0.015 g/cm² vs control [26]; meta-analysis hip BMD −0.010 to −0.015 at 6–24 mo, bone-resorption markers ↑ at 2–3 mo [27]. *Grade C.*

**Protein.** RDA 0.8 g/kg (minimum to avoid N loss; AMDR 10–35 %) [53]; older adults ≥ 1.0–1.2, ≥ 1.2 with exercise, 1.2–1.5 with disease, eGFR < 30 exception [48]; 40 % deficit + HIIT/RT: 2.4 vs 1.2 g/kg → +1.2 vs +0.1 kg lean, −4.8 vs −3.5 kg fat [54]; lean dieting athletes 2.3–3.1 g/kg FFM scaled to deficit and leanness [55][57][56]; upper end: > 35 % E hazards, suggested ceiling ≈ 25 % E / 2–2.5 g/kg [58]; DGA 2025–2030 lists 1.2–1.6 g/kg/d [100]; CKD G3–G5 0.8 g/kg, avoid > 1.3 [51]; healthy adults show no GFR harm [52]. *A/B.*

**Fat, carbohydrate, fibre, essential nutrients.** EFSA adults: fat 20–35 % E, linoleic 4 % E, ALA 0.5 % E, EPA + DHA 250 mg/d, carbohydrate 45–60 % E, fibre 25 g/d, total water AI 2.5 L (M) / 2.0 L (F) [59]; adult EFA deficiency at < 1–2 % E linoleic; ASPEN 2–4 % / 0.25–0.5 % [62]; low-fat vs high-fat diets ↓ total T (SMD −0.38, −0.75 to −0.01, 6 studies, n = 206) [63]; contest-prep fat 15–30 % E, 15–20 % lower end [5]; IOM carbohydrate RDA 130 g/d (brain glucose reference), AMDR 45–65 % [112]; fibre 14 g/1000 kcal [113]. *B/C.*

**Electrolytes and fluid.** Sodium AI 1.5 g/d, CDRR 2.3 g/d; potassium AI 2.6 (F) / 3.4 (M) g/d, no UL (case-report cardiac harm at very large doses) [60]; magnesium supplemental UL 350 mg/d [61]; DGA: < 2,300 mg sodium, highly active may need more [100]; fasting natriuresis peak 100–150 mEq/d, cumulative 200–350 mEq in week 1 [13]; drink to thirst, deficits ≤ 3 % BM tolerated [65]; hyponatraemia SAE day 9 on distilled-water protocol [12]. *B for reference intakes, D for fasting doses.*

**Ketogenic patterns.** Absolute contraindications: primary carnitine deficiency, CPT I/II, translocase, β-oxidation defects, pyruvate carboxylase deficiency, porphyria; relative: acute pancreatitis, acute liver failure/advanced liver or renal disease, familial hypercholesterolaemia, propofol; caution: T1/T2 diabetes on specific therapies, treated hypertension, gallbladder disease, electrolyte disturbance, arrhythmia, pregnancy/lactation, underweight, intense exercise [42][43]. SGLT2i euDKA precipitated by low-carb diets, fasting, exercise, alcohol [44]; lactation ketoacidosis (pH 7.20 after 10 d) [45]; adult KD AEs: halitosis 38 %, LFT change 24 %, dizziness 15–21 %, headache 8–25 % [43]; LDL-C +1.82 mM in 4 wk in 17 women [46]. *B/C.*

**Fasting.** §4.3.1. **PSMF/VLCD.** PSMF = protein 1.2–1.5 g/kg (IBW), carbs < 20–30 g, fat 10–20 g, > 2 L water, vitamin/mineral supplementation; trial cycle 10 d PSMF / 20 d balanced low-calorie diet in BMI > 34.9; 12/44 discontinued for intolerance [41]. Historical deaths §8 [38][39][40]. NICE: nutritionally complete, ≤ 12 wk, supervised [7].

**Exercise.** PAR-Q+ 7 screening topics; ACSM screening on current activity, symptoms/known CV-metabolic-renal disease, intended intensity [86][87]; novice RT 2–3 d/wk, 8–12 RM, load steps 2–10 % [88]; run progression [89][90][91]; heat-illness risk factors (not acclimatised, dehydrated, medications, recent illness) [92]; 24-h fast cuts high-intensity endurance [20]; 3.5-d fast: strength −10 % [19]; WHO ≥ 150 min/wk [93]. *B/C.*

**Surplus.** ~10–20 % surplus, 0.25–0.5 %BW/wk gain, protein 1.6–2.2 g/kg, fat 20–35 % E [64]; AHA waist > 102/88 cm and NICE WHtR bands [6][7]. *C.*

**Substances.** Caffeine ≤ 400 mg/d, ≤ 200 mg single doses (~3 mg/kg), ≤ 200 mg/d pregnancy/lactation, 100 mg near bedtime may disturb sleep [94][95]; creatine maintenance 3–5 g/d, loading 0.3 g/kg/d 5–7 d, ≤ 30 g/d for 5 y safe in healthy people [96]; alcohol ≤ 14 units/wk (UK), Canada 2023 ≤ 2 drinks/wk lowest risk and ≤ 2 per occasion, WHO no safe level, DGA 2025–2030 "consume less" with no numeric daily limit [97][98][99][100].

## 10. Open questions and weakest assumptions

1. **Energy floors (1200/1500) are conventions**, not physiological thresholds; no RCT tests them for unsupervised users; scaling for small/large bodies is my cap-function design (`PROPOSED`, D).
2. **BF and BMI floors (10/18 %; 20/19)** rest on case series and an explicit statement that no accepted optimum exists [68]; needs a clinician/sports-dietitian panel and ethnicity/age review.
3. **EA 30 kcal/kg FFM** is from 5-d lab studies in sedentary women; men and free-living use are uncertain; EA is hard to estimate with slider-derived FFM.
4. **T3–T5 fasting:** no data for *unsupervised* fasts; supervised cohorts are screened; AE incidence is pooled across durations; sodium replacement dose is derived from measured urinary loss, potassium/magnesium doses are expert opinion; electrolyte supplementation has no trial evidence [21]. The 36-h ADF fast-day length is **UNVERIFIED** (abstract only) [16].
5. **PSMF/VLED unsupervised limits** (14-d blocks) are judgement; NICE's 12-week cap is for supervised programmes.
6. **SCOFF adaptation** (item 4 rewording, "6 kg") is unvalidated; no evidence that app-based gating reduces harm; men, BED, ARFID and athletes are under-detected [79]; plan an evaluation (opt-in, local-only counters).
7. **Gallstone/hair/menstrual/bone/immune**: only flags, because the incidence curves at moderate rates are not available to me (Weinsier curve parameters not in the abstract).
8. **Refeeding in healthy short fasters:** no incidence data for BMI ≥ 25 fasting ≤ 7 d; the ramps are anchored to clinical guidance (NICE ≤ 50 % × 2 d) and to programmes that refeed for ½ the fast length [8][12]; ASPEN's energy-advancement specifics were not accessible (**UNVERIFIED**).
9. **Legal**: scope of the FDA GW disqualifier list for non-sensing software; blood-marker outputs; EU "prediction/prognosis" wording; US state dietetics licensing; UK MHRA; GDPR/ePrivacy analysis of localStorage — all need counsel.
10. **Not covered / hand-offs:** adolescents (blocked by design), menopause/perimenopause, aesthetic-sport athletes, medication interactions beyond §4.4 (warfarin, thyroid — **UNVERIFIED**), ethnicity-specific body-fat cut-offs, pregnancy-planning guidance.
11. **Access limitations in this research pass:** NCBI Bookshelf, BJSM, NIH ODS, Wiley/ASPEN full texts, Cell Press and FDA-via-curl were blocked; the session's web-search budget was exhausted, so commercial-app policies (calorie floors, ED screening) and several guideline PDFs could not be checked. REDs 2023 was read via a reprint PDF, Kerndt 1982 via the TrueNorth Health Foundation copy, the GDPR via the gdpr-info.eu mirror.

---

## 11. References

*Access dates for web pages: 2026-09-30. "(abstract only)" = full text not read. Regulators' guidance is non-binding and changes; re-check before release.*

1. Mountjoy M, Ackerman KE, Bailey DM, et al. 2023 International Olympic Committee's (IOC) consensus statement on Relative Energy Deficiency in Sport (REDs). *Br J Sports Med* 2023;57(17):1073–1097. PMID 37752011. doi:10.1136/bjsports-2023-106994. https://pubmed.ncbi.nlm.nih.gov/37752011/ (full text read via a reprint PDF hosted by the Swedish Society of Medicine: forening.sls.se; BJSM site blocked).
2. Loucks AB, Thuma JR. Luteinizing hormone pulsatility is disrupted at a threshold of energy availability in regularly menstruating women. *J Clin Endocrinol Metab* 2003;88(1):297–311. PMID 12519869. doi:10.1210/jc.2002-020369.
3. Ihle R, Loucks AB. Dose-response relationships between energy availability and bone turnover in young exercising women. *J Bone Miner Res* 2004;19(8):1231–40. PMID 15231009. doi:10.1359/JBMR.040410.
4. Garthe I, Raastad T, Refsnes PE, Koivisto A, Sundgot-Borgen J. Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes. *Int J Sport Nutr Exerc Metab* 2011;21(2):97–104. PMID 21558571. doi:10.1123/ijsnem.21.2.97.
5. Helms ER, Aragon AA, Fitschen PJ. Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation. *J Int Soc Sports Nutr* 2014;11:20. PMID 24864135. doi:10.1186/1550-2783-11-20.
6. Jensen MD, Ryan DH, Apovian CM, et al. 2013 AHA/ACC/TOS guideline for the management of overweight and obesity in adults. *Circulation* 2014;129(25 Suppl 2):S102–38. PMID 24222017. PMC5819889. doi:10.1161/01.cir.0000437739.71477.ee.
7. National Institute for Health and Care Excellence. *Overweight and obesity management* (NG246), 2025. https://www.nice.org.uk/guidance/ng246 — chapters "Physical activity and diet" (recs 1.16.1–1.16.13), "Identifying and assessing overweight, obesity and central adiposity" (1.9.x), "General principles of care" (1.1.x).
8. National Institute for Health and Care Excellence. *Nutrition support for adults: oral nutrition support, enteral tube feeding and parenteral nutrition* (CG32), 2006, updated 2017. https://www.nice.org.uk/guidance/cg32/chapter/Recommendations (recs 1.4.2, 1.4.5, 1.4.6, 1.4.8).
9. da Silva JSV, Seres DS, Sabino K, et al. ASPEN consensus recommendations for refeeding syndrome. *Nutr Clin Pract* 2020;35(2):178–195. PMID 32115791. doi:10.1002/ncp.10474 (abstract only).
10. Solar H, Ortega ML, Blengini L, et al. Refeeding syndrome: applicability of ASPEN criteria in patients with intestinal failure. *Intest Fail* 2026;9:100341. PMID 42453759. doi:10.1016/j.intf.2025.100341. PMC13365916 (source for the reproduced ASPEN risk-criteria table).
11. Wilhelmi de Toledo F, et al. Safety, health improvement and well-being during a 4 to 21-day fasting period in an observational study including 1422 subjects. *PLoS One* 2019;14(1):e0209353. PMID 30601864. doi:10.1371/journal.pone.0209353.
12. Finnell JS, Saul BC, Goldhamer AC, Myers TR. Is fasting safe? A chart review of adverse events during medically supervised, water-only fasting. *BMC Complement Altern Med* 2018;18(1):67. PMID 29458369. PMC5819235. doi:10.1186/s12906-018-2136-6.
13. Kerndt PR, Naughton JL, Driscoll CE, Loxterkamp DA. Fasting: the history, pathophysiology and complications. *West J Med* 1982;137(5):379–99. PMID 6758355. PMC1274154 (scanned; text read via the TrueNorth Health Foundation copy).
14. Wilhelmi de Toledo F, Buchinger A, Burggrabe H, et al. Fasting therapy – an expert panel update of the 2002 consensus guidelines. *Forsch Komplementmed* 2013;20(6):434–43. PMID 24434758. doi:10.1159/000357602 (abstract only).
15. Michalsen A, Li C. Fasting therapy for treating and preventing disease – current state of evidence. *Forsch Komplementmed* 2013;20(6):444–53. PMID 24434759. doi:10.1159/000357765 (abstract only).
16. Stekovic S, Hofer SJ, Tripolt N, et al. Alternate day fasting improves physiological and molecular markers of aging in healthy, non-obese humans. *Cell Metab* 2019;30(3):462–476.e6. PMID 31471173. doi:10.1016/j.cmet.2019.07.016 (abstract only).
17. Zhong F, et al. Adverse events profile associated with intermittent fasting in adults with overweight or obesity: a systematic review and meta-analysis of RCTs. *Nutr J* 2024;23(1):72. PMID 38987755. PMC11234547. doi:10.1186/s12937-024-00975-9.
18. Harvie MN, Pegington M, Mattson MP, et al. The effects of intermittent or continuous energy restriction on weight loss and metabolic disease risk markers: a randomized trial in young overweight women. *Int J Obes* 2011;35(5):714–27. PMID 20921964. doi:10.1038/ijo.2010.171.
19. Knapik JJ, Jones BH, Meredith C, Evans WJ. Influence of a 3.5 day fast on physical performance. *Eur J Appl Physiol Occup Physiol* 1987;56(4):428–32. PMID 3622486. doi:10.1007/BF00417770.
20. Loy SF, Conlee RK, Winder WW, et al. Effects of 24-hour fast on cycling endurance time at two different intensities. *J Appl Physiol* 1986;61(2):654–9. PMID 3745057. doi:10.1152/jappl.1986.61.2.654.
21. Skartun O, et al. Symptoms during initiation of a ketogenic diet: a scoping review of occurrence rates, mechanisms and relief strategies. *Front Nutr* 2025;12:1538266. PMID 40206956. PMC11978633. doi:10.3389/fnut.2025.1538266.
22. Abouzed M, et al. Short-term and long-term effects of Muslim fasting on lithium pharmacokinetics and renal function in bipolar disorder. *Int J Bipolar Disord* 2025;13(1):17. PMID 40366534. PMC12078900. doi:10.1186/s40345-025-00378-7.
23. Timmer RT, Sands JM. Lithium intoxication. *J Am Soc Nephrol* 1999;10(3):666–74. PMID 10073618. doi:10.1681/ASN.V103666 (abstract not retrievable — **UNVERIFIED** content).
24. Byrne NM, Sainsbury A, King NA, Hills AP, Wood RE. Intermittent energy restriction improves weight loss efficiency in obese men: the MATADOR study. *Int J Obes* 2018;42(2):129–138. PMID 28925405. doi:10.1038/ijo.2017.206.
25. Peos JJ, Helms ER, Fournier PA, et al. Continuous versus intermittent dieting for fat loss and fat-free mass retention in resistance-trained adults: the ICECAP trial. *Med Sci Sports Exerc* 2021;53(8):1685–98. PMID 33587549. doi:10.1249/MSS.0000000000002636.
26. Villareal DT, Fontana L, Das SK, et al. Effect of two-year caloric restriction on bone metabolism and bone mineral density in non-obese younger adults: a randomized clinical trial. *J Bone Miner Res* 2016;31(1):40–51. PMID 26332798. doi:10.1002/jbmr.2701.
27. Zibellini J, Seimon RV, Lee CM, et al. Does diet-induced weight loss lead to bone loss in overweight or obese adults? A systematic review and meta-analysis of clinical trials. *J Bone Miner Res* 2015;30(12):2168–78. PMID 26012544. doi:10.1002/jbmr.2564.
28. Purcell K, Sumithran P, Prendergast LA, Bouniu CJ, Delbridge E, Proietto J. The effect of rate of weight loss on long-term weight management: a randomised controlled trial. *Lancet Diabetes Endocrinol* 2014;2(12):954–62. PMID 25459211. doi:10.1016/S2213-8587(14)70200-1.
29. Weinsier RL, Wilson LJ, Lee J. Medically safe rate of weight loss for the treatment of obesity: a guideline based on risk of gallstone formation. *Am J Med* 1995;98(2):115–7. PMID 7847427. doi:10.1016/S0002-9343(99)80394-5.
30. Weinsier RL, Ullmann DO. Gallstone formation and weight loss. *Obes Res* 1993;1(1):51–6. PMID 16350561. doi:10.1002/j.1550-8528.1993.tb00008.x.
31. Erlinger S. Gallstones in obesity and weight loss. *Eur J Gastroenterol Hepatol* 2000;12(12):1347–52. PMID 11192327. doi:10.1097/00042737-200012120-00015.
32. Liddle RA, Goldstein RB, Saxton J. Gallstone formation during weight-reduction dieting. *Arch Intern Med* 1989;149(8):1750–3. PMID 2669662.
33. Gebhard RL, Prigge WF, Ansel HJ, et al. The role of gallbladder emptying in gallstone formation during diet-induced rapid weight loss. *Hepatology* 1996;24(3):544–8. PMID 8781321. doi:10.1002/hep.510240313.
34. Stokes CS, Gluud LL, Casper M, Lammert F. Ursodeoxycholic acid and diets higher in fat prevent gallbladder stones during weight loss: a meta-analysis of randomized controlled trials. *Clin Gastroenterol Hepatol* 2014;12(7):1090–1100.e2. PMID 24321208. doi:10.1016/j.cgh.2013.11.031.
35. Kang DH, Kwon SH, Sim WY, Lew BL. Telogen effluvium associated with weight loss: a single center retrospective study. *Ann Dermatol* 2024;36(6):384–8. PMID 39623615. PMC11621640. doi:10.5021/ad.24.043.
36. Guo EL, Katta R. Diet and hair loss: effects of nutrient deficiency and supplement use. *Dermatol Pract Concept* 2017;7(1):1–10. PMID 28243487. PMC5315033. doi:10.5826/dpc.0701a01.
37. Tsai AG, Wadden TA. The evolution of very-low-calorie diets: an update and meta-analysis. *Obesity* 2006;14(8):1283–93. PMID 16988070. doi:10.1038/oby.2006.146.
38. Sours HE, Frattali VP, Brand CD, et al. Sudden death associated with very low calorie weight reduction regimens. *Am J Clin Nutr* 1981;34(4):453–61. PMID 7223697. doi:10.1093/ajcn/34.4.453.
39. Isner JM, Sours HE, Paris AL, Ferrans VJ, Roberts WC. Sudden, unexpected death in avid dieters using the liquid-protein-modified-fast diet: observations in 17 patients and the role of the prolonged QT interval. *Circulation* 1979;60(6):1401–12. PMID 498466. doi:10.1161/01.cir.60.6.1401 (abstract only).
40. Lantigua RA, Amatruda JM, Biddle TL, Forbes GB, Lockwood DH. Cardiac arrhythmias associated with a liquid protein diet for the treatment of obesity. *N Engl J Med* 1980;303(13):735–8. PMID 7402271. doi:10.1056/NEJM198009253031305 (abstract only).
41. Formisano E, Schiavetti I, Gradaschi R, et al. The real-life use of a protein-sparing modified fast diet by nasogastric tube (ProMoFasT) in adults with obesity: an open-label randomized controlled trial. *Nutrients* 2023;15(22):4822. PMID 38004217. PMC10674249. doi:10.3390/nu15224822.
42. Kossoff EH, Zupec-Kania BA, Auvin S, et al. Optimal clinical management of children receiving dietary therapies for epilepsy: updated recommendations of the International Ketogenic Diet Study Group. *Epilepsia Open* 2018;3(2):175–192. PMID 29881797. PMC5983110. doi:10.1002/epi4.12225.
43. Dyńka D, Rodzeń Ł, Rodzeń M, et al. The ketogenic diet is not for everyone: contraindications, side effects, and drug interactions. *Ann Med* 2026;58(1):2603016. PMID 41486865. PMC12777878. doi:10.1080/07853890.2025.2603016.
44. Goldenberg RM, Berard LD, Cheng AYY, et al. SGLT2 inhibitor-associated diabetic ketoacidosis: clinical review and recommendations for prevention and diagnosis. *Clin Ther* 2016;38(12):2654–2664.e1. PMID 28003053. doi:10.1016/j.clinthera.2016.11.002.
45. von Geijer L, Ekelund M. Ketoacidosis associated with low-carbohydrate diet in a non-diabetic lactating woman: a case report. *J Med Case Rep* 2015;9:224. PMID 26428083. PMC4591635. doi:10.1186/s13256-015-0709-2.
46. Burén J, Ericsson M, Damasceno NRT, Sjödin A. A ketogenic low-carbohydrate high-fat diet increases LDL cholesterol in healthy, young, normal-weight women: a randomized controlled feeding trial. *Nutrients* 2021;13(3):814. PMID 33801247. PMC8001988. doi:10.3390/nu13030814.
47. Evert AB, Dennison M, Gardner CD, et al. Nutrition therapy for adults with diabetes or prediabetes: a consensus report. *Diabetes Care* 2019;42(5):731–754. PMID 31000505. PMC7011201. doi:10.2337/dci19-0014.
48. Bauer J, Biolo G, Cederholm T, et al. Evidence-based recommendations for optimal dietary protein intake in older people: a position paper from the PROT-AGE Study Group. *J Am Med Dir Assoc* 2013;14(8):542–59. PMID 23867520. doi:10.1016/j.jamda.2013.05.021.
49. Villareal DT, Chode S, Parimi N, et al. Weight loss, exercise, or both and physical function in obese older adults. *N Engl J Med* 2011;364(13):1218–29. PMID 21449785. doi:10.1056/NEJMoa1008234.
50. Malmstrom TK, Miller DK, Simonsick EM, Ferrucci L, Morley JE. SARC-F: a symptom score to predict persons with sarcopenia at risk for poor functional outcomes. *J Cachexia Sarcopenia Muscle* 2016;7(1):28–36. PMID 27066316. doi:10.1002/jcsm.12048.
51. KDIGO CKD Work Group. KDIGO 2024 clinical practice guideline for the evaluation and management of chronic kidney disease. *Kidney Int* 2024;105(4S):S117–S314. PMID 38490803. doi:10.1016/j.kint.2023.10.018 (rec 3.3.1.1 and practice points 3.3.1.1–3.3.1.3; PDF read).
52. Devries MC, Sithamparapillai A, Brimble KS, Banfield L, Morton RW, Phillips SM. Changes in kidney function do not differ between healthy adults consuming higher- compared with lower- or normal-protein diets: a systematic review and meta-analysis. *J Nutr* 2018;148(11):1760–75. PMID 30383278. PMC6236074. doi:10.1093/jn/nxy197.
53. Wolfe RR, Cifelli AM, Kostas G, Kim IY. Optimizing protein intake in adults: interpretation and application of the Recommended Dietary Allowance compared with the Acceptable Macronutrient Distribution Range. *Adv Nutr* 2017;8(2):266–75. PMID 28298271. PMC5347101. doi:10.3945/an.116.013821.
54. Longland TM, Oikawa SY, Mitchell CJ, Devries MC, Phillips SM. Higher compared with lower dietary protein during an energy deficit combined with intense exercise promotes greater lean mass gain and fat mass loss: a randomized trial. *Am J Clin Nutr* 2016;103(3):738–46. PMID 26817506. doi:10.3945/ajcn.115.119339.
55. Helms ER, Zinn C, Rowlands DS, Brown SR. A systematic review of dietary protein during caloric restriction in resistance trained lean athletes: a case for higher intakes. *Int J Sport Nutr Exerc Metab* 2014;24(2):127–38. PMID 24092765. doi:10.1123/ijsnem.2013-0054.
56. Hector AJ, Phillips SM. Protein recommendations for weight loss in elite athletes: a focus on body composition and performance. *Int J Sport Nutr Exerc Metab* 2018;28(2):170–7. PMID 29182451. doi:10.1123/ijsnem.2017-0273 (abstract only).
57. Jäger R, Kerksick CM, Campbell BI, et al. International Society of Sports Nutrition position stand: protein and exercise. *J Int Soc Sports Nutr* 2017;14:20. PMID 28642676. PMC5477153. doi:10.1186/s12970-017-0177-8.
58. Bilsborough S, Mann N. A review of issues of dietary protein intake in humans. *Int J Sport Nutr Exerc Metab* 2006;16(2):129–52. PMID 16779921. doi:10.1123/ijsnem.16.2.129.
59. European Food Safety Authority. *Overview on Dietary Reference Values for the EU population as derived by the EFSA NDA Panel* (summary tables, version 4, Sept 2017). https://www.efsa.europa.eu/sites/default/files/assets/DRV_Summary_tables_jan_17.pdf
60. National Academies of Sciences, Engineering, and Medicine. *Dietary Reference Intakes for Sodium and Potassium.* Washington DC: National Academies Press; 2019. doi:10.17226/25353 (Summary tables S-1, S-2). https://nap.nationalacademies.org/read/25353/chapter/2
61. Costello R, Rosanoff A, Nielsen F, et al. Perspective: call for re-evaluation of the tolerable upper intake level for magnesium supplementation in adults. *Adv Nutr* 2023;14(5):973–82. PMID 37487817. PMC10509448. doi:10.1016/j.advnut.2023.06.008.
62. Wolff J, Cober MP, Huff KA. Essential fatty acid deficiency in parenteral nutrition: historical perspective and modern solutions, a narrative review. *Nutr Clin Pract* 2025;40(2):350–67. PMID 39961748. PMC11879921. doi:10.1002/ncp.11278.
63. Whittaker J, Wu K. Low-fat diets and testosterone in men: systematic review and meta-analysis of intervention studies. *J Steroid Biochem Mol Biol* 2021;210:105878. PMID 33741447. doi:10.1016/j.jsbmb.2021.105878 (erratum 2026;255:106880).
64. Iraki J, Fitschen P, Espinar S, Helms E. Nutrition recommendations for bodybuilders in the off-season: a narrative review. *Sports* 2019;7(7):154. PMID 31247944. PMC6680710. doi:10.3390/sports7070154.
65. Hew-Butler T, Loi V, Pani A, Rosner MH. Exercise-associated hyponatremia: 2017 update. *Front Med* 2017;4:21. PMID 28316971. PMC5334560. doi:10.3389/fmed.2017.00021.
66. Rossow LM, Fukuda DH, Fahs CA, Loenneke JP, Stout JR. Natural bodybuilding competition preparation and recovery: a 12-month case study. *Int J Sports Physiol Perform* 2013;8(5):582–92. PMID 23412685. doi:10.1123/ijspp.8.5.582.
67. Hulmi JJ, Isola V, Suonpää M, et al. The effects of intensive weight reduction on body composition and serum hormones in female fitness competitors. *Front Physiol* 2016;7:689. PMID 28119632. PMC5222856. doi:10.3389/fphys.2016.00689.
68. Sundgot-Borgen J, Meyer NL, Lohman TG, et al. How to minimise the health risks to athletes who compete in weight-sensitive sports: review and position statement on behalf of the Ad Hoc Research Working Group on Body Composition, Health and Performance, under the auspices of the IOC Medical Commission. *Br J Sports Med* 2013;47(16):1012–22. PMID 24115480. doi:10.1136/bjsports-2013-092966 (abstract only).
69. Gallagher D, Heymsfield SB, Heo M, Jebb SA, Murgatroyd PR, Sakamoto Y. Healthy percentage body fat ranges: an approach for developing guidelines based on body mass index. *Am J Clin Nutr* 2000;72(3):694–701. PMID 10966886. doi:10.1093/ajcn/72.3.694 (abstract only; SEE from abstract).
70. Kalm LM, Semba RD. They starved so that others be better fed: remembering Ancel Keys and the Minnesota experiment. *J Nutr* 2005;135(6):1347–52. PMID 15930436. doi:10.1093/jn/135.6.1347.
71. Patton GC, Selzer R, Coffey C, Carlin JB, Wolfe R. Onset of adolescent eating disorders: population based cohort study over 3 years. *BMJ* 1999;318(7186):765–8. PMID 10082698. doi:10.1136/bmj.318.7186.765.
72. Neumark-Sztainer D, Wall M, Larson NI, Eisenberg ME, Loth K. Dieting and disordered eating behaviors from adolescence to young adulthood: findings from a 10-year longitudinal study. *J Am Diet Assoc* 2011;111(7):1004–11. PMID 21703378. doi:10.1016/j.jada.2011.04.012.
73. Golden NH, Schneider M, Wood C; AAP Committee on Nutrition, Committee on Adolescence, Section on Obesity. Preventing obesity and eating disorders in adolescents. *Pediatrics* 2016;138(3):e20161649. PMID 27550979. doi:10.1542/peds.2016-1649.
74. Simpson CC, Mazzeo SE. Calorie counting and fitness tracking technology: associations with eating disorder symptomatology. *Eat Behav* 2017;26:89–92. PMID 28214452. doi:10.1016/j.eatbeh.2017.02.002.
75. Levinson CA, Fewell L, Brosof LC. My Fitness Pal calorie tracker usage in the eating disorders. *Eat Behav* 2017;27:14–16. PMID 28843591. doi:10.1016/j.eatbeh.2017.08.003. (Note: *Eating Behaviors*, not *Int J Eat Disord*.)
76. Linardon J, Messer M. My fitness pal usage in men: associations with eating disorder symptoms and psychosocial impairment. *Eat Behav* 2019;33:13–17. PMID 30772765. doi:10.1016/j.eatbeh.2019.02.003.
77. Honary M, Bell BT, Clinch S, Wild SE, McNaney R. Understanding the role of healthy eating and fitness mobile apps in the formation of maladaptive eating and exercise behaviors in young people. *JMIR Mhealth Uhealth* 2019;7(6):e14239. PMID 31215514. PMC6604512. doi:10.2196/14239.
78. Morgan JF, Reid F, Lacey JH. The SCOFF questionnaire: assessment of a new screening tool for eating disorders. *BMJ* 1999;319(7223):1467–8. PMID 10582927. PMC28290. doi:10.1136/bmj.319.7223.1467.
79. Kutz AM, Marsh AG, Gunderson CG, Maguen S, Masheb RM. Eating disorder screening: a systematic review and meta-analysis of diagnostic test characteristics of the SCOFF. *J Gen Intern Med* 2020;35(3):885–93. PMID 31705473. PMC7080881. doi:10.1007/s11606-019-05478-6.
80. Mond JM, Myers TC, Crosby RD, et al. Screening for eating disorders in primary care: EDE-Q versus SCOFF. *Behav Res Ther* 2008;46(5):612–22. PMID 18359005. doi:10.1016/j.brat.2008.02.003.
81. Beat (UK eating disorders charity). Support helplines. https://www.beateatingdisorders.org.uk/get-information-and-support/get-help-for-myself/i-need-support-now/
82. Butterfly Foundation (Australia). National helpline. https://butterfly.org.au/get-support/helpline/
83. Throughline. Find A Helpline. https://www.findahelpline.com/
84. National Eating Disorders Association (US). Get help / screening tool / find treatment. https://www.nationaleatingdisorders.org/help-support/contact-helpline/
85. Bredin SSD, et al. PAR-Q+ and ePARmed-X+: new risk stratification and physical activity clearance strategy for physicians and patients alike. *Can Fam Physician* 2013;59(3):273–7. PMID 23486800 (abstract only).
86. PAR-Q+ Collaboration. *PAR-Q+ — The Physical Activity Readiness Questionnaire for Everyone* (2025 form; © PAR-Q+ Collaboration). https://eparmedx.com/wp-content/uploads/2025/01/PARQPlus2025Fillable.pdf
87. Riebe D, Franklin BA, Thompson PD, et al. Updating ACSM's recommendations for exercise preparticipation health screening. *Med Sci Sports Exerc* 2015;47(11):2473–9. PMID 26473759. doi:10.1249/MSS.0000000000000664.
88. American College of Sports Medicine. Position stand: progression models in resistance training for healthy adults. *Med Sci Sports Exerc* 2009;41(3):687–708. PMID 19204579. doi:10.1249/MSS.0b013e3181915670.
89. Nielsen RØ, Parner ET, Nohr EA, et al. Excessive progression in weekly running distance and risk of running-related injuries: an association which varies according to type of injury. *J Orthop Sports Phys Ther* 2014;44(10):739–47. PMID 25155475. doi:10.2519/jospt.2014.5164.
90. Buist I, Bredeweg SW, van Mechelen W, et al. No effect of a graded training program on the number of running-related injuries in novice runners: a randomized controlled trial. *Am J Sports Med* 2008;36(1):33–9. PMID 17940147. doi:10.1177/0363546507307505.
91. Damsted C, Glad S, Nielsen RO, Sørensen H, Malisoux L. Is there evidence for an association between changes in training load and running-related injuries? A systematic review. *Int J Sports Phys Ther* 2018;13(6):931–42. PMID 30534459. PMC6253751.
92. Armstrong LE, Casa DJ, Millard-Stafford M, et al. American College of Sports Medicine position stand: exertional heat illness during training and competition. *Med Sci Sports Exerc* 2007;39(3):556–72. PMID 17473783. doi:10.1249/MSS.0b013e31802fa199.
93. World Health Organization. Physical activity fact sheet. https://www.who.int/news-room/fact-sheets/detail/physical-activity
94. European Food Safety Authority. Caffeine (topic page summarising the Scientific Opinion on the safety of caffeine, *EFSA J* 2015;13(5):4102). https://www.efsa.europa.eu/en/topics/topic/caffeine
95. US Food and Drug Administration. Spilling the beans: how much caffeine is too much? (consumer update). https://www.fda.gov/consumers/consumer-updates/spilling-beans-how-much-caffeine-too-much
96. Kreider RB, Kalman DS, Antonio J, et al. International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine. *J Int Soc Sports Nutr* 2017;14:18. PMID 28615996. PMC5469049.
97. NHS (UK). Calculating alcohol units. https://www.nhs.uk/live-well/alcohol-advice/calculating-alcohol-units/
98. Canadian Centre on Substance Use and Addiction. *Canada's Guidance on Alcohol and Health* (2023). https://www.ccsa.ca/canadas-guidance-alcohol-and-health
99. WHO Regional Office for Europe. No level of alcohol consumption is safe for our health (news release, 4 Jan 2023). https://www.who.int/europe/news/item/04-01-2023-no-level-of-alcohol-consumption-is-safe-for-our-health
100. US Departments of Health and Human Services and Agriculture. *Dietary Guidelines for Americans, 2025–2030.* https://cdn.realfood.gov/DGA.pdf (alcohol: "consume less alcohol"; protein serving goal 1.2–1.6 g/kg/d; sodium < 2,300 mg/d).
101. Institute of Medicine. *Weight Gain During Pregnancy: Reexamining the Guidelines.* Washington DC: National Academies Press; 2009 (Summary, Table S-1). https://nap.nationalacademies.org/read/12584/chapter/2
102. Lovelady CA, Garner KE, Moreno KL, Williams JP. The effect of weight loss in overweight, lactating women on the growth of their infants. *N Engl J Med* 2000;342(7):449–53. PMID 10675424. doi:10.1056/NEJM200002173420701.
103. US FDA. *General Wellness: Policy for Low Risk Devices* — guidance issued 6 January 2026 (supersedes 27 Sep 2019; docket FDA-2014-N-1039). https://www.fda.gov/media/90652/download
104. US FDA. *Clinical Decision Support Software* — guidance issued 29 January 2026 (supersedes the 6 January 2026 version). https://www.fda.gov/media/109618/download
105. US FDA. *Policy for Device Software Functions and Mobile Medical Applications* — 28 September 2022. https://www.fda.gov/media/80958/download
106. Medical Device Coordination Group. *MDCG 2019-11 rev.1: Guidance on qualification and classification of software in Regulation (EU) 2017/745 – MDR and 2017/746 – IVDR* (June 2025). https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en?filename=mdcg_2019_11_en.pdf
107. US Federal Trade Commission. *Health Products Compliance Guidance* (December 2022). https://www.ftc.gov/system/files/ftc_gov/pdf/Health-Products-Compliance-Guidance.pdf
108. Regulation (EU) 2016/679 (GDPR), Arts 2, 4, 9. Official text: https://eur-lex.europa.eu/eli/reg/2016/679/oj (text read via the unofficial mirror https://gdpr-info.eu/).
109. European Data Protection Board. *Guidelines 2/2023 on Technical Scope of Art. 5(3) of ePrivacy Directive*, v2.0, adopted 7 Oct 2024. https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf
110. van der Bles AM, van der Linden S, Freeman ALJ, et al. Communicating uncertainty about facts, numbers and science. *R Soc Open Sci* 2019;6(5):181870. PMID 31218028. PMC6549952. doi:10.1098/rsos.181870.
111. van der Bles AM, van der Linden S, Freeman ALJ, Spiegelhalter DJ. The effects of communicating uncertainty on public trust in facts and numbers. *Proc Natl Acad Sci USA* 2020;117(14):7672–83. PMID 32205438. PMC7149229. doi:10.1073/pnas.1913678117.
112. Pavlidou E, et al. Clinical evidence of low-carbohydrate diets against obesity and diabetes mellitus. *Metabolites* 2023. PMID 36837859. PMC9962697 (quotes the IOM carbohydrate RDA 130 g/d and AMDR 45–65 %).
113. Lambeau KV, McRorie JW. Fiber supplements and clinically proven health benefits: how to recognize and recommend an effective fiber therapy. *J Am Assoc Nurse Pract* 2017. PMID 28252255. PMC5413815 (quotes the IOM fibre intake of 14 g/1000 kcal).
114. Marinescu SCN, Apetroaei MM, et al. Dietary influence on drug efficacy: a comprehensive review of ketogenic diet–pharmacotherapy interactions. *Nutrients* 2024;16(8):1213. PMID 38674903. PMC11054576. doi:10.3390/nu16081213.
