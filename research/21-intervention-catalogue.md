# 21 — Intervention catalogue: every other lever a person can pull, rated for evidence and for the goals it serves

Dossier v1 · 2026-09-30 · research agent 21 · follows `research/RESEARCH_PROTOCOL.md` (adapted: sections 2-4 are one entry per lever)
Literature access: Europe PMC REST + PMC full texts, queried 2026-09-30. `UNVERIFIED` = number recalled from memory or derived and not
re-located in a primary source in this session. `PROPOSED FIT` / `PROPOSED` = our own engineering choice, data points listed.
Cross-references by dossier number: 01 body-weight models, 02 energy expenditure, 03 protein, 04 carbohydrate/glucose, 05 ketosis,
06 lipids/BP, 07 timing/fasting, 08 autophagy, 09 resistance training, 10 cardio, 11 surplus, 12 hormones/appetite (not yet written at time
of research), 13 transitions/periodisation, 15 fibre/hydration/substances, 16 sleep/stress/sex/age, 17 safety, 18 planner, 19 performance,
20 extended fasting.

> **Bottom line (read first)**
> 1. Outside diet composition, training and fasting, **very few levers change body composition by themselves**. The ones that do work
>    almost entirely by changing *intake or adherence* (sleep extension −270 kcal/d [1]; portion/plate size −144 to −228 kcal/d if sustained
>    [137]; ultra-processed vs unprocessed food +508 kcal/d [138]; self-monitoring −1.7 to −2.9 kg [139,142]), **not** by adding expenditure.
> 2. **Expenditure gadgets are small.** Standing instead of sitting = +0.15 kcal/min (95 % CI 0.12–0.17) = ~9 kcal/h [15]; a sit-stand desk
>    removed 57–100 min/d of sitting [16] ⇒ ~9–15 kcal/d. Cold-recruited brown fat: the best RCT reports +180 kcal/d "cold-induced
>    thermogenesis" after 6 wk, a 24-h-equivalent rate (meta-analytic acute effect +188 kcal/d [195]), i.e. ~10–25 kcal per 2-h session; the
>    reported fat loss (−0.70 kg/6 wk, n = 11) cannot be explained by it [41]. Verdict: not a fat-loss lever.
> 3. **Creatine is the only supplement with grade-A evidence for lean mass**: +1.10 kg (95 % CI 0.56–1.65) with resistance training [52],
>    +1.37 kg (0.97–1.76) in older adults [51]; loading 20 g/d × 6 d or 3 g/d × 28 d raises muscle total creatine ~20 %, washout ~30 d [55];
>    adds ~0.75–0.9 kg of body water [56]. Model it as a state with a saturation kinetic.
> 4. **Caffeine** (3–6 mg/kg) improves endurance time-trial time by 2.2 % (ES 0.41) [60] but costs ~45 min of total sleep time if taken inside
>    the dose-dependent cut-off (≈8.8 h before bed for a coffee, ≈13 h for a pre-workout dose) [4]. Its "fat-loss" role is not credit-worthy.
> 5. **Rejected as fat-loss / muscle levers (citations in §4K):** green-tea catechins (−0.04 kg, Cochrane [85]), glucomannan/chitosan/CLA (none
>    reached the 2.5 kg clinical threshold [104]), omega-3 for weight (0.00 kg [66]), vitamin D for weight (null [69]), probiotics (−0.26 kg, ns
>    [92]), berberine for weight (−0.11 kg, ns [88]), HMB in young lifters [108], NMN/NR [93,94], resveratrol in non-diabetics [96], spermidine
>    [98], vitamin C/E during endurance training (harmful to adaptation markers [110]), ketone esters for performance (−2 % [83]), fasted cardio
>    for fat loss [30], carb back-loading (no RCT located), high-protein breakfast for weight [133].
> 6. **Viscous fibre and omega-3 are lipid/BP levers, not fat-loss levers**: psyllium ~10 g/d LDL −0.33 mmol/L (28 trials) [111]; oat β-glucan
>    ≥3 g/d LDL −0.25 mmol/L [113]; EPA+DHA 2–3 g/d SBP −2.6 mmHg [64], TG ≥30 % lower at 4 g/d in TG ≥500 mg/dL [65]; but AF risk HR 1.25 (1.07–1.46),
>    1.49 above 1 g/d [67].
> 7. **Glycaemia-only levers** (real, short-lived, do not move fat mass): light walking after meals (iAUC ratio 0.88; 0.78 after dinner [19]),
>    2-min activity breaks (iAUC −25 % [20]), protein/vegetables before carbohydrate (iAUC −38.8 % in prediabetes, n = 15 [122]).
> 8. **Sauna** has a large but confounded cohort signal (4–7 vs 1 sessions/wk: sudden cardiac death HR 0.37 [31]); RCT evidence is small
>    (SBP −8.0 mmHg vs exercise alone, n = 47 [34]); endurance benefit of post-exercise heat exposure is trivial in the meta-analysis
>    (ratio 1.04, 0.94–1.15, low certainty [37]); the "GH ×16" claim is an acute response that declined after day 3 of twice-daily sauna [38].
> 9. **Post-exercise cold-water immersion attenuates strength gains** (ES −0.23, −0.45 to −0.01, limb immersion −0.31; whole-body −0.08 ns [47];
>    mechanistic RCT [46]) — the one thermal lever that produces a *planner conflict rule*.
> 10. **Medical levers dwarf every lifestyle lever** (semaglutide −14.9 % at 68 wk [156]; tirzepatide 15 mg −20.9 % at 72 wk [157];
>    retatrutide phase 2 −24.2 % at 48 wk [158]; Roux-en-Y −25 % at 10 y [163]). They are out of scope for prescribing but must trigger disclaimers.
> 11. **Adherence levers can be fed to the adherence model (01 §4.4.2 / 18 §4.9)** rather than to physiology: food records −0.52 kg per additional
>    weekly record (observational within an RCT, n = 1685) [141]; meal replacement Hedges g 0.26 vs food-based diets [128]; financial incentives
>    SMD 0.18 during but 0.03 after the incentive [148].
> 12. Biggest uncertainties: sauna/cold dose–response (tiny RCTs), the true energy value of cold exposure, sleep-extension durability beyond the trial period,
>    and the mapping from behavioural effect sizes to a per-day adherence probability (PROPOSED, grade D).

---

## 1. Scope

The catalogue lists **levers** — things a person can do on a given day or week — that plausibly change body composition, metabolism,
performance, hormones, wellbeing or cellular outcomes over 1–6 months, and rates each one so that (i) the simulator can expose it as an input,
(ii) the planner (18) can use it as a building block, and (iii) the UI can show an honest evidence grade. Levers owned in depth by other dossiers
(macronutrients 03/04/05/11, meal timing and fasting 07/13/20, resistance and cardio training 09/10, sleep 16, autophagy 08, safety 17) get a
short pointer entry with the numbers this dossier verified. Effort went to levers nobody else owns: patterning tricks, movement micro-doses,
thermal exposure, supplements, behavioural levers and medical levers.

**Verdict key.**
`MODEL` = simulator input **and** planner lever · `SIM` = simulator input only (planner never uses it to satisfy a goal) ·
`INFO` = warning / information only, no state change · `ADH` = feeds the adherence / ad-libitum-intake model (01 §4.4.2, 18 §4.9, 12) ·
`REJECT` = insufficient or null evidence (citation given, listed in §4K).

**Grade key (protocol).** A meta-analysis / validated model / several controlled human trials · B few human RCTs or consistent mechanistic human
data · C limited or indirect human data (cohort, single small RCT) · D animal / in-vitro / opinion.

**Entry template.** *Def* (what exactly is done, measurable) · *Effect* (outcome, size, CI, population) · *Time* (onset, time-constant, washout) ·
*Dose* (dose–response) · *Interacts* · *Avoid* (who should not) · *Grade* · *Verdict* · refs `[n]` (§11).

**Method note.** Every effect size below was read from the abstract or full text located via Europe PMC/PMC on 2026-09-30. Where only an
abstract was available, the number is the abstract's. Populations are stated because most trials are young/middle-aged, lean-to-overweight,
and disproportionately male.

---

## 2. State variables (new, lever-specific)

Only levers with genuine carry-over need state. Everything else in the catalogue is a memoryless multiplier or an input to an existing state
of another dossier.

| Name | Unit | Range | Represents | Initial-value rule | Owner of dynamics |
|---|---|---|---|---|---|
| `CrLoad` | – | 0–1 | fraction of the maximal creatine-induced rise in muscle total creatine (+~20 %; up to 20–40 % in some subjects [57]) | 0 unless `creatineG` is being taken at t0 (then user states weeks on creatine; 1 if ≥4 wk at ≥3 g/d) | this dossier (§4F-1) |
| `BATidx` | – | 0–1 | cold-recruited non-shivering thermogenic capacity ("brown-fat recruitment") | 0.3 default adult (BAT present in 23/24 cold-exposed men, lower in overweight [40]); 0 if user reports permanent warm-only living (PROPOSED) | this dossier (§4D-3) |
| `HeatIdx` | – | 0–1 | heat acclimation / plasma-volume expansion (D-grade; only used for endurance-in-heat and sauna BP scalar) | 0 | this dossier (§4D-1); deliberately minimal |
| `CaffLoad` | mg | 0–800 | body caffeine pool for the sleep-conflict test (first-order elimination; half-life ~5 h `UNVERIFIED`) | 0 at wake | this dossier (§4F-3) |
| `pAdhere_lever` | – | −0.05…+0.15 | additive shift to monthly adherence probability from behavioural levers | 0 | feeds 01 §4.4.2 / 18 §4.9 |
| `SleepDebtEff` | h | 0–3 | effective habitual short-sleep amount that mediates intake/partition effects | from `sleepHours` | 16 (this dossier supplies effect sizes) |

`CrLoad` and `BATidx` have their own ODEs; `HeatIdx` is a placeholder (τ ≈ 14 d, `UNVERIFIED`); the rest are computed within a day from inputs.

---

## 3. Inputs that drive it — Deliverable (b): recommended additional simulator inputs

All extras default to **off / typical**, so a casual user can ignore them. Each entry says which model parameter it modifies and by what factor.
Factors marked PROPOSED are engineering choices anchored to the cited data points; ranges are the evidence envelopes the planner's
`ParamSpec.evidence` should carry (18 §4.4.1).

| # | Input (id) | Unit / domain | Default | Enters the model at | Factor / equation | Range | Grade |
|---|---|---|---|---|---|---|---|
| X1 | `creatineG` | g/d, 0–20 | 0 | `CrLoad` ODE (§4F-1); reported lean mass/scale; RT accretion | `dC/dt = k_up(D)(1−C) − k_dn·C·max(0,1−D/2)`, `k_up = 0.5·(D/20)^0.75 d⁻¹` (D=20 → 0.5; D=3 → 0.12), `k_dn = 0.10 d⁻¹`; scale water `+0.9·C kg`; RT accretion `A_r ← A_r·(1+0.15·C)` | 0–0.30 | A (lean), B (kinetics) |
| X2 | `caffeineMg`, `caffeineLastClock` | mg/d 0–600; clock | 0 | sleep module (16); performance flag (19) | if last dose < `t_cut(D)` h before bed: TST −45 min, SE −7 %, SOL +9 min, WASO +12 min, N3 −11 min; `t_cut(D)=8.8+6.2·ln(D/107)` h; TT time −2.2 % at 3–6 mg/kg pre-session | t_cut 8.8–13.2 h | A |
| X3 | `omega3G` (EPA+DHA) | g/d, 0–4 | 0 | 06 lipids/BP | SBP `−2.6·min(D,2)/2` mmHg, plateau 2–3 g/d, no further gain >3 g [64]; TG ≥30 % ↓ at 4 g/d if TG ≥500 mg/dL, LDL ↑ [65]; AF risk flag if D>1 g/d [67] | SBP −1.5…−4.5 | A |
| X4 | `viscousFibreG` (psyllium/β-glucan/glucomannan) | g/d, 0–20 | 0 | 06 LDL, 04 glucose, 12 satiety, 15 fibre | LDL `−0.032·min(D,10.2) mmol/L` for psyllium [111]; oat β-glucan flat `−0.25` mmol/L at ≥3 g/d [113]; weight `−0.33 kg` (−0.51…−0.14) [114]; FBG `−37 mg/dL` only if treated T2DM [112] | – | A |
| X5 | `postMealWalkMin` (per meal) | min, 0–30 | 0 | 04 meal glucose/insulin response | meal glucose iAUC × 0.88 (0.78–0.99); dinner × 0.78 (0.67–0.91) [19]; 2-min bouts every 20 min (bout timing `UNVERIFIED` in the abstract): × 0.75 (glucose), × 0.76 (insulin) [20] | – | B |
| X6 | `standingHoursPerDay` | h/d, 0–8 | 0 (extra over baseline) | 02 NEAT | `+0.15 kcal/min = +9 kcal/h` (7.2–10.2) [15] | – | A (kcal), C (health) |
| X7 | `saunaSessionsPerWeek`, `saunaMin`, `saunaTempC` | n/wk, min, °C | 0 | 06 BP scalar; `HeatIdx` | SBP shift `−4 mmHg·min(1,sessions/3)` after ≥8 wk (PROPOSED 50 % shrink of RCT −8.0 [34]); HeatIdx tau 14 d `UNVERIFIED` | 0…−8 | C |
| X8 | `coldMinPerDay`, `coldTempC`, `coldMode` | min, °C, air/shower/immersion | 0 | `BATidx`; EE; RT accretion penalty | see §4D-3; `f_CWI = 0.8` on RT strength/hypertrophy accretion if immersion ≤15 °C within 1 h after RT ≥2×/wk (limb) | 0.5–1.0 | B (CWI penalty), C (BAT) |
| X9 | `mealOrderProteinFirst` | bool, per meal | false | 04 glucose absorption shape | meal iAUC × 0.61 if protein+vegetables ≥10 min before carbohydrate (−38.8 %, n = 15 prediabetes [122]); glycaemia only | 0.6–0.9 | C/B |
| X10 | `preMealWaterMl` | mL before main meals, 0–500 | 0 | ad-lib intake (ADH) | acute meal EI −43 kcal at 500 mL [129]; 12-wk weight −1.3 to −2 kg extra on a deficit [129,130] (do not double count: use as `pAdhere` +0.03) | – | B/C |
| X11 | `upfShare` | % energy 0–100 | habitual | ad-lib mode only (12) | `ΔEI_adlib = +6.4 kcal/d per %-point of UPF energy share` (PROPOSED linear; 508 kcal/d ÷ ~80 % UPF share, the 80 % is `UNVERIFIED`); measured +508 ± 106 kcal/d over 14 d, +459 ± 105 in the final week [138] | +0…+510 kcal/d | B |
| X12 | `energyDensity` | kcal/g (served) | 1.5 | ad-lib mode only | lower ED (1.1 vs 1.5 kcal/g) −223 kcal per tested intake period (95 % CI −259.7…−186.0; 38 RCTs, 15 of them single-meal designs) [124]; daily-level SMD −1.0 (−1.27…−0.75) [125] | – | A (intake), B (weight) |
| X13 | `liquidKcalPerDay` | kcal/d | habitual | ad-lib compensation | liquid energy compensation ≈ 0 % (−17 %) vs solids ≈ 118 % [126]; swap SSB→low/no-calorie −1.06 kg (−1.71…−0.41) [127] | – | B |
| X14 | `selfMonitor` {`weighInsPerWeek`, `foodLogDays`} | n/wk | 0,0 | `pAdhere_lever` | package Δp = +0.10 (0.05–0.15) PROPOSED; anchors −1.7 kg [139], −2.87 kg [142], −0.52 kg per weekly record [141] | – | B/D (mapping) |
| X15 | `mealReplacementShare` | % energy 0–100 | 0 | `pAdhere_lever` | Δp = +0.05 if ≥1 meal/d replaced (g 0.26 [128]); g 0.545 if ≥60 % of energy | 0–0.10 | A (g), D (mapping) |
| X16 | `nitrateMg`, `betaAlanineG`, `citrullineG`, `bicarbGperKg` | mg, g, g, g/kg | 0 | 19 performance multipliers (event days) | ES: TTE 0.33 (0.15–0.50) [75]; 4–10 min 0.55 (0.07–1.04) [77]; strength/power 0.20 (0.01–0.39) [78]; small for HIIE [80]; conversion `%TT ≈ 5.4×ES` PROPOSED from [60] | – | A/B |
| X17 | `alcoholGPerKgPostRT` | g/kg | 0 | 03/09 MPS | post-RT MPS −24 % (with protein) to −37 % (with carbohydrate) at 1.5 g/kg (~12 drinks) [155]; lower doses not measured | – | B (single dose) |
| X18 | `medications` flags | GLP-1RA/GIP, metformin, SGLT2i, orlistat, testosterone, thyroid, post-bariatric | none | 17 gate; planner disabled | not simulated; disclaimer + planner lockout (SGLT2i + low carbohydrate/fasting → ketoacidosis warning [165]) | – | – |
| X19 | `sleepHours`, `sleepRegularity` | h, SRI 0–100 | 7.5, – | 16 (partition and ad-lib intake) | `EI_adlib −225 kcal/d per +1 h` when habitual <6.5 h (linear, 5.5–8.5 h) PROPOSED from −270/1.2 h [1]; FFM share of loss 80 % at 5.5 h vs 52 % at 8.5 h [2] | – | B |

Steps, NEAT and cardio are **core** inputs (02/10); the catalogue supplies effect sizes for them in §4C but does not add new input fields.

---

## 4. Mechanisms & equations — the catalogue (one entry per lever)

Entries are grouped: **A** energy/macronutrient patterning · **B** fasting family (pointers) · **C** movement · **D** thermal · **E** sleep &
circadian · **F** supplements/substances · **G** behavioural · **H** medical (out of scope). Deliverables (a) matrix, (c) planner blocks and
(d) rejected list follow in §4I–4K.

### 4A. Energy / macronutrient patterning

**A1. Protein pulsing vs even distribution** (owner 03) — verdict `SIM`, grade B (acute MPS) / C (chronic muscle mass)
- *Def:* same daily protein (g/kg) split into ~3–4 feedings of ≥0.3–0.4 g/kg (≈25–40 g) vs skewed to one large evening feeding.
- *Effect:* 24-h mixed-muscle FSR **+25 %** with even (31.5/29.9/32.7 g) vs skewed (10.7/16.0/63.4 g) intake (0.075 vs 0.056 %/h, P = 0.003;
  n = 8, age 36.9 y, BMI 25.7, 7-d crossover) [118]. In healthy 65–80 y adults (n = 24) even vs skewed gave **no** difference in MPS or amino-acid
  utilisation [119]. Systematic review of 15 studies: even distribution associated with higher muscle mass in 3/7, strength 2/7, protein turnover 1/6
  [120]. Protein *timing* around training: no significant benefit once covariates (total protein) are controlled in a meta-regression of 23 hypertrophy
  studies (525 subjects) [121]. Per-meal saturation reasoning: [169].
- *Time:* acute (24 h). *Dose:* ≥0.3–0.4 g/kg per feeding (03). *Interacts:* short eating windows (07) reduce feeding count; 08 §4.15 rule
  "≥3 feedings ≥0.3–0.4 g/kg when muscle is a top-2 goal". *Avoid:* none. *Planner:* constraint, not a lever.

**A2. Protein/vegetables-first meal ordering; whey preload** — verdict `SIM` (glycaemia only), grade C/B
- *Def:* eat protein + non-starchy vegetables ≥10 min before the carbohydrate portion of the same meal; or 15–55 g whey ~30 min before a carbohydrate meal.
- *Effect:* prediabetes, n = 15 crossover, same meal: incremental glucose peak −>40 %, **iAUC −38.8 %** with protein-and-vegetables-first vs
  carbohydrate-first; insulin excursions lower with vegetables-first [122]. T2D whey preload: slowest gastric emptying, lower glucose iAUC (P < 0.005),
  higher GLP-1/GIP/insulin [Ma 2009, ref 170]; 15 g intact whey before breakfast and lunch: breakfast glycaemic AUC −13 ± 3 %, satiety ↑ in men with T2D [171].
- *Time:* single meal, no carry-over. No fat-mass outcome exists. *Interacts:* 04 glucose-appearance shape; gastric emptying. *Avoid:* none.
- *Planner:* free "info" tip for glycaemia goals; never credited for fat loss.

**A3. Carbohydrate timing — evening vs morning** — verdict `REJECT` as fat-loss lever (`INFO` for sleep), grade C/D
- *Effect:* one 6-mo RCT (78 obese police officers, hypocaloric): carbohydrates mostly at dinner → greater loss of weight, waist and fat mass, lower
  hunger, better HOMA-IR/CRP [123] (single centre, magnitude not in abstract, no replication or meta-analysis located). A high-GI meal 4 h before bed
  shortened sleep-onset latency to 9.0 ± 6.2 min vs 17.5 ± 6.2 (low-GI), and vs 14.6 ± 9.9 when eaten 1 h before bed (healthy sleepers) [12].
- *Interacts:* 07 (late eating raises hunger, lowers EE; see A15). *Verdict rationale:* one unreplicated trial; equal-energy, equal-protein comparisons
  in 13 show no sequencing bonus.

**A4. "Carb back-loading" (carbohydrate only after evening training)** — verdict `REJECT`, grade D
- Europe PMC title search for "carb backloading / back-loading / carbohydrate back-loading" returned **0 records** (2026-09-30). No RCT located.

**A5. Carbohydrate around training; train-low / sleep-low; carbohydrate loading** (owner 13 §4C B10, B18; 04; 19) — pointer
- Verdicts taken from 13 (not re-verified here): train-low/sleep-low benefits sub-elite endurance only, no fat-loss credit (B); loading is an A/B
  performance lever for events >90 min with +1–2 kg scale weight.

**A6. Fat-source swaps (SFA → MUFA/PUFA)** (owner 06) — pointer. This dossier claims no body-composition effect; LDL/ApoB effects are 06's.

**A7. Viscous-fibre loading / pre-meal fibre (psyllium, oat β-glucan, glucomannan, guar)** — verdict `MODEL` for lipid/glycaemia goals; `REJECT` as
fat-loss lever; grade A
- *Def:* 3–15 g/d viscous soluble fibre stirred into ≥250 mL water before/with meals; ramp +5–10 g/wk (13 B20).
- *LDL:* psyllium median ~10.2 g/d → LDL **−0.33 mmol/L** (−0.38…−0.27), non-HDL −0.39 (−0.50…−0.27), apoB −0.05 g/L (−0.08…−0.03); 28 trials,
  n = 1,924, moderate/high certainty [111]. Oat β-glucan ≥3 g/d → LDL **−0.25 mmol/L** (−0.30…−0.20), TC −0.30 (−0.35…−0.24); no dose (3.0–12.4 g/d) or
  duration (2–12 wk) dependence; larger with higher baseline LDL; HDL/TG unchanged [113].
- *Glycaemia:* psyllium in T2DM (multiweek, before meals): FBG −37.0 mg/dL (P < 0.001), HbA1c −0.97 % (P = 0.048); proportional to baseline dysglycaemia,
  none in euglycaemic subjects [112].
- *Weight:* viscous fibre with ad-libitum diet −0.33 kg (−0.51…−0.14), BMI −0.28, waist −0.63 cm; 62 trials, n = 3,877, moderate GRADE [114]; isolated
  soluble fibre in overweight/obese −2.52 kg (−4.25…−0.79) (12 RCTs, n = 609, "considerable" heterogeneity) [115]; glucomannan −0.79 kg (−1.53…−0.05)
  [116] or −1.27 kg (−2.45…−0.09) (below the 2.5-kg clinical threshold) [104]. Best estimate for planning: **−0.3 to −0.5 kg**.
- *Time:* LDL effect fully present within 2–12-wk trials. *Interacts:* 15 fibre/gut mass (+~5 g stool per g NSP, 13 T21), 12 satiety, 06.
  *Avoid:* oesophageal/swallowing problems; adequate water; separate from oral medicines (general precaution, `UNVERIFIED` here).
- *Planner:* optional add-on when LDL/ApoB or glycaemia is a goal; tier default.

**A8. Low energy-density eating ("volumetrics")** — verdict `ADH` (ad-lib intake mode), grade A (acute intake) / B–C (weight)
- *Def:* served energy density (kcal per g of food incl. water) lowered by vegetables, soups, water-rich foods; trial contrast median 1.1 vs 1.5 kcal/g [124].
- *Effect:* −223 kcal (95 % CI −259.7…−186.0) per tested intake period vs higher-ED (38 RCTs; 15 single-meal designs), food *amount* unchanged; linear ED–intake
  relationship [124]. Daily-level: SMD −1.002 (−1.266…−0.745) with minimal compensation at other meals (31 studies, 90 effects); weight −0.7 kg (−1.34…+0.04,
  ns; 5 studies) [125]. Water baked into the food reduced lunch intake (1,209 vs ~1,650 kJ) but the same water as a beverage did not [135].
- *Interacts:* only relevant when intake is ad libitum; in fixed-kcal prescriptions it changes hunger, not energy. *Avoid:* underweight, frailty, high-energy
  athletes. *Planner:* lever only inside ad-lib regimes.

**A9. Liquid vs solid calories** — verdict `ADH`, grade B
- *Effect:* crossover (period length `UNVERIFIED`): solid carbohydrate load was compensated precisely (118 %), liquid (soda) not at all (−17 %); weight and BMI rose only in the liquid
  period [126]. SSB → low/no-calorie beverage: weight **−1.06 kg** (−1.71…−0.41), BMI −0.32, body fat −0.60 % (17 RCTs, n = 1,733, moderate certainty); water for SSB:
  no significant effect (low certainty) [127].
- *Model:* liquid kcal enter energy balance at ~100 % (compensation 0–20 %, PROPOSED); solids compensate 100 %+ only in ad-lib mode (see X13).

**A10. Meal-replacement use** — verdict `ADH`, grade A (short term) / C (long term)
- *Effect:* vs food-based low-energy diets Hedges g **0.261** (0.156–0.365; 22 studies, n = 1,982); ≥60 % of energy from replacements g **0.545** (0.260–0.830) [128].
  Long-term (>1 y) benefit inconclusive (7 studies, 4 with larger loss) [Lopez Barron 2011, ref 172]. Mechanism: menu structure, fewer decisions (adherence), not physiology.

**A11. Pre-meal water (500 mL)** — verdict `ADH` (small), grade B/C
- *Effect:* 12 wk on a hypocaloric diet, 48 adults 55–75 y (BMI 25–40): ~2 kg greater loss, 44 % steeper weight slope; acute test-meal intake 498 vs 541 kcal at baseline
  (P = 0.009), attenuated at week 12 (480 vs 506, P = 0.069) [129]. UK primary care (n = 84, obesity, follow-up ~12 wk `UNVERIFIED` in abstract): −1.3 kg (−2.4…−0.1; adjusted −1.2, −2.4…+0.07) [130].
- *Avoid:* fluid restriction, heart/kidney failure, hyponatraemia risk (general precaution, `UNVERIFIED` here).

**A12. Eating rate / slow eating** — verdict `ADH`, grade B (acute) / C (weight)
- *Effect:* slower eating → lower energy intake, SMD 0.45 (0.25–0.65; 22 studies), no effect on hunger at end of meal or up to 3.5 h [131]. Observational:
  fast eaters BMI +1.78 kg/m² (1.53–2.04), OR obesity 2.15 (1.84–2.51; 23 studies, I² 78 %) [132] — confounded. No long-term trial of a slowing intervention on weight located.

**A13. High-protein breakfast** — verdict `REJECT` for fat loss, `INFO` for hunger (12); grade C
- *Effect:* in overweight breakfast-skipping late-adolescent girls, a higher-protein breakfast raised fullness, lowered ghrelin, raised PYY and cut evening high-fat
  snacking vs a normal-protein breakfast, but **daily energy intake did not differ** [133]. Breakfast skipping ≥3 d/wk: RR overweight/obesity 1.11 (1.04–1.19; two cohorts) [136] (observational).

**A14. Single high-carbohydrate refeed, diet breaks, maintenance phases, reverse dieting** (owner 13 §4B/4C B8, B9, B22; 11 §4.11) — pointer
- Verdicts from 13: diet breaks Neutral per energy-restriction week with an adherence benefit (B); refeeds Neutral (C); reverse dieting Neutral (C). Not re-verified here.

**A15. Late eating (clock delay of identical meals)** (owner 07) — verdict `SIM`, grade B (single controlled crossover)
- *Effect:* overweight/obese adults, identical meals delayed by 250 min, sleep/light/activity controlled: hunger ↑ (P < 0.0001), 24-h ghrelin:leptin ↑ (P = 0.006), waketime
  **EE −59.4 ± 13.9 kcal per waking day (−5.03 %)**, 24-h core temperature ↓; adipose gene expression shifted toward lower lipolysis [134]. Cross-check for 07's timing module.

**A16. Alcohol after training** (owner 15/16; X17) — verdict `SIM`, grade B (single dose)
- *Effect:* after concurrent training, 1.5 g/kg alcohol (≈12 ± 2 standard drinks): MPS −24 % (with 25 g whey) and −37 % (with carbohydrate) vs whey alone; mTOR/p70S6K signalling lower [155].
  Lower doses were not measured — do not extrapolate linearly below ~1 g/kg without flagging.

**A17. Protein supplements and pre-sleep casein** (owner 03) — pointer, grade A
- Protein supplementation during RT: FFM **+0.30 kg** (0.09–0.52), 1RM +2.49 kg (0.64–4.33), fibre CSA +310 µm² (51–570) (49 studies, n = 1,863); no additional FFM gain
  beyond total intake ≈**1.62 g/kg/d**; more effective in trained (+0.75 kg) and less with age [109]. 20–40 g casein ~30 min pre-sleep raises overnight protein synthesis in young and older men;
  chronic muscle gain possible in young, not shown in older men [117]. Whey vs casein vs plant: 03.

### 4B. Fasting family (pointers to 07 / 13 / 20; this dossier adds only what it verified)

| Regime (defined by zero-energy hours) | Owner | What this dossier verified | Verdict / grade |
|---|---|---|---|
| Daily 12/14/16/18/20-h fast; TRE; one meal a day | 07, 13 | 1 meal/d vs 3 meals/d, normal-weight middle-aged adults, weight-maintaining, 6-mo study period: ↑ hunger, modest ↓ fat mass, ↑ BP and total/LDL/HDL cholesterol, ↓ cortisol [153]. 08 §4.15: 8-wk 16:8 with RT keeps FFM/strength. | per 07/13; OMAD `INFO` (BP/lipid cost), B |
| 5:2, alternate-day (zero or modified) | 13 | ADF vs daily restriction, n = 100, 12 mo: −6.0 % (−8.5…−3.6) vs −5.3 % (−7.6…−3.0); dropout 38 % vs 29 %; LDL significantly higher at 12 mo; no BP/TG/glucose difference [154] | Neutral for fat loss (13); A/B |
| Weekly 24-h, periodic 48–72 h, 5–7-day water fast | 13, 20 | not re-searched | per 13/20 |
| Fasting-mimicking diet (5 d/month, ~720–1,100 kcal) | 13 B17, 08 | 100 randomised participants, 3 monthly cycles: ↓ body weight, trunk and total fat, BP, IGF-1; no serious adverse events; larger effects in at-risk participants (post hoc) [149]. 13 quotes −2.6 kg/3 cycles. | B/C; protein 16–30 g/d is below lean-sparing intake (13) |
| Protein-sparing modified fast | 13 B4/B7 | – | supervised, BMI ≥30 (13) |
| Fat-fast / very-low-protein "protein cycling" days (autophagy claims) | 08 §4.16 | Europe PMC search "protein cycling" (2026-09-30): 4 hits, none human dietary (yeast, receptor biology) | `REJECT` (D); no human evidence located |
| Ramadan-style dawn-to-dusk *dry* fasting | 07 | **Evidence only; dry fasting is excluded from the app.** 85 studies, N = 4,176: −1.02 kg (−1.16…−0.88), g −0.360, larger with longer fasting hours [150]; fat % −1.46 (−2.57…−0.35) in overweight/obese, none in normal weight; fat-free mass loss ~30 % smaller than fat loss; values returned toward baseline 2–5 wk after Ramadan [151]; LDL ↓ and fasting glucose ↓ in both sexes, men lose weight, women unchanged [152] | `INFO` (transient, C/B); model only the water-allowed TRE analogue (07) |

---

### 4C. Movement (core levers → owners 02/09/10; here: dose facts and the levers nobody else owns)

**C1. Daily step target** — verdict `MODEL` (core input; add a health-risk proxy output), grade A (association) / B (RCT BMI, BP)
- *Def:* steps per day (pedometer/accelerometer).
- *Effect (cohorts):* 15 cohorts, n = 47,471, 3,013 deaths, median follow-up 7.1 y. Quartile median steps 3,553 / 5,801 / 7,842 / 10,901 → all-cause HR 1.00 / 0.60 (0.51–0.71) /
  0.55 (0.49–0.62) / 0.47 (0.39–0.57); benefit plateaus at 6,000–8,000 steps (≥60 y) and 8,000–10,000 (<60 y); cadence adds little once steps are adjusted (peak-30-min HR 0.67) [21].
  Dose–response meta-analysis (24 cohorts): 7,000 vs 2,000 steps/d → all-cause HR **0.53** (0.46–0.60), CVD incidence 0.75 (0.67–0.85), T2D 0.86 (0.74–0.99), depressive symptoms 0.78 (0.73–0.83),
  dementia 0.62 (0.53–0.73), falls 0.72; inflection points ~5,000–7,000 [22].
- *Effect (RCT):* pedometer users +2,491 steps/d (1,098–3,885) vs controls; BMI **−0.38** (0.05–0.72), SBP **−3.8 mmHg** (1.7–5.9); a step goal (e.g. 10,000) predicted the effect (P = 0.001);
  mean intervention 18 wk, 85 % women [23]. In a behavioural programme, ≥10 % weight loss at 18 mo went with ~9,822 steps/d (~3,500 as bout-MVPA) vs 7,801 in gainers (observational) [24].
- *Time:* pedometer trials ran ~18 wk; cohort benefit is long-run. *Dose (PROPOSED FIT for a UI risk proxy, anchors Ding 2025: 2,000 → 1.00, 7,000 → 0.53; Paluch Q1→Q4 0.47):*
  `HR_proxy(s) = 1 − 0.47·min(1, (s − 2000)/5000)` for s ≥ 2,000, plateau at 7,000 (shift the plateau to 6,000–8,000 for ≥60 y, 8,000–10,000 for <60 y). It is an *association*, never a causal promise.
- *Interacts:* 02 (NEAT compensation, energy per step), 10, 16 (age). *Avoid:* acute lower-limb injury; ramp +1,000–2,000 steps/wk (general practice, `UNVERIFIED`).

**C2. Post-meal light walking** — verdict `MODEL` for glycaemia goals, grade B
- *Def (PROPOSED prescription; trial doses varied and are not all stated in the abstracts):* ~10–15 min of light walking starting ≤30 min after a meal.
- *Effect:* T2DM randomised crossover: walking after meals vs walking on a single daily occasion → glucose iAUC ratio **0.88** (0.78–0.99); after the evening meal (most carbohydrate, most sedentary time)
  **0.78** (0.67–0.91) [19]. Meta-analysis of 7 acute 1-day crossover trials (mostly overweight/obese adults): light walking vs sitting Δglucose −0.72 (−1.03…−0.41), Δinsulin −0.83 (−1.18…−0.48);
  standing vs sitting Δglucose −0.31 (−0.60…−0.03), no insulin or SBP effect; walking beats standing (Δglucose −0.30, Δinsulin −0.54) [18] (units as reported, standardised).
- *Time:* single meal; no evidence of fat-mass change. *Engine:* multiply meal glucose/insulin iAUC (X5). *Avoid:* none specific.

**C3. Standing, breaking up sitting, NEAT strategies (sit-stand desks, treadmill desks)** — verdict `SIM`/`INFO` (do not sell as weight loss), grade A (kcal) / B (glycaemia)
- *Def:* substitute standing or light walking for sitting.
- *Energy:* standing − sitting = **+0.15 kcal/min** (0.12–0.17; 46 studies, n = 1,184); women 0.10 (0.0–0.21), men 0.19 (0.05–0.33); RCTs 0.20 (0.12–0.28), observational 0.11 (0.08–0.14). Six hours/day standing
  for a 65-kg person = +54 kcal/d [15].
- *Real-world dose:* sit-stand desks cut sitting at work by 100 min/d at ≤3 mo (−116…−84; 10 studies, low quality) and by **57 min/d** at 3–12 mo (−99…−15); 1–2-min breaks each half hour −40 min/d;
  treadmill/cycle desks: unclear or inconsistent [16]. ⇒ realistic gain **57–100 min × 0.15 = 9–15 kcal/d**.
- *Posture allocation:* obese adults sat ~2 h/d longer than lean adults and did not change posture allocation with weight change; adopting the lean pattern "might" give +350 kcal/d (n = 20, 10 d of
  half-second posture monitoring) [17] — a hypothetical maximum, not a trial result.
- *Glycaemia:* short (2-min every 20 min, `UNVERIFIED` in the abstract) light or moderate walking breaks during 5 h after a glucose load in overweight/obese adults: glucose iAUC 5.2 / 4.9 vs 6.9 mmol/L·h uninterrupted (−25 % / −29 %), insulin iAUC 634 / 638 vs 829 pmol/L·h (−24 % / −23 %) [20].
- *Verdict rationale:* real but small; the engine should credit ~9 kcal/h standing and the glycaemia effect, and the UI must say "≈ 10–15 kcal/day".

**C4. Exercise snacks (≤5-min high-intensity bouts)** — verdict `SIM` (VO₂max lever via 10), grade B
- *Def:* structured bouts ≤5 min (e.g. 20–60 s stair climbing), ≥2 bouts/d, ≥3 d/wk, ≥2 wk [25].
- *Effect:* cardiorespiratory fitness g **1.37** (0.58–2.17; k = 6; I² 71 %; moderate certainty); muscular endurance in older adults g 0.40 (0.06–0.75; very low certainty); **no** effect on lower-limb strength, body
  composition, BP or lipids (11 RCTs, n = 414); adherence 82.8–91.1 % [25]. Second meta (13 studies, n = 483): TC SMD −0.65 (−1.18…−0.11), LDL −0.65 (−1.22…−0.09); no difference in body weight, body fat, HDL, TG [26].
- *Planner:* an adherence-friendly VO₂max substitute; never credited for fat loss. *Avoid:* unscreened cardiac disease (high-intensity).

**C5. HIIT / sprint-interval doses** (owner 10) — verdict `MODEL` (10), grade A
- HIIT vs moderate continuous training: no difference in whole-body fat mass, waist or other composition measures, with ~40 % less time commitment; running gave fat-mass SMD −0.82 (HIIT) / −0.85 (MICT), cycling no fat loss
  (13 studies, mean 10 wk × 3/wk) [27]. Sprint-interval vs MICT in 12 wk, sedentary men: VO₂peak +19 % in both; insulin-sensitivity index 4.9 → 7.5 (SIT) vs 5.0 → 6.7 (MICT) ×10⁻⁴ min⁻¹/(µU/mL) with a five-fold lower exercise volume [28].

**C6. Fasted morning cardio** — verdict `REJECT` as a fat-loss lever (keep the substrate-oxidation timing input in 10), grade B (null)
- Fat oxidation *during* exercise +3.08 g (0.79–5.38) fasted vs fed (27 studies, n = 273), NEFA no different, no chronic outcome pooled [29]. Volume-equated 4-wk RCT, 20 young women on a hypocaloric diet, 1 h steady-state ×3/wk:
  both groups lost fat, **no group difference** [30].

**C7. Zone-2 volume, resistance-training variables, sport/play** — pointers: zone-2 and cardio doses → 10; RT variables → 09. Sport/play was **not evaluated** (no source retrieved); treat as steps/HIIT equivalents by intensity.

### 4D. Thermal exposure

**D1. Sauna / heat exposure** — verdict `SIM` (opt-in, tiny BP scalar) + `INFO`, grade C
- *Def:* dry sauna 80–100 °C, 10–30 min/session, 1–7 sessions/wk.
- *Cohorts:* Finnish men, median follow-up 20.7 y (929 all-cause deaths): vs 1 session/wk, sudden cardiac death HR 0.78 (0.57–1.07) for 2–3/wk and **0.37 (0.18–0.75)** for 4–7/wk (P trend 0.005); sessions >19 min vs <11 min HR 0.48
  (0.31–0.75); CHD, CVD and all-cause show similar gradients [31]. Mixed-sex cohort (15 y, 181 CVD deaths): 2–3/wk HR 0.75 (0.52–1.08), 4–7/wk **0.23 (0.08–0.65)**, linear, no threshold [32]. Joint with fitness: high CRF + high sauna CVD-mortality
  HR 0.42 (0.28–0.62) vs high CRF + low sauna 0.50 (0.39–0.63) vs low CRF + high sauna 0.72 (0.54–0.97) [173]. **Healthy-user and fitness confounding are unresolved.**
- *RCT:* 47 adults (age 49 ± 9, low activity, ≥1 CVD risk factor), 8 wk: exercise + 15-min post-exercise sauna vs exercise alone → additional CRF +2.7 mL/kg/min (0.2–5.3), **SBP −8.0 mmHg (−14.6…−1.4)**, lower total cholesterol [34].
  Meta-analysis of sauna in mostly cardiac patients: acute SBP −5.55 / DBP −6.50 mmHg, HR +17.9 bpm, core temperature +0.94 °C; short-term SBP −5.26 / DBP −4.14, LVEF +3.27 %, 6-min walk +48 m, FMD +1.71 % [35].
  Systematic review of 40 clinical studies (n = 3,855; only 13 RCTs, mostly n < 40): mostly favourable; the one adverse signal was reversible impairment of spermatogenesis in a small study (n = 10) [33].
- *Performance:* 6 runners, 3 wk of ~31-min post-run sauna at ~90 °C (12.7 sessions): plasma volume **+7.1 %** (5.6–8.7), time to exhaustion +32 % (≈ +1.9 % time-trial) [36]; but a meta-analysis of post-exercise heat exposure (10 studies, n = 199) found a
  trivial effect (ratio of means 1.04, 0.94–1.15; 95 % PI 0.81–1.33; certainty low to very low) [37]. Exercise-in-heat acclimation has its own meta-analysis (35 studies; VO₂max, time to exhaustion, time trial, power) [39]; magnitudes not extracted here.
- *Hormones:* 7 d of 1 h at 80 °C twice daily (10 men): GH ×16 and prolactin ×2.3 (males) with the GH response declining after day 3; ACTH/cortisol slightly ↓; TSH, thyroid hormones, testosterone, LH/FSH unchanged; in 5 of 7 women
  transient amenorrhoea [38]. **The "GH spike" is acute, declines with repeated exposure and has no body-composition outcome.**
- *Model (PROPOSED):* SBP shift `−4 mmHg·min(1, sessions/3)` after ≥8 wk (half of the RCT effect: single n = 47 trial, exercise-plus-sauna confound); `HeatIdx` τ ≈ 14 d `UNVERIFIED`. No fat-loss credit; no GH credit.
- *Avoid:* pregnancy, unstable cardiovascular disease, severe aortic stenosis, alcohol, dehydration (general precautions, `UNVERIFIED` here); men trying to conceive [33]. *Planner:* only when BP/wellbeing is a goal, opt-in, flagged grade C.

**D2. Heat acclimation for endurance in heat** — verdict `SIM` (19), grade B; no magnitudes verified here beyond [37,39].

**D3. Cold exposure and brown fat (energy, insulin sensitivity)** — verdict `SIM` (opt-in; `BATidx`), `REJECT` as fat-loss lever, grade C
- *Def:* air or water ~14–19 °C for 1–6 h/d (non-shivering to mild shivering), or overnight room temperature ~19 °C.
- *Acute physiology:* BAT activity in 23/24 (96 %) young men during cold, lower with overweight/obesity (P = 0.007) [40]. At 19 °C for 2 h, cold-induced thermogenesis (CIT) was **252 ± 41 vs 78 ± 24 kcal/d** in BAT-positive vs BAT-negative
  men (n = 51, BMI 22) [41]. Severe cold (3 h, controlled suit) raised TEE 80 % = **+250 ± 45 kcal over 3 h** with BAT oxidative metabolism activated (n = 6) [42] — not a daily-life dose. Immersion 1 h at 14 °C: metabolic rate +350 %, HR +5 %, SBP +7 %,
  DBP +8 %, noradrenaline +530 %, dopamine +250 % (20 °C: +93 %, no BP rise) [43].
- *Chronic (RCT, n = 11 vs 11 low-BAT young men):* 2 h/d at 17 °C for 6 wk → CIT 108 ± 23 → **289 ± 70 kcal/d** (control 108 ± 31), Δ +181 ± 70 vs +5 ± 40; body-fat mass **−0.70 ± 0.23 kg (−5.2 ± 1.9 %)** vs +0.03 ± 0.21; weight and FFM unchanged [41].
- **Realistic-energy check (the requested "kcal/day" audit).** In this literature metabolic rate is conventionally reported as a 24-h-equivalent rate from a short indirect-calorimetry session (e.g. resting MR 1,841 ± 199 kcal/24 h in a 1-h/d cold RCT [194]; a 10-RCT meta-analysis of acute exposure at 16–19 °C vs 24 °C gives **+188 kcal/d** (139.7–237.1) [195]). Yoneshiro's "kcal/d" therefore very probably denotes such a rate (the exact protocol text was not read: `UNVERIFIED`). Read that way, the *actual* extra energy per 2-h session is rate/12 ≈ **9 kcal (baseline CIT 108) to 24 kcal (recruited CIT 289)**, and ≈16 kcal for the meta-analytic +188 kcal/d rate; i.e. 3–12 kcal/h. The reported fat loss (−0.70 kg ≈ 5,400 kcal over 42 d ≈ 129 kcal/d) is ≈5–15× larger than that can explain ⇒ treat it as an unreplicated small-n result. In a separate randomised trial (n = 28; 1 h/d for 6 wk vs avoiding cold) the resting MR *fell* in controls (1,841 → 1,795 kcal/24 h, p = 0.047), the cold group tended to rise (p = 0.052), between-group difference p = 0.008, and supraclavicular BAT volume rose 0.0175 → 0.0216 L on-treatment (p = 0.049) [194] — plasticity is real but small. Severe cold can cost +80 kcal/h but only with shivering, and rewarming/appetite compensation was not studied. **Do not credit cold exposure for fat loss in the planner.**
- *Metabolic (better replicated in direction, tiny n):* 10 d at 14–15 °C in 8 T2D patients: peripheral insulin sensitivity **+~43 %**, GLUT4 translocation ↑ [44]. 1 month sleeping at 19 °C (n = 5 men; blocks 24 → 19 → 24 → 27 °C): BAT abundance/activity ↑ at 19 °C and ↓ at 27 °C (reversible),
  diet-induced thermogenesis and postprandial insulin sensitivity ↑ after cold acclimation only; CIT unchanged [10]. Experienced winter swimmers (2–3 dips/wk): larger CIT response, lower core temperature, no BAT activity [45].
- *State dynamics (PROPOSED FIT; points: recruitment shown at 10 d [44] and 6 wk [41]; reversal within a month [10]):* `dB/dt = (B* − B)/τ`, `B* = 1` if ≥1–2 h/d at ≤17–19 °C on ≥5 d/wk else 0.3; τ_up = 21 d, τ_dn = 30 d.
  `ΔEE_session = (CIT0 + (CIT1 − CIT0)·B)/24 · hours`, CIT0 ≈ 78–108, CIT1 ≈ 252–289 (reported-unit values treated as 24-h-equivalent rates). Insulin-sensitivity gain `+10 %·B` (PROPOSED shrink of +43 %).
- *Avoid:* cardiovascular disease, Raynaud, cold urticaria; unaccompanied open-water immersion (cold shock; general, `UNVERIFIED`).

**D4. Post-exercise cold-water immersion (CWI): recovery vs adaptation** — verdict `SIM` conflict rule, grade B (strength) / C (hypertrophy)
- *Def:* immersion ≤15 °C, ~10–15 min, within ~1 h after exercise.
- *Effect:* 12-wk RCT, 21 active men, strength training 2×/wk: strength and muscle mass rose more with active recovery than with 10-min CWI (P < 0.05); type II fibre CSA +17 % and myonuclei/fibre +26 % only with active recovery; in a second
  study CWI blunted satellite-cell (NCAM⁺, Pax7⁺) increases and p70S6K phosphorylation at 2–48 h [46]. Meta-analysis (10 studies, n = 170, 92 % male): CWI attenuated strength gains **ES −0.23 (−0.45…−0.01)**; limb-only CWI ES −0.31 (−0.61…−0.01); whole-body CWI −0.08
  (−0.53…+0.38, ns) [47]. Review: CWI attenuates strength/power/hypertrophy adaptations to resistance training without harming endurance adaptations [48]. Recovery benefits for soreness: Cochrane review [50] (numbers not extracted).
- *Engine (PROPOSED):* `f_CWI = 0.8` (0.5–1.0) on RT accretion when limb immersion ≤15 °C follows ≥2 RT sessions/wk; 1.0 for whole-body immersion. *Planner:* never schedule CWI within ~6 h after RT when muscle gain is a goal (rule); allowed on non-RT days or after endurance sessions.

**D5. Cold showers** — verdict `INFO`, grade C: 30 consecutive days of hot-to-cold showers (30/60/90-s cold) cut self-reported sickness absence by **29 %** (IRR 0.71, P = 0.003) but not illness days; 79 % completed [49]. No body-composition claim.

**D6. Cooler bedroom (~19 °C)** — verdict `INFO`, grade C/D: see the 1-month 19 °C block in D3 [10] (n = 5). Sleep-quality effects were not verified in this session.

### 4E. Sleep & circadian (owner 16; effect sizes verified here)

**E1. Sleep extension / adequacy** — verdict `MODEL` (input owned by 16), grade B
- *Def:* time in bed extended toward 8–8.5 h in habitually short sleepers.
- *Effect:* 80 adults (21–40 y, BMI 25–29.9, habitual sleep <6.5 h), sleep-hygiene counselling: sleep **+1.2 h/night** (1.0–1.4) → energy intake **−270 kcal/d** (−393…−147), r = −0.41 between Δsleep and ΔEI, TEE unchanged, weight lower than
  control (duration of the intervention phase `UNVERIFIED` here; the trial had a 2-wk baseline) [1]. Sleep restriction during dieting (5.5 vs 8.5 h, 14-d crossover): fat share of weight loss 1.4 vs 0.6 kg (−55 %), FFM loss 1.5 vs 2.4 kg (+60 %), higher hunger,
  fat oxidation ↓ [2] ⇒ FFM share of loss 52 % vs 80 %. Systematic review of 7 extension studies (n = 138; extension 21–177 min; 3 d–6 wk): improved insulin-sensitivity measures, lower leptin and PYY, lower appetite and desire for sweet/salty food [3]. Athletes: 2 studies, large effects on
  6/15 sport measures but very-low-to-moderate certainty [11].
- *Engine (PROPOSED, from [1,2]):* `ΔEI_adlib = −225 kcal/d per +1 h` when habitual <6.5 h (0 above 7.5 h); FFM share of weight loss `0.52 + 0.28·(8.5 − sleepH)/3` clipped to [0.52, 0.80]. *Avoid:* untreated sleep apnoea or insomnia (extension by time-in-bed can worsen insomnia).

**E2. Sleep regularity (consistent timing)** — verdict `INFO`/`ADH`-adjacent, grade C (observational)
- *Effect:* UK Biobank, 3,010 deaths, 7.1 y: all-cause HR 1.53 (1.41–1.66) at the 5th percentile of the Sleep Regularity Index (SRI 41) and 0.90 (0.81–1.00) at the 95th (SRI 75) vs median (SRI 60, SD 10) [6]; SRI was a stronger mortality predictor than duration
  in a second UK Biobank analysis [7]; irregularity correlated with adiposity, HbA1c and delayed timing in older adults [Lunsford-Avery 2018, ref 174]. No RCT of regularisation on body composition located. Not a physiological input; surface as a check-in nudge.

**E3. Morning light / light timing** — verdict `INFO`, grade C/D
- *Effect:* 54 adults, 7 d actigraphy: later mean timing of light >500 lux correlated with BMI (r = 0.51); each hour later ≈ +1.26 kg/m² (SE 0.34), independent of sleep midpoint/duration [8] (cross-sectional, self-reported BMI). No intervention trial on weight located → not modelled.

**E4. Caffeine cut-off** — see F3 (sleep cost quantified there).

**E5. Alcohol-free days** — pointer 15/16; A16 for the MPS cost.

**E6. Evening high-glycaemic-index meal 4 h before bed** — verdict `INFO`: sleep-onset latency 9.0 vs 17.5 min (P = 0.009) in healthy sleepers [12]; not a body-composition lever.

**E7. Sleep-aid supplements** — melatonin (F27), magnesium (F7), ashwagandha (F23): effect sizes in those entries.

---

### 4F. Supplements and substances (RCT-grade evidence for *our* outcomes; "null" is stated explicitly)

**F1. Creatine monohydrate** — verdict `MODEL` (state `CrLoad`, X1), grade A (lean mass/strength) / B (kinetics)
- *Def:* 3–5 g/d indefinitely; optional loading 0.3 g/kg/d (≈20 g/d, 4 doses) for 5–7 d [57].
- *Effect on lean mass (with resistance training):* +**1.10 kg** (0.56–1.65) in RCTs combining creatine and RT, regardless of age; overall (with/without training) +0.68 kg (0.26–1.11); no significant effect when combined with mixed exercise (35 studies, n = 1,192) [52].
  Older adults (mean 57–70 y, 22 studies, n = 721, RT 2–3 d/wk, 7–52 wk): lean tissue +**1.37 kg** (0.97–1.76), chest-press SMD 0.35 (0.16–0.53), leg-press SMD 0.24 (0.05–0.43) [51]. Postmenopausal women (7 RCTs, n = 608): lean mass +0.37 kg (0.05–0.69),
  leg press +7.5 kg (2.2–12.8); effect when ≥5 g/d with RT, none when ≤3 g/d without RT; bone density unchanged [53]. Older females (10 RCTs, n = 211): upper-body strength ↑, no overall effect on muscle mass [175].
  Cognition (16 RCTs, n = 492): memory SMD 0.31 (0.18–0.44), attention and processing-speed times improved; no effect on overall cognition or executive function [54].
- *Kinetics [55] (31 men):* 20 g/d × 6 d → muscle total creatine **+~20 %**; maintained by 2 g/d for 30 d; without maintenance it returned to baseline in **30 d**; 3 g/d reached the same +20 % over **28 d**. ISSN: muscle creatine/PCr +20–40 %; up to 30 g/d for 5 y safe in healthy people [57].
- *Water/scale:* 32 resistance-trained adults, 7 d loading then 21 d of 5 g/d: body mass +0.75 kg at day 7 (ns, threshold 0.88 kg) and significantly higher by day 28; total body water ↑ without change in fluid distribution [56] ⇒ model +0.9 kg scale water (0.5–1.5) at full loading.
- *Engine (PROPOSED FIT to [55]):* `dC/dt = k_up(D)·(1 − C) − k_dn·C·max(0, 1 − D/2)`; `k_up(20 g) = 0.5 d⁻¹` (t₉₅ ≈ 6 d), `k_up(3 g) ≈ 0.12 d⁻¹` (t₉₅ ≈ 25–28 d), `k_dn = 0.10 d⁻¹` (baseline by 30 d); `k_up(D) = 0.5·(D/20)^0.75`. Effects: scale `+0.9·C kg`; RT accretion `A_r × (1 + 0.15·C)` (the 15 % is PROPOSED from
  the 0.2–0.7 kg tissue share of the +1.1 kg after subtracting water; the meta-analytic lean gain *includes* intracellular water — do not add both at face value).
- *Interacts:* 09 accretion; 19 (repeated high-intensity efforts); 15 (hydration); caffeine co-ingestion not modelled. *Avoid:* pre-existing kidney disease (label practice, `UNVERIFIED` here); users who cannot accept +~1 kg scale water. *Planner:* opt-in default for RT/strength goals.

**F2. Whey / casein as protein sources** — pointer A17 (owner 03).

**F3. Caffeine** — verdict `MODEL` (performance and sleep-conflict; **not** a fat-loss lever), grade A
- *Def:* 3–6 mg/kg 30–60 min before exercise; habitual daily mg and the clock time of the last dose.
- *Performance:* 46 studies: time-trial time **−2.22 ± 2.59 %** (ES 0.41 ± 0.20), mean power +3.03 ± 3.07 % (ES 0.23 ± 0.15) at 3–6 mg/kg; a few individuals were slower [60]. Strength SMD 0.20 (0.03–0.36), power 0.17 (0.00–0.34), upper-body strength 0.21 (0.02–0.39), lower-body 0.15 (−0.05…0.34) [58].
  Umbrella of 21 meta-analyses: ergogenic for aerobic endurance, strength, muscle endurance, power, jumping, speed; moderate-quality evidence, mostly young men [59]. After sleep loss, attention response time g 0.86 and accuracy g 0.68 improved [176].
- *Sleep cost:* 24 studies: total sleep time **−45 min**, sleep efficiency −7 %, onset latency +9 min, WASO +12 min, N1 +6.1 min, N3/N4 −11.4 min; to avoid the TST loss a coffee (107 mg/250 mL) must be finished ≥**8.8 h** before bed, a pre-workout dose (217.5 mg) ≥**13.2 h** [4]. Trial data: 400 mg at 0, 3 or 6 h before bed each disturbed sleep vs placebo [5].
  `t_cut(D) = 8.8 + 6.2·ln(D/107)` h (PROPOSED FIT through the two meta-analytic points).
- *Energy:* 100 mg raised RMR 3–4 % over 150 min; repeated 100 mg at 2-h intervals over a 12-h day raised EE 8–11 % and daily EE by **150 kcal (lean) / 79 kcal (post-obese)**, no night effect [61] — a schedule of ~600 mg/d (`UNVERIFIED` count of doses), above common intake caps; tolerance in habitual users unquantified.
  A dose-response meta-analysis of caffeine and weight/fat (13 RCTs, I² 91–94 %) is not interpretable [62]. **Not credited for fat loss.**
- *Avoid:* pregnancy, anxiety disorders, arrhythmia, poorly controlled hypertension, >400 mg/d (commonly cited safe adult limit, `UNVERIFIED` here); late-day use in short sleepers.

**F4. Omega-3 (EPA + DHA)** — verdict `MODEL` for TG/BP (opt-in), `REJECT` for fat loss, grade A
- *BP:* 70 RCTs: SBP −1.52 (−2.25…−0.79), DBP −0.99 (−1.54…−0.44); untreated hypertensives SBP −4.51 (−6.12…−2.83), DBP −3.05 (−4.35…−1.74); normotensives −1.25/−0.62 [63]. Dose-response (71 trials, n = 4,973, median 2.8 g/d): J-shaped, optimum 2–3 g/d,
  SBP −2.61 (−3.57…−1.65) at 2 g and −2.61 (−3.52…−1.69) at 3 g, DBP −1.64/−1.80 [64].
- *TG:* ≥30 % lower at 4 g/d EPA+DHA in very high TG (≥500 mg/dL), with LDL-C increases [65]; overweight/obese adults standardised MD −0.59 (−0.93…−0.25) [66].
- *Body weight:* WMD **0.00 kg** (−0.42…+0.43; 9 studies), waist −0.53 cm (−0.90…−0.16) [66]. Muscle in older adults: +0.33 kg (0.05–0.62), +0.67 kg (0.16–1.18) above 2 g/d [68]; lean-mass ES 0.27 (0.04–0.51) [177] — small, heterogeneous.
- *Harm:* atrial fibrillation HR **1.25** (1.07–1.46; 7 trials, n = 81,210), 1.49 (1.04–2.15) above 1 g/d, 1.12 (1.03–1.22) at ≤1 g/d, +11 % per 1 g [67].
- *Engine:* X3. *Avoid:* AF history, anticoagulant use (general, `UNVERIFIED`), fish/shellfish allergy. *Planner:* only if TG/BP is a stated goal; dose 2–3 g/d.

**F5. Psyllium / β-glucan / glucomannan** — see A7.

**F6. Vitamin D (only if deficient)** — verdict `INFO`, grade A (null for weight) / B (deficiency)
- Weight: no effect on body weight, fat mass, % fat or lean mass; BMI SMD −0.097 (−0.210…+0.016) (18 trials) [69]. Muscle: strength SMD 0.17 (P = 0.02), no effect on mass (0.058) or power (0.057); larger when 25(OH)D <30 nmol/L and in ≥65 y (SMD 0.25, 0.01–0.48; <65 y 0.03, −0.08…0.14) [70].
  When 25(OH)D >25 nmol/L: grip SMD −0.02, proximal strength 0.10 (ns); in two trials of deficient participants a large hip-strength effect (SMD 3.52, 2.18–4.85) [71].
- *Rule:* recommend testing; supplement to correct deficiency only; no body-composition credit.

**F7. Magnesium** — verdict `INFO` (owner 15), grade A (BP) / C (sleep)
- BP: median 368 mg/d × 3 mo: SBP **−2.00** (−3.58…−0.43), DBP −1.78 (−2.82…−0.73) (34 double-blind RCTs, n = 2,028) [72]. Glycaemia: HOMA-IR −0.67 (−1.20…−0.14), no effect on glucose, HbA1c or insulin [73]. Sleep in older adults: onset latency −17.4 min (−27.3…−7.4), TST +16 min (ns); 3 RCTs, n = 151, low quality [13].
  Cramps: no clinically important benefit in idiopathic cramps (11 trials, n = 735) [74]. *Avoid:* kidney impairment (general, `UNVERIFIED`).

**F8. Dietary nitrate / beetroot** — verdict `SIM` (19, event-day flag, opt-in), grade A/B, performance only
- Endurance: time-to-exhaustion ES **0.33** (0.15–0.50), time-trial and graded-test effects ns (pooled −0.10, −0.27…0.06) [75]; earlier meta: TTE ES 0.79 (0.23–1.35), TT 0.11 (−0.16…0.37) [178]; nitrate/polyphenol foods SMD 0.15 (trivial), no effect in females [79].
  BP (beetroot juice, 22 trials): SBP −3.55 (−4.55…−2.54), DBP −1.32 (−1.97…−0.68); ≥14 d −5.11 vs <14 d −2.67 mmHg [76].

**F9. Beta-alanine** — `SIM` (19), grade B: trained young men, ES 0.34 (0.02–0.67) at 4 wk; efforts of 4–10 min ES **0.55** (0.07–1.04); 5.6–6.4 g/d ES 0.35 (0.09–0.62) [77]. Women: time-to-exhaustion SMD 0.49 (0.20–0.79; k = 8), other outcomes imprecise, certainty very low [179]. Older adults: exercise capacity may improve, strength/function not [180].

**F10. Citrulline (malate)** — `SIM` (19), grade B: high-intensity strength/power SMD **0.20** (0.01–0.39) (12 studies, n = 198, I² 0 %) [78]; citrulline-rich foods: endurance SMD −0.03 (ns) [79]; RPE and 24–48-h soreness lower (13 studies) [181].

**F11. Sodium bicarbonate** — `SIM` (19), grade B: umbrella of 8 reviews — moderate-quality evidence for Wingate peak/mean power and Yo-Yo; low for ~45 s–8 min efforts, muscle endurance, 2,000-m rowing; effect sizes 0.09–1.26 [80]; team-sport HIIE g 0.23 (0.07–0.39; 95 % PI −0.22…0.68), low certainty [182]. GI distress is the usual cost (general, `UNVERIFIED`). Performance only.

**F12. MCT oil** — verdict `SIM` (05 ketones) / `REJECT` as fat-loss lever, grade B/C
- Replacing LCT by MCT: weight −0.51 kg (−0.80…−0.23), waist −1.46 cm, total body fat SMD −0.39, visceral fat SMD −0.55 (13 trials, n = 749; commercial bias flagged) [81]; second meta −0.69 kg (−1.1…−0.28), body fat −0.89 kg (−1.27…−0.51) (11 trials, low–moderate quality) [82]. Ketone contribution → 05.

**F13. Exogenous ketones (esters/salts)** — verdict `SIM` (05, ketone level as an *ingested* input; no autophagy credit) / `REJECT` for performance and fat loss, grade B
- 43 trials: acute glucose-lowering (pooled magnitude not extracted) [84]. Ketone diester before a ~31-km time trial in 10 professional cyclists: **2 ± 1 % impairment**, gut discomfort, higher perceived exertion [83]. BP: SBP SMD −0.14 (−0.40…0.11), HR tendency ↑ (10 studies, n = 187) [183]. Cognition SMD 0.29 (0.16–0.41; 29 protocols, n = 1,117) [184].
  08 §4.18: ketone esters raise post-exercise muscle mTORC1 signalling (opposite direction to autophagy).

**F14. Green-tea catechins (± caffeine)** — verdict `REJECT`, grade A (null)
- Cochrane: outside Japan **−0.04 kg** (−0.5…+0.4; 6 studies, n = 532, 12–13 wk), BMI −0.2 (−0.5…0.1); Japanese trials −0.2 to −3.5 kg but not poolable [85]. Earlier meta: −1.31 kg with moderation by habitual caffeine and ethnicity [86]. As add-on to exercise: SMD −0.30 (−0.53…−0.07) weight, fat −0.29 (−0.57…−0.01) (10 RCTs) [185]. High-dose EGCG liver toxicity (general, `UNVERIFIED`).

**F15. Capsaicin / capsinoids** — `REJECT` as lever, grade A: −0.51 kg (−0.86…−0.15), BMI −0.25 (−0.35…−0.15) (15 RCTs, n = 762) [87]. Capsinoids 6 wk raised CIT to ~200 vs ~81 kcal/d (reported unit; same caveat as D3) in low-BAT men [41].

**F16. Berberine** — `INFO`/`REJECT` for weight, grade A: body weight −0.11 kg (−0.99…+0.76, ns), BMI −0.29 (−0.51…−0.08), waist −2.75 cm (−4.88…−0.62) (10 studies) [88]. T2DM (37 studies, n = 3,048): FPG −0.82 mmol/L (−0.95…−0.70), HbA1c −0.63 % (−0.72…−0.53), 2-h glucose −1.16 (−1.36…−0.96), larger at higher baseline [89] — drug-like; interaction with glucose-lowering medication (general, `UNVERIFIED`).

**F17. Apple-cider vinegar** — `INFO`, grade B/C: FPG −7.97 mg/dL (−13.74…−2.21), HbA1c −0.50 (−0.90…−0.09), TC −6.06 mg/dL (−10.95…−1.17); no effect on LDL, HDL, insulin, HOMA-IR; in healthy participants FPG and HDL *rose* (9 studies) [90]. Single RCT, obese Japanese, 15 or 30 mL/d × 12 wk: weight, BMI, visceral fat, waist and TG lower than placebo (magnitudes `UNVERIFIED` in the abstract) [91].
  Systematic review: evidence insufficient; few side effects at usual amounts [186]. Not a weight lever.

**F18. Probiotics** — `REJECT`, grade B: weight −0.26 kg (−0.75…+0.23, ns), BMI −0.73 (−1.31…−0.16), waist −0.71 cm (20 RCTs, n = 1,411, overweight/obesity with metabolic disease) [92]; 2026 meta of 12 mostly East-Asian RCTs: −0.52 kg (−0.90…−0.13), body fat −0.59 % (−0.96…−0.21) [187]. Strain-specific and small.

**F19. Spermidine** — `REJECT` for autophagy/body outcomes, grade D (autophagy) / C (cognition): 12 mo, 100 older adults with subjective cognitive decline: no effect on mnemonic discrimination (−0.03; −0.11…0.05) [98]; pilot (n = 30) memory d = 0.77 (0.0–1.53) [188]; no human autophagy measurement (08 §4.18).

**F20. NMN / NR (NAD⁺ precursors)** — `REJECT`, grade B (null in aggregate): 8 RCTs (n = 342): no significant effect on fasting glucose, insulin, HbA1c, HOMA-IR or lipids [94]; older adults: no effect on skeletal-muscle index, grip, gait speed [93]; one 10-wk RCT in postmenopausal prediabetic women raised clamp-measured muscle insulin sensitivity and signalling [95] (unreplicated).

**F21. Resveratrol** — `REJECT`, grade B: no effect on glycaemic measures in non-diabetics; improves glucose/insulin/HbA1c/HOMA in diabetes (11 RCTs, n = 388) [96]. In 27 older men, 250 mg/d during 8 wk of high-intensity training: VO₂max gain **45 % smaller** than placebo, MAP fell only on placebo [97] — warn.

**F22. Collagen peptides** — `INFO` (skin) / `REJECT` for muscle, grade B (skin) / C–D (muscle): 19 RCTs (n = 1,125, 95 % women, ~90 d) improved skin hydration, elasticity and wrinkles [100]; 26 RCTs (n = 1,721) confirm hydration/elasticity [189]. Muscle performance SMD 0.60 (0.05–1.15), BMD gains with high heterogeneity (I² 80 %) [99]. Collagen is an incomplete protein (`UNVERIFIED` here) and is not a whey substitute.

**F23. Ashwagandha** — `INFO`, not modelled, grade B (sleep/stress) / C (performance) with a safety flag: sleep SMD −0.59 (−0.75…−0.42) (5 RCTs, n = 400; larger with insomnia, ≥600 mg/d, ≥8 wk) [14]; anxiety SMD −1.55 (−2.37…−0.74) (12 papers, n = 1,002) [101]; performance: Bayesian meta-analysis (13 studies) favours ashwagandha, magnitude not extracted [102];
  **liver injury**: 5 cases with jaundice after 2–12 wk, cholestatic/mixed, normalised in 1–5 mo [103].

**F24. Electrolytes on low-carbohydrate/fasting** — pointer 15/20 (not evaluated here).

**F25. "Weight-loss supplement" umbrella (glucomannan, chitosan, CLA, garcinia, carnitine…)** — `REJECT`, grade A (limited effect)
- Chitosan −1.84 kg (−2.79…−0.88), glucomannan −1.27 kg (−2.45…−0.09), CLA −1.08 kg (−1.61…−0.55): **none met the 2.5-kg clinical threshold**; fructans ns [104]. 315 RCTs of 14 supplements/therapies: only 52 (16.5 %) were low-risk and sufficient, of which 16 showed significant differences (0.3–4.93 kg) [105].
  Garcinia/HCA −0.88 kg (−1.75…0.00), GI adverse events twice as common [106]; L-carnitine −1.33 kg (−2.09…−0.57), shrinking with duration (P = 0.002) [107].

**F26. HMB and BCAA** — `REJECT` (HMB) / `INFO` (BCAA), grade B: HMB in young adults with RT: no improvement in fat-free mass or strength (11 of 14 eligible studies analysed, n = 302) [108]; older adults + RT: handgrip SMD 0.24 (0.00–0.48), SPPB 0.54 (0.12–0.95), no lean/fat/weight effect [190]. BCAA lowered creatine kinase (−71.6 U/L at <24 h, −145 U/L at 24 h) without a soreness benefit (8 trials) [191].

**F27. Melatonin (sleep)** — `INFO`, grade A (small): 19 studies, n = 1,683: sleep latency **−7.06 min** (−9.75…−4.37), TST +8.25 min (1.74–14.75), quality SMD 0.22 (0.12–0.32); larger with higher dose and longer use [9]. No body-composition claim.

**F28. Antioxidant megadoses around training (vitamin C 1,000 mg + E 235 mg)** — `REJECT`/warning, grade B: 54 adults, 11 wk of endurance training: VO₂max +8 % in both groups but the mitochondrial marker COX4 and PGC-1α rose in placebo (+59 ± 97 %, +19 ± 51 %) and were blunted with vitamins [110].

---

### 4G. Behavioural levers with quantified effects (feed the adherence / ad-libitum-intake model, not physiology)

**G1. Self-weighing** — verdict `ADH`, grade B
- *Effect:* as a single strategy −0.5 kg (−1.3…+0.3; one study, ns); added to multi-component programmes **−1.7 kg** (−2.6…−0.8; 4 trials); multi-component programmes containing self-weighing vs minimal control **−3.4 kg** (−4.2…−2.6; 15 trials); daily vs weekly weighing no difference;
  accountability strengthened the effect (P = 0.03) [139]. Psychological meta-analysis: no association with affect, body-related attitudes or disordered eating, a small negative association with "psychological functioning" [140]. *Avoid:* eating-disorder history (general, `UNVERIFIED`).

**G2. Food logging / dietary self-monitoring** — verdict `ADH`, grade B
- *Effect:* within the WLM behavioural trial (n = 1,685, 6 mo, mean −5.8 kg, mean 3.7 records/wk) each additional weekly food record predicted **−0.52 kg** (−0.67…−0.37), each session attended −0.29 kg, each 100 min/wk of moderate activity −0.76 kg (regression, observational within an RCT) [141].
  Digital self-monitoring of diet + activity (12 RCTs): weight **−2.87 kg** (−3.78…−1.96), calorie intake −182 kcal/d (−305…−59), moderate activity SMD 0.44 [142]. Systematic review: association with weight loss consistent, evidence weak methodologically [143].

**G3. Meal prepping / day-to-day consistency (weekday vs weekend)** — verdict `REJECT` (unquantified), grade D: Europe PMC title searches for weekend/consistency dieting and weight change (2026-09-30) returned **0** records; no RCT or meta-analysis quantifying meal prepping was located. The closest engine hook is the weekly-rhythm term `P_week` in 18 §4.9.

**G4. Flexible vs rigid dietary restraint** — verdict `ADH` (design rule), grade C: rigid control associated with higher disinhibition, BMI and binge-eating frequency; flexible control with lower disinhibition, lower BMI, lower reported intake and a higher probability of successful weight reduction over a 1-year programme [144] (validation/cohort data; no RCT).
  *Planner rule:* prefer plans with explicit flexibility (e.g. 1–2 unscored flex meals/wk) over all-or-nothing rules.

**G5. Reducing the ultra-processed share** — verdict `ADH` (ad-lib mode; X11), grade B
- 20 adults, 14-d inpatient crossover, meals matched for presented calories, energy density, macronutrients, sugar, sodium and fibre: ad-libitum intake **+508 ± 106 kcal/d** on the ultra-processed diet (carbohydrate +280 ± 54, fat +230 ± 53, protein −2 ± 12 kcal/d); weight **+0.9 ± 0.3 kg vs −0.9 ± 0.3 kg** [138]. One trial, two weeks; long-term (>8 wk) RCT data were not located.

**G6. Plate / portion / package size** — verdict `ADH`, grade A (intake)
- Cochrane meta-analysis (86 comparisons, 58 studies, n = 6,603): larger portion/package/tableware size increased consumption SMD **0.38** (0.29–0.46); adults 0.46 (0.40–0.52), children 0.21 (0.10–0.31); moderate-quality evidence; if sustained across the whole diet, ≈**−144 to −228 kcal/d** (8.5–13.5 % of 1,689 kcal) [137].

**G7. Mindful / slow eating and mindfulness programmes** — verdict `ADH` (weak), grade C
- Mindfulness-based interventions: pre-post weight-loss g 0.42 (0.26–0.59; 16 studies), mean loss 6.8 lb at post-treatment and 7.5 lb at follow-up; obesity-related eating behaviours g 0.70 (0.36–1.04) [145] (mostly uncontrolled pre-post); a second meta-analysis found short-term benefits on health behaviours and no long-term weight data [192]. Eating rate: see A12.

**G8. Social support** — verdict `INFO`, grade C: 24 trials (n = 4,919) of couple/peer-based programmes: effects inconsistent across time points, low certainty [146]. Support-group attendance after bariatric surgery is associated with greater loss (10 observational studies, n = 735) [193].

**G9. Financial incentives** — verdict `INFO` (programme design, not a user lever), grade B (short term): weight −2.36 kg (1.80–2.93) in adults with chronic conditions (9 RCTs, n = 1,799 vs 1,483) [147]; SMD 0.180 during the incentive but **0.032 (ns) after removal** (29 studies) [148].

**G10. Mapping behavioural effects to the adherence model (Deliverable feed; PROPOSED, grade D).** 01 §4.4.2 (Thomas 2014) draws each day's intake as the prescription with probability *p* (monthly adherence) and otherwise a random deviation; long-run loss is roughly proportional to *p*. Anchoring on a typical 6-mo loss of ~5–6 kg [141]:

| Lever bundle | Anchor effect | `Δp` (PROPOSED; range) | Diminishing-returns rule |
|---|---|---|---|
| Self-monitoring package (daily weighing + ≥5 d/wk logging) | −1.7 to −2.9 kg [139,142]; −0.52 kg per weekly record [141] | +0.10 (0.05–0.15) | sum of all `Δp` capped at +0.15 |
| Meal replacement ≥1 meal/d | g 0.26 [128] | +0.05 (0–0.10) | |
| Pre-meal water | −1.3 to −2 kg [129,130] | +0.03 (0–0.05) | |
| Flexible-restraint plan (1–2 flex meals/wk) | [144] | +0.03 (0–0.05; D) | |
| Financial incentive / social support | SMD 0.18→0.03 [148]; inconsistent [146] | 0 (not modelled) | |

### 4H. Medical levers — **out of scope for prescribing; recognise, disclaim, lock out** (one line each, verified effect sizes)

| Lever | Verified effect | What the app must do |
|---|---|---|
| GLP-1RA / dual GIP-GLP-1 / triple agonists | Semaglutide 2.4 mg/wk 68 wk: **−14.9 % vs −2.4 %** (diff −12.4 points, −13.4…−11.5), −15.3 vs −2.6 kg, ≥15 % loss 50.5 % vs 4.9 % [156]. Tirzepatide 72 wk: −15.0 / −19.5 / **−20.9 %** (5/10/15 mg) vs −3.1 %; ≥20 % loss in 50–57 % at 10–15 mg [157]. Retatrutide (phase 2, 12 mg): −17.5 % at 24 wk and **−24.2 %** at 48 wk vs −1.6 % / −2.1 % on placebo [158]. Lean-mass share of the loss ranged from ~0 % to 40 % across semaglutide trials (6 studies, n = 1,541) [159] | detect flag → planner weight-loss goals disabled; simulator shows "medication not modelled"; generic muscle-retention message; `never` tier for planner |
| Metformin | DPP: diabetes incidence −31 % (17–43 %); weight −2.06 ± 5.65 % vs −0.02 ± 5.52 % at 2 y, durable ~2.0 vs 0.2 % loss over ~10 y [160,161] | flag; not simulated |
| SGLT2 inhibitors | Weight −1.30 to −2.24 kg (dapagliflozin 2.5–20 mg) and −1.20 to −2.37 kg (canagliflozin 50–300 mg) vs placebo [164]. **Euglycaemic ketoacidosis risk** relevant to fasting, very-low-energy and ketogenic regimens [165] | flag → block zero-intake and very-low-carbohydrate blocks in the planner; strong warning in the simulator (17) |
| Orlistat | XENDOS 4 y: −5.8 vs −3.0 kg; diabetes incidence 6.2 % vs 9.0 % (−37.3 %); completion 52 % vs 34 % [162] | flag; fat-soluble vitamin/gut effects are clinical matters |
| Bariatric surgery | Roux-en-Y −32 % at 1–2 y, **−25 % at 10 y**; vertical-banded gastroplasty −16 %, banding −14 % at 10 y; adjusted mortality HR 0.71 [163] | different regime (protein, micronutrients, dumping); simulator disabled or "post-surgical" warning |
| Testosterone / anabolics | Middle-aged men (1,083 subjects, mean age 64.5 y): fat mass **−1.6 kg** (−2.5…−0.6), FFM **+1.6 kg** (0.6–2.6), no weight change, lumbar BMD +3.7 % [166]. Supraphysiologic testosterone (dose and duration not in the abstract; recalled 600 mg/wk × 10 wk, `UNVERIFIED`) + strength training: FFM +6.1 ± 0.6 kg [167] | flag; the app must not imply natural rates can match; hormone axes not simulated as a treatment |
| Thyroid hormone for weight loss | No consistent effect on weight loss, protein breakdown or metabolic rate; T4 associated with 3.3-fold mortality in acute renal failure [168] | never a lever; warning if the user reports off-label use |

---

## 4I. Deliverable (a) — lever × outcome matrix (levers with verdict `MODEL` first; `SIM`/`ADH` rows for completeness)

Legend: `++` strong, `+` modest, `0` none/null, `−` adverse, `−−` strongly adverse, `·` not assessed/not modelled; letter = grade of the row's dominant signal. Magnitudes are the verified headline numbers, not simulator outputs.

| Lever (verdict) | Fat loss | Lean / muscle | Glycogen / performance | Ketosis | Autophagy / cellular | Insulin sens. / glycaemia | Lipids / BP | Hunger / adherence | Hormones | Sleep / wellbeing | Grade |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Daily steps 7–10k (`MODEL`) | + (BMI −0.38) | 0 | + | 0 | · | + | + (SBP −3.8) | 0 | · | + (depression HR 0.78, assoc.) | A/B |
| Post-meal light walk 10–15 min (`MODEL`) | 0 | · | · | 0 | · | + (iAUC ×0.88; ×0.78 dinner) | · | · | · | · | B |
| Sleep +1 h if habitually <6.5 h (`MODEL`) | + (−270 kcal/d) | + (FFM share of loss 80→52 %) | + (C) | · | · | + | · | + | + (leptin, PYY ↓ hunger) | ++ | B |
| Creatine 3–5 g/d (`MODEL`) | 0 (scale +0.9 kg) | + (+1.1 kg with RT, incl. water) | ++ (high-intensity) | 0 | · | 0 | 0 | 0 | · | + (memory g 0.31) | A |
| Caffeine 3–6 mg/kg, early day (`MODEL`) | 0 | 0 | + (TT −2.2 %) | 0 | · | · | · | 0 | · | − if late (TST −45 min); + alertness after sleep loss | A |
| Viscous fibre ~10 g/d (`MODEL`) | + (−0.3 kg) | 0 | 0 | 0 | · | + (T2DM only) | ++ (LDL −0.25…−0.33 mmol/L) | + (C) | · | 0 (GI −) | A |
| Omega-3 EPA+DHA 2–3 g/d (`MODEL`, opt-in) | 0 | 0/+ (C) | 0 | 0 | · | 0 | + (TG ↓; SBP −2.6) | 0 | · | · | A (harm: AF ×1.25) |
| Low energy-density eating (`ADH`) | + | 0 | · | 0 | · | · | · | + | · | · | A/B |
| Ultra-processed share ↓ (`ADH`) | + (−508 kcal/d ad lib) | 0 | · | 0 | · | · | · | + | · | · | B |
| Portion / plate size (`ADH`) | + (−144…−228 kcal/d if sustained) | 0 | · | 0 | · | · | · | + | · | · | A |
| Self-monitoring package (`ADH`) | + (−1.7…−2.9 kg) | 0 | · | 0 | · | · | · | ++ | · | · | B |
| Liquid → solid / low-cal beverage swap (`ADH`) | + (−1.06 kg) | 0 | · | 0 | · | · | · | + | · | · | B |
| Meal replacement ≥1 meal/d (`ADH`) | + (g 0.26) | 0 | · | 0 | · | · | · | + | · | · | A (short) |
| Pre-meal water 500 mL (`ADH`) | + (−1.3…−2 kg/12 wk) | 0 | · | 0 | · | · | · | + | · | · | B/C |
| Standing / sit breaks (`SIM`) | 0/+ (9–15 kcal/d) | 0 | · | 0 | · | + (small) | · | · | · | · | A (kcal) |
| Exercise snacks (`SIM`) | 0 | 0 | + (VO₂ g 1.37) | 0 | · | · | 0 (LDL ↓ in one meta) | + (adherence 83–91 %) | · | · | B |
| Sauna 2–4×/wk (`SIM`, opt-in) | 0 | 0 | 0/+ (PV +7 % n = 6; meta trivial) | 0 | · | · | + (SBP −8 RCT; −4 used) | · | 0 chronic (GH acute) | + (C) | C |
| Cold exposure / BAT (`SIM`, opt-in) | 0/+ (≤25 kcal/session) | 0 | · | 0 | · | + (C; +43 % in 8 T2D) | · | · | · | 0 | C |
| Post-RT cold-water immersion (`SIM`, conflict) | 0 | − (strength ES −0.23) | 0 | 0 | · | · | · | · | · | + (soreness) | B |
| Protein-first meal order (`SIM`) | 0 | 0 | · | 0 | · | + (iAUC −39 %) | · | · | · | · | C/B |
| Late eating (+4 h) (`SIM`, 07) | − (EE −59 kcal/d) | · | · | · | · | · | · | − (hunger ↑) | − (ghrelin:leptin ↑) | · | B |
| Alcohol after RT, 1.5 g/kg (`SIM`) | − | − (MPS −24…−37 %) | − | · | · | · | · | · | · | − | B |
| Nitrate / β-alanine / citrulline / bicarbonate (`SIM`, event-day) | 0 | 0 | + (ES 0.2–0.55) | 0 | · | · | + (nitrate SBP −3.6) | 0 | · | 0 (GI −) | A/B |
| Magnesium 300–370 mg/d (`INFO`) | 0 | 0 | 0 | 0 | · | + (HOMA-IR −0.67) | + (SBP −2.0) | · | · | + (C) | A/C |
| Vitamin D, if deficient (`INFO`) | 0 | + only if deficient | 0 | 0 | · | 0 | 0 | · | · | · | B |

---

## 4J. Deliverable (c) — planner building blocks contributed by this dossier

Each block is defined only by measurable quantities, and maps onto the lever registry of 18 §4.4.1 (`kind`: `dayParam` / `dayOverlay` / `event` / `phaseModifier`). Tiers use 18's `SafetyTier` (`default` = offered without consent; `optIn` = offered after a consent flag; `never` = planner never proposes; simulator may still simulate with warnings). Blocks named **Lxx** to avoid collision with 13's **Bxx**. No block carries a physiological "bonus" beyond the verified effects in §4.

| Id | Kind / family | Definition (measurable) | Duration limits | Prerequisites / exclusions | Spacing / composition rules | Tier | Engine channels written | Expected effect (grade) |
|---|---|---|---|---|---|---|---|---|
| **L1 Step target** | dayParam / `steps` | Target 4,000–12,000 steps/d; ramp ≤ +1,000–2,000 steps/wk (general practice, `UNVERIFIED`) | none | no acute lower-limb injury | none; also feeds 02 NEAT | default | `steps` | BMI −0.38, SBP −3.8 mmHg (B); risk proxy per C1 (A, assoc.) |
| **L2 Post-meal walk** | dayParam / `postMealWalk` | 5–15 min light walking (≈2.5–4 km/h; PROPOSED) starting ≤30 min after 1–3 meals/d | none | none | do not count toward RT volume | default | `postMealWalkMin` | meal iAUC ×0.88 (×0.78 after dinner) (B) |
| **L3 Sit-breaks / standing** | dayParam / `neat` | +0–4 h/d standing; or 1–2-min light walk every 30 min | none | none | shown with the "≈10–15 kcal/d" caveat | default | `standingHours` | +9 kcal/h (A); glycaemia small (B) |
| **L4 Exercise snacks** | dayParam / `snack` | 3–6 bouts/d of 20–60 s near-maximal effort (e.g. stair climbing), ≥3 d/wk | 4–12 wk blocks | cardiac screen (high intensity); no acute injury | ≥3 h between bouts; ≥1 rest day/wk; not on the day of a max-effort session (PROPOSED) | optIn | 10 (VO₂ signal) | VO₂ g 1.37 (B); **no fat-loss credit** |
| **L5 Sleep extension** | phaseModifier / `sleep` | time in bed +0.5–1.5 h toward 7.5–8.5 h; actual sleep target ≥7 h | ≥14 d to show effect; no upper limit | habitual sleep <7 h; no insomnia/apnoea flag | keep bed/wake times fixed ±30 min (regularity, C) | default | `sleepHours` (16) | ad-lib intake −225 kcal/d per h; lean-share ↑ (B) |
| **L6 Caffeine timing** | event / `caffeine` | 3–6 mg/kg taken 45–60 min pre-session; last dose ≥ `t_cut(D)` = 8.8 + 6.2·ln(D/107) h before bed; ≤400 mg/d (`UNVERIFIED` cap) | none; keep ≥1 caffeine-free day/wk (PROPOSED, tolerance) | not pregnancy/anxiety/arrhythmia/uncontrolled hypertension | excludes late-day sessions for short sleepers | default ≤3 mg/kg; optIn 3–6 mg/kg | `caffeineMg`, `caffeineLastClock` | TT −2.2 %, strength SMD 0.20 (A); sleep cost otherwise (A) |
| **L7 Creatine** | dayParam / `creatine` | 3–5 g/d monohydrate; optional loading 0.3 g/kg/d (≈20 g) for 5–7 d | indefinite; washout ≈30 d | no kidney disease (`UNVERIFIED`); accepts +~1 kg water | none | default (maintenance); optIn (loading) | `creatineG` | LBM +1.1 kg with RT incl. water (A) |
| **L8 Omega-3** | dayParam / `omega3` | 2–3 g/d EPA+DHA | ≥8–12 wk to judge TG/BP | goal = TG or BP; no AF history, no anticoagulants (general, `UNVERIFIED`); ≤3 g/d | none | optIn | `omega3G` | TG ↓, SBP −2.6 (A); AF HR 1.25 (A, harm) |
| **L9 Viscous fibre** | dayParam / `fibre` | 5–15 g/d psyllium in ≥250 mL water before meals, ramp +5 g/wk; or oat β-glucan ≥3 g/d | ≥4 wk to judge LDL (trials 2–12 wk) | no swallowing disorder; separate from oral medicines (`UNVERIFIED`) | counts toward 15's fibre total | default | `viscousFibreG` | LDL −0.25…−0.33 mmol/L (A); weight −0.3 kg |
| **L10 Protein-first order** | dayParam / `mealOrder` | protein + vegetables ≥10 min before carbohydrate in ≥1 meal/d | none | none | none | default | `mealOrderProteinFirst` | meal iAUC ×0.61 (C/B); glycaemia only |
| **L11 Water preload** | dayParam / `preload` | 500 mL water ≤30 min before ≤3 main meals/d | typical trials 12 wk | not on fluid restriction, heart/kidney failure, hyponatraemia risk (`UNVERIFIED`) | only in deficit phases | default | `preMealWaterMl` | −1.3…−2 kg/12 wk (B/C) → `Δp` +0.03 |
| **L12 Ad-lib food environment** | dayParam / `foodEnv` | served energy density ≤1.1 kcal/g at ≥1 meal; ultra-processed energy share ≤20 %; ≤ standard portion size | none | not for underweight, frailty or high-energy athletes | only when intake is ad libitum | default | `energyDensity`, `upfShare` | −223 kcal/meal-period (A), −508 kcal/d at high UPF (B) |
| **L13 Self-monitoring** | phaseModifier / `monitor` | weigh ≥ weekly (daily optional) and log food ≥5 d/wk | none | opt-out flag for eating-disorder history (general) | none | default (opt-out) | `selfMonitor` | `Δp` +0.10 (B/D) |
| **L14 Meal replacement** | dayOverlay / `mealRep` | 1–2 meals/d replaced by a portion-controlled product | ≤12 wk continuous at ≤2 meals/d; >60 % of energy = 13's B5 (supervised) | none | must respect protein floors (03) | default | `mealReplacementShare` | g 0.26 (A); `Δp` +0.05 |
| **L15 Sauna** | event / `sauna` | 10–20 min at 80–100 °C, 2–4 sessions/wk (PROPOSED range spanning the exposures in [31,34]) | ≥8 wk to see BP; no upper limit | not pregnancy, unstable CVD, severe aortic stenosis (general, `UNVERIFIED`); avoid alcohol/dehydration; men trying to conceive [33] | keep ≥1 h from hard training if performance goal; hydrate | optIn | `saunaSessionsPerWeek`, `saunaMin` | SBP −4 (used) to −8 (RCT) (C) |
| **L16 Cold exposure** | event / `cold` | (a) 30–90 s cold finish to a shower daily; or (b) 10–15-min immersion ≤15 °C | (a) 30 d trials; (b) ≤3×/wk | not CVD, Raynaud, cold urticaria (general, `UNVERIFIED`) | **never within ~6 h after RT if a muscle goal is ranked ≤2** (`excludes` scope day); no fat-loss credit | optIn | `coldMinPerDay`, `coldTempC` | insulin sensitivity (C); sickness absence −29 % (C); RT penalty (B) |
| **L17 Event-day performance stack** | event / `perfStack` | nitrate 300–600 mg (single dose to 15 d), β-alanine 4–6.4 g/d ≥4 wk, citrulline malate ~8 g pre-session, bicarbonate (dose per 19) | event-specific; not daily | GI-tolerance trial before racing; not in `Δ` fat-loss goals | one new agent at a time (PROPOSED) | optIn | `nitrateMg`, `betaAlanineG`, `citrullineG`, `bicarbGperKg` | ES 0.2–0.55 (A/B), performance only |
| **L18 Post-RT alcohol abstinence** | dayParam / `alcoholFree` | 0 g alcohol for ≥8 h after RT (window PROPOSED from 2/8-h biopsies in [155]) | none | none | complements 15/16 | default (advice) | `alcoholGPerKgPostRT` | avoids MPS −24…−37 % (B, single dose) |
| **L19 Late-eating avoidance** | dayParam / `mealClock` | last meal ≥3 h before bed; do not delay all meals ≥4 h | none | shift workers exempt | owned by 07 | default | meal clock times | EE +59 kcal/d relative to +4-h delay (B) |

**Never-tier for the planner (simulator may show with warnings):** every medical lever in §4H; exogenous ketone esters as a performance aid (evidence −2 % [83]); antioxidant megadoses around training [110]; alcohol ≥1 g/kg within 8 h after RT [155]; ashwagandha and berberine as self-treatment (hepatic/glycaemic-drug interaction signals [103,89]); cold-water immersion within ~6 h after RT when a muscle goal is top-2 [46,47]; caffeine inside `t_cut` for habitual short sleepers [4].

**Composition rules (added to 13's "Sequencing rules"):** (1) L5 (sleep) is evaluated first because it changes ad-lib intake and the lean-share of loss; (2) L6 cut-off is checked against the sleep window produced by L5; (3) L16(b) excludes RT within the ~6-h post-RT window when the muscle-gain goal is ranked ≤2 — otherwise allowed with the `f_CWI` penalty shown; (4) no behavioural block may raise total `Δp` above +0.15; (5) `optIn` blocks cannot be added to a plan without their exclusion questions answered in the profile.

---

## 4K. Deliverable (d) — rejected levers appendix (each with the citation that justifies rejection)

| Lever | Claim tested | Why it is rejected (numbers) | Ref |
|---|---|---|---|
| Green-tea catechins / EGCG | fat loss | Cochrane: −0.04 kg (−0.5…+0.4) outside Japan, n = 532; only −0.30 SMD as add-on to exercise | [85,185] |
| Glucomannan, chitosan, CLA, garcinia, carnitine | weight loss | pooled −0.9 to −1.8 kg, **none met the ≥2.5 kg clinical threshold**; 16.5 % of 315 RCTs low-risk and sufficient | [104,105,106,107,116] |
| Omega-3 | fat loss | WMD 0.00 kg (−0.42…0.43) | [66] |
| Vitamin D (replete) | fat loss / muscle | no effect on weight, fat, lean mass; strength gain only if 25(OH)D <25–30 nmol/L | [69,70,71] |
| Probiotics | weight loss | −0.26 kg (ns); −0.52 kg in a small East-Asian set; strain-specific | [92,187] |
| Berberine | body weight | −0.11 kg (−0.99…0.76); glucose effect is drug-like, T2DM | [88,89] |
| HMB | lean mass in trained young | no effect on FFM or strength; older adults: function only | [108,190] |
| NMN / NR | metabolic / muscle | no effect on glucose, insulin, HbA1c, lipids, muscle index | [93,94] |
| Resveratrol | insulin sensitivity (non-diabetic); training | no effect; blunted VO₂max gain (−45 %) in older men | [96,97] |
| Spermidine | autophagy, cognition | 12-mo RCT null (−0.03; −0.11…0.05); no human autophagy measurement | [98,188] |
| Vitamin C/E megadoses | training adaptation | blunted COX4/PGC-1α with equal VO₂max gain | [110] |
| Exogenous ketone esters | endurance performance | −2 ± 1 % in professional cyclists with gut distress | [83] |
| Fasted cardio | fat loss | 4-wk volume-equated RCT: no difference; acute fat oxidation only | [29,30] |
| "Carb back-loading" | body composition | **no RCT located** (0 records) | – |
| Evening-carbohydrate timing | fat loss | single 6-mo RCT (n = 78), no replication/meta-analysis | [123] |
| High-protein breakfast | daily intake / weight | no difference in daily energy intake | [133] |
| Caffeine | fat loss | dose-response meta-analysis uninterpretable (I² 91–94 %); +150 kcal/d needed ~6 doses of 100 mg; sleep cost −45 min | [61,62,4] |
| Capsaicin | weight | −0.51 kg | [87] |
| Apple-cider vinegar | weight | evidence "insufficient"; glycaemia-only benefit (FPG −8 mg/dL) | [90,91,186] |
| Collagen | muscle gain | SMD 0.60 (0.05–1.15) with high heterogeneity; bone I² 80 % | [99] |
| MCT oil | fat loss | −0.5 to −0.7 kg, commercial-bias flag | [81,82] |
| Standing / treadmill desks | weight loss | ≈9–15 kcal/d; active workstations inconsistent | [15,16] |
| Sauna "GH/detox" | anabolic/body-comp | GH ×16 acute, response declines after day 3; no body-comp outcome | [38] |
| Cold exposure "brown-fat burn" | fat loss | ≈9–24 kcal per 2-h session if 24-h-extrapolated; reported fat loss is ≈5–15× larger than that supports; n = 11 | [41,42] |
| Post-RT cold-water immersion | hypertrophy | strength ES −0.23 (−0.45…−0.01); type II fibre CSA gain (+17 % with active recovery) not seen with CWI in one RCT | [46,47] |
| Protein-cycling / fat-fast for autophagy | autophagy | no human dietary trial located (2026-09-30 search) | – |
| Meal prepping | adherence / weight | no quantifying RCT located | – |
| Exercise snacks | fat loss, BP | no effect on body composition, BP, lipids (BJSM 2026) | [25,26] |
| Melatonin | body composition | only −7 min sleep latency; no body-comp data | [9] |
| Social support / financial incentives (as user levers) | weight | inconsistent / SMD 0.18 → 0.03 after removal | [146,148] |
| Ashwagandha | muscle / hormones | performance signal low-quality; hepatotoxic cases | [102,103] |
| Dry fasting (Ramadan-style) | any | excluded from the app; −1.0 kg transient, regains within 2–5 wk | [150,151] |

---

## 5. Interactions with other subsystems

| Subsystem | This dossier needs / gives |
|---|---|
| 01 / 02 energy balance | **Gives** small EE terms: standing +9 kcal/h [15], cold-induced thermogenesis ≤~25 kcal per 2-h session (D3), late-eating EE −59 kcal/d [134]; caffeine EE (+79…+150 kcal/d at ~600 mg/d [61]) is documented but **not credited**. **Gives** `pAdhere_lever` (≤ +0.15) to 01 §4.4.2 / 18 §4.9. **Needs** NEAT and steps energy cost from 02/10. |
| 03 protein / MPS | Even protein distribution (+25 % 24-h MPS [118], conflicting in elders [119]); alcohol after RT −24…−37 % MPS [155]; pre-sleep casein [117]; supplement ceiling 1.62 g/kg/d [109]; creatine accretion multiplier and CWI penalty enter 09's accretion via `f_Cr`, `f_CWI`. |
| 04 glucose / insulin | Post-meal walk ×0.88 [19], sit-breaks ×0.75 [20], protein-first ×0.61 [122], viscous fibre (T2DM) [112] as multipliers on the meal glucose-appearance/insulin response in the Bergman-type fast model (01 §4.10.1). No effect on glycogen storage assumed. |
| 05 ketosis | MCT oil and ketone esters raise BHB as an **ingested** input (F12, F13); no carry-over to the ketone-production state; ketone esters impair TT [83]. SGLT2i flag → block ketogenic/zero-intake blocks [165]. |
| 06 lipids / BP | Psyllium/β-glucan LDL [111,113], omega-3 TG/BP [63–65], magnesium SBP −2 [72], sauna SBP scalar [34], steps SBP −3.8 [23]. Omega-3 AF flag [67]. |
| 07 timing | Late eating [134], OMAD [153], ADF [154], Ramadan-style [150,151]. This dossier does not add timing effects beyond those. |
| 08 autophagy | **No lever here raises the Autophagy Signal Index** (no compound, no sauna, no cold). Exogenous ketones and NR/NMN are D-grade for autophagy (08 §4.18). Exercise remains the largest modifier. |
| 09 / 10 training | `f_Cr` (F1), `f_CWI` (D4), sleep lean-share (E1), exercise snacks VO₂ (C4). Fasted-vs-fed cardio: null for fat (C6). |
| 12 hormones/appetite | Satiety and hunger-index inputs from viscous fibre, low ED, water preload, sleep, late eating; adherence process `p` (§3, G10). GH ×16 from sauna is acute only [38] — not a hormone-axis credit. |
| 13 transitions | L-blocks compose with B-blocks under 13's sequencing rules plus §4J composition rules. |
| 15 substances | Ownership split: **15 owns doses, kinetics and safety for caffeine, creatine, fibre types and alcohol; this dossier owns the effect-size verdicts.** If numbers differ, 15 wins on physiology, this dossier on verdict. |
| 16 sleep | E1/E2 numbers; caffeine cut-off feeds the sleep module; sleep aids (melatonin, Mg, ashwagandha) are INFO only. |
| 17 safety | Tiers in §4J; SGLT2i/GLP-1 lock-outs; AF (omega-3), hepatic (ashwagandha), renal (creatine label), cardiac (sauna/cold/HIIT). |
| 18 planner | Every L-block is a registry entry (§4J). Never-tier list is compile-time filtered. |
| 19 performance | Nitrate, β-alanine, citrulline, bicarbonate, caffeine, creatine: ES table in §3/X16 and `%TT ≈ 5.4×ES` (PROPOSED from [60]). |

### 5A. Lever × lever conflicts and synergies (planner composition facts)

| Pair | Type | Basis | Rule |
|---|---|---|---|
| Caffeine (F3) × sleep extension (E1) | conflict | dose inside `t_cut` costs ~45 min TST [4], cancelling extension of ~1.2 h [1] | evaluate L6 after L5; move last dose earlier or lower the dose |
| Post-RT cold-water immersion (D4) × resistance-training goal | conflict | strength ES −0.23 [47]; fibre CSA gain lost in one RCT [46] | never within ~6 h after RT if a muscle goal ranks ≤2 (L16) |
| Alcohol (A16) × RT recovery, sleep | conflict | MPS −24…−37 % at 1.5 g/kg [155] | L18 advice; simulator applies X17 |
| Creatine (F1) × scale-weight goals | trade-off | +~0.9 kg water at full loading [56] | show scale +0.9 kg and lean-mass reading +1.1 kg as expected, not as fat gain |
| Creatine (F1) × resistance training (09) | synergy | +1.10 kg with RT vs +0.68 overall [52]; no effect on mixed exercise | apply `f_Cr` only when RT is scheduled |
| Sleep extension (E1) × late eating (A15) | unknown | each shifts ad-lib intake/EE in its own trial [1,134]; no trial combined them | treat as additive (assumption; no interaction term claimed) |
| Viscous fibre (A7) × zero-intake days | irrelevant/skip | no energy or food to buffer; GI load | drop L9 on fasting days; resume with 13's B20 ramp |
| Water preload (A11) × fasting/very-low-energy blocks | conflict | fluid + sodium handling is 15/20's; preload effect shown only on ad-lib eating [129,130] | disable L11 in blocks with <3 meals/d |
| Post-meal walk (C2) × exercise snacks (C4) | unknown | walking acts on postprandial glucose [19,20]; snacks show no verified glycaemic effect here [25] | treat as independent; keep snacks ≥3 h from RT |
| Sauna (D1) × dehydration-prone blocks (fasting, low-carbohydrate) | conflict (safety) | heat load, sweat and sodium losses (general, `UNVERIFIED`); 15/20 own electrolyte rules | block L15 on ≥24-h fast days and the first day of very-low-carbohydrate |
| Omega-3 (F4) × AF / anticoagulants | contraindication | AF HR 1.25 [67] | L8 excludes AF history |
| SGLT2 inhibitor (H) × any zero-intake or ketogenic block | contraindication | euglycaemic ketoacidosis [165] | X18 flag blocks those blocks |
| Cold (D3) × sauna (D1) | neutral | winter swimmers combine both; no interaction quantified [45] | independent inputs |

### 5B. Time-constant summary (for the engine's state and lag terms)

| Lever | Onset | Build time / time-constant | Washout / reversal | Source (grade) |
|---|---|---|---|---|
| Creatine (muscle total Cr) | ≤6 d at 20 g/d; ~28 d at 3 g/d | t₉₅ ≈ 6 d / 25–28 d | ≈30 d to baseline after stopping; 2 g/d maintains | [55] (B) |
| Creatine body water | ≤7 d | tracks `CrLoad` | tracks `CrLoad` | [56] (B) |
| Sleep extension → intake | within the trial (duration `UNVERIFIED`) | not measured | not measured | [1] (B) |
| Sleep restriction → partition | 14 d | – | – | [2] (B) |
| Post-meal walk, breaks, food order | immediate, single meal | – | none | [18–20,122] (B/C) |
| Standing energy | immediate | – | – | [15] (A) |
| BAT recruitment (cold) | ~10 d | 10 d–6 wk; τ_up 21 d (PROPOSED) | ≈1 mo; τ_dn 30 d (PROPOSED) | [44,41,10] (C) |
| Sauna BP effect | ≥8 wk in the RCT | – | unknown | [34] (C) |
| Sauna plasma volume | 3 wk | – | unknown | [36] (C) |
| Post-RT CWI penalty | chronic (12-wk RCT) | – | lapses when CWI stops (assumed) | [46] (B) |
| Psyllium / β-glucan LDL | 2–12-wk trials, no duration dependence | fully present by 2–12 wk | assumed reverses on stopping (`UNVERIFIED`) | [111,113] (A) |
| Magnesium BP | ~1 mo sufficient (spline analysis) | – | – | [72] (A/B) |
| Omega-3 BP/TG | weeks | trials 4 wk–years (`UNVERIFIED` per-trial durations) | – | [63–65] (A) |
| Caffeine performance / sleep | 45–60 min / same night | half-life ~5 h (`UNVERIFIED`) | – | [60,4] (A) |
| Water-preload intake effect | acute | habituates: 43 kcal at baseline → 26 kcal (ns) at week 12 | – | [129] (B) |
| Late-eating EE/hunger | within the controlled in-patient days | – | – | [134] (B) |
| Metformin weight | 2 y | durable ~10 y | – | [161] (A) |
| GLP-1/GIP agonists | trial durations 48–72 wk | trajectories not extracted | out of scope | [156–158] (A) |

---

## 6. Output metrics for the UI

| Metric | Unit | Good direction | Computation | Grade |
|---|---|---|---|---|
| Creatine saturation | % of max | ↑ (for strength goals) | `100·CrLoad` | B (kinetics [55]) |
| Steps-based risk proxy | HR vs 2,000 steps/d | ↓ | `HR_proxy(s)` (C1), label "association from cohorts" | B |
| Relative meal glycaemic load index | ratio to baseline meal iAUC | ↓ | product of X5, X9, X4 factors (floor 0.4) | C/B |
| Sleep–caffeine conflict | min of TST lost | ↓ | 45 min × 1[last dose < `t_cut(D)`] (scaled by dose ratio) | A |
| Cold-adaptation index | 0–1 | info | `BATidx` | C/D |
| Ad-lib intake estimate | kcal/d | goal-dependent | habitual intake + Σ(X11, X12, X13, sleep) in ad-lib mode | B/C |
| Adherence probability | 0–1 | ↑ | base `p` + `pAdhere_lever` (cap +0.15) | D |
| Lever-derived BP shift | mmHg | ↓ | sum of omega-3, magnesium, sauna, steps scalars (each shrunk as in §3; cap −8 mmHg total) | C |
| Behavioural complexity load | points | ↓ | feeds 18 §4.9 `complexityCost` (per active L-block) | – |

---

## 7. Validation targets (published results the engine should reproduce within tolerance)

1. **Creatine loading kinetics** — Hultman 1996, 31 men [55]: 20 g/d × 6 d → muscle total creatine +~20 %; 2 g/d holds it for 30 d; no supplement → back to baseline within 30 d; 3 g/d × 28 d → same +20 %. Tolerance: `CrLoad ≥ 0.9` by day 6 at 20 g/d, ≥0.85 by day 28 at 3 g/d, ≤0.1 by day 30 after stopping.
2. **Creatine + RT lean-mass reading** — Delpino 2022 [52]: +1.10 kg (0.56–1.65) vs placebo in RT trials (typical 8–16 wk); Powers 2003 [56]: body mass +0.75 kg at day 7 (loading), higher by day 28. Tolerance: modelled ΔLBM(reading) 0.6–1.7 kg at 12 wk with RT.
3. **Sleep extension** — Tasali 2022 [1]: +1.2 h (1.0–1.4) → EI −270 kcal/d (−393…−147), TEE unchanged. Tolerance: `−200…−340 kcal/d`, TEE change ≤ ±30 kcal.
4. **Sleep restriction while dieting** — Nedeltcheva 2010 [2], 14 d: 8.5 h vs 5.5 h → fat loss 1.4 vs 0.6 kg, FFM loss 1.5 vs 2.4 kg (other conditions such as the exact deficit not in the abstract: `UNVERIFIED`). Tolerance: FFM share of loss 52 % vs 80 % ± 8 points.
5. **Ultra-processed vs unprocessed ad libitum** — Hall 2019 [138], 20 adults, 14 d each: +508 ± 106 kcal/d; weight +0.9 ± 0.3 vs −0.9 ± 0.3 kg. Tolerance: ΔEI 400–610 kcal/d at the trial UPF share; weight sign correct.
6. **Postprandial interventions** — Dunstan 2012 [20]: glucose iAUC 6.9 → 5.2 (light) / 4.9 (moderate) mmol/L·h, insulin 828.6 → 633.6 / 637.6 pmol/L·h; Reynolds 2016 [19]: ratio 0.88 (0.78–0.99), 0.78 after dinner; Shukla 2019 [122]: −38.8 % iAUC with protein/vegetables first. Tolerance: factors within the reported CIs.
7. **Cold/BAT upper bound** — Yoneshiro 2013 [41]: 6 wk × 2 h/d at 17 °C: reported CIT 108 → 289 kcal/d, fat mass −0.70 kg (n = 11). The engine must **not exceed** ≈25 kcal per 2-h session (reported-unit reading) and must show fat change ≤ that implied by energy accounting; the trial's −0.70 kg is documented as an outlier.
8. **Caffeine and sleep** — Gardiner 2023 [4]: TST −45 min, SOL +9 min, WASO +12 min; cut-offs 8.8 h (107 mg) / 13.2 h (217.5 mg). Southward 2018 [60]: TT −2.22 % at 3–6 mg/kg. Tolerance: `t_cut` within ±1 h at the two anchor doses; TT effect ±0.5 %.
9. **Standing energy** — Saeidifard 2018 [15]: 0.15 kcal/min (0.12–0.17); 6 h/d → +54 kcal/d for 65 kg. Tolerance: 7–10 kcal/h.
10. **Post-RT CWI** — Grgic 2023 [47]: strength ES −0.23 (−0.45…−0.01) (limb −0.31); Roberts 2015 [46]: type II fibre CSA +17 % (active recovery) vs no significant change (CWI). Tolerance: modelled strength/accretion ratio 0.65–0.95 of control.

---

## 8. Myths / contested claims

| Claim | Evidence |
|---|---|
| "Cold showers / ice baths burn fat via brown fat" | Recruited BAT: reported CIT +181 kcal/d-equivalent after 6 wk in n = 11, i.e. ≈9–24 kcal per 2-h session if 24-h-extrapolated; the −0.70 kg fat loss is ≈5–15× what that supports [41]; effect rests on one small trial. Severe cold (+250 kcal in 3 h) needs shivering-level exposure [42]. Cold **after lifting** blunts gains (ES −0.23) [46,47]. |
| "Sauna spikes growth hormone → muscle/fat benefits" | GH ×16 occurred with twice-daily 80 °C sauna and the response declined after day 3; testosterone, TSH, thyroid hormones unchanged [38]. No body-composition outcome exists. |
| "Sauna adds years / prevents heart attacks" | Dose-response cohorts (SCD HR 0.37 for 4–7 vs 1 sessions/wk [31]) are confounded by fitness and healthy-user effects; joint models show fitness carries most of the signal [173]; RCT SBP −8 mmHg vs exercise alone comes from n = 47 [34]. |
| "10,000 steps is the magic number" | Mortality benefit plateaus at 6,000–8,000 (≥60 y) and 8,000–10,000 (<60 y) [21]; 7,000 vs 2,000 steps gives HR 0.53 [22]. The 10,000 goal did predict pedometer-trial effects [23] but the curve is not a threshold. |
| "Standing desks / walking desks help you lose weight" | +0.15 kcal/min; real-world sitting cut 57–100 min/d ⇒ 9–15 kcal/d [15,16]; treadmill desks had unclear effects on sitting [16]. |
| "Fasted cardio burns more fat" | more fat oxidised *during* the session (+3.08 g), no difference in fat loss over 4 wk at equal volume and diet [29,30]. |
| "Carb back-loading / evening carbs are metabolically special" | no back-loading RCT located; one 6-mo trial for evening carbohydrates, unreplicated [123]. |
| "Green tea, capsaicin, berberine, vinegar, probiotics are metabolic boosters" | Cochrane green tea −0.04 kg [85]; capsaicin −0.51 kg [87]; berberine weight −0.11 kg ns [88]; probiotics −0.26 kg ns [92]; vinegar: insufficient evidence for weight [186]. |
| "NAD⁺ boosters / spermidine / resveratrol slow ageing" | NMN/NR: no significant effect on glucose, lipids or muscle in RCTs [93,94]; spermidine 12-mo null [98]; resveratrol blunted VO₂max gains in older men [97]; no human autophagy read-out (08). |
| "Antioxidants help you recover and adapt" | 1,000 mg vitamin C + 235 mg E did not change VO₂max gain but blunted COX4 and PGC-1α responses [110]. |
| "Ketone esters are a performance hack" | 2 ± 1 % slower TT in professional cyclists with gut discomfort [83]. |
| "Caffeine is a fat burner" | ~+150 kcal/d needed ~600 mg/d [61]; dose-response weight meta-analysis is uninterpretable (I² 91–94 %) [62]; cost −45 min sleep if late [4]. |
| "Omega-3 melts fat" | 0.00 kg (−0.42…+0.43) [66]; benefit is TG/BP; AF risk rises >1 g/d [67]. |
| "Vitamin D supplements build muscle/lose fat" | no effect in replete adults [69,71]; benefit in deficiency and older age [70]. |
| "Protein can only be used 25–30 g at a time" | the ceiling depends on food form and context; MPS gains from even distribution are shown short term but not consistently in muscle mass [118–121,169]. |
| "Collagen is protein enough for muscle" | muscle signal weak and heterogeneous [99]; skin benefit is the replicated one [100,189]. |
| "Meal replacements are magic" | g 0.26 vs food-based diets, ≥60 % of energy g 0.545; long-term benefit inconclusive [128,172]. |
| "Social support / money guarantee results" | inconsistent [146]; incentive effect vanishes after removal (SMD 0.18 → 0.03) [148]. |

---

## 9. Safety bounds relevant to this topic

(General-knowledge safety statements are marked `UNVERIFIED`; verified statements cite the source. Tier logic per 17/18.)
- **Sauna:** not for pregnancy, unstable cardiovascular disease, severe aortic stenosis (`UNVERIFIED`); avoid alcohol and dehydration (`UNVERIFIED`); reversible impairment of spermatogenesis reported in one small study [33]; women: transient amenorrhoea in 5/7 with 1 h × 2/d for 7 d [38].
- **Cold:** not with cardiovascular disease, Raynaud, cold urticaria (`UNVERIFIED`); cold-shock risk in open water (`UNVERIFIED`); post-RT CWI penalty [46,47].
- **Caffeine:** pregnancy, anxiety disorders, arrhythmia; common adult cap 400 mg/d (`UNVERIFIED`); sleep cost quantified [4]; last dose ≥ `t_cut(D)` before bed.
- **Creatine:** safe up to 30 g/d for 5 y in healthy people [57]; withhold with existing kidney disease (`UNVERIFIED`); inform of +~1 kg water [56].
- **Omega-3:** AF HR 1.25, 1.49 at >1 g/d [67]; keep ≤3 g/d; anticoagulant users (`UNVERIFIED`).
- **Ashwagandha:** hepatotoxicity case series (jaundice after 2–12 wk; recovery 1–5 mo) [103] — INFO only, never proposed.
- **Berberine / vinegar:** glucose-lowering; interaction with glucose-lowering medication (`UNVERIFIED`); no self-treatment of diabetes.
- **Bicarbonate / ketone esters / citrulline / β-alanine:** GI distress (bicarbonate `UNVERIFIED`; ketone diester documented [83]); trial in training first.
- **Pre-meal water / fluid loading:** fluid-restricted, heart or kidney failure, hyponatraemia risk (`UNVERIFIED`); trials used 500 mL ×3/d [129].
- **SGLT2 inhibitors:** euglycaemic ketoacidosis risk with fasting/very-low-carbohydrate/low-energy regimens [165] → planner block, simulator warning.
- **GLP-1/GIP agonists, bariatric surgery, testosterone/anabolics, thyroid hormone:** out of scope; planner locked; disclaimers [156–168]. Semaglutide-associated lean-mass loss up to ~40 % of weight lost in some trials [159].
- **Exercise snacks / HIIT-style blocks:** cardiac screen; injury history.
- **Self-weighing / logging:** eating-disorder history — offer opt-out (general, `UNVERIFIED`; no adverse psychological effect on average [140]).

---

## 10. Open questions / weakest assumptions

1. **Cold/BAT energy.** That Yoneshiro's "kcal/d" is a 24-h-equivalent rate is very probable (convention in [194,195]) but the protocol text was not read; the fat-loss effect is from n = 11 and is unreplicated. Dose–response for temperature × duration × frequency is unknown.
2. **Sauna BP scalar.** The −4 mmHg used is a 50 % shrink of a single n = 47 RCT (exercise + sauna vs exercise), with cohort confounding unresolved; no RCT of sauna alone on mortality proxies.
3. **Sleep-extension durability.** Tasali reports the intake effect over the trial period (duration not read); longer-term maintenance and the partition (`0.52 + 0.28·(8.5−h)/3`) rest on a single 14-d crossover in ~10 adults [2].
4. **Adherence mapping (`Δp`).** Converting weight-loss differences in kg into a per-day probability is a coarse linear assumption (grade D); the −0.52 kg/record slope is observational within an RCT [141].
5. **Creatine tissue vs water split.** The +1.1 kg meta-analytic "lean mass" includes intracellular water; the 15 % accretion multiplier is a proposal. Kinetics for 5 g/d (no loading) are interpolated between 3 g and 20 g points.
6. **Caffeine EE and tolerance.** Dulloo's schedule and habitual-user tolerance were not fully verified; EE credit is withheld.
7. **Ad-lib intake mode.** ED, UPF, liquid, portion and water-preload effects come from short (1 meal–14 d) controlled studies; compensation over months is unknown. The Klos contrast (1.1 vs 1.5 kcal/g) is per tested intake period (15 of 38 studies are single-meal designs).
8. **Meta-analyses not fully read.** Several entries rely on abstracts (Bleakley Cochrane, Falkenhain ketone glucose magnitude, Benjamin heat-acclimation magnitudes, Bonilla ashwagandha performance); magnitudes are omitted rather than guessed.
9. **Not evaluated:** sport/play, zone-2 dose–response, electrolytes on low-carbohydrate/fasting (15/20), fat-source swaps (06), dry-fasting physiology beyond Ramadan cohorts, resistance-training variables (09), menstrual-cycle timing of levers (16). No high-quality source was retrieved for carb-cycling to training beyond 13.
10. **Populations.** Most RCTs are young/middle-aged and male; women, older adults and people with obesity are under-represented for creatine kinetics, cold, sauna and supplements (exceptions cited).

---

## 11. References

Numbers match the in-text `[n]` citations. All bibliographic data were retrieved from Europe PMC (PMID-keyed) on 2026-09-30; every URL is the PubMed record. Cross-dossier pointers are written as "dossier NN" (no bracket numbers).

1. Tasali E, Wroblewski K, Kahn E, et al. Effect of Sleep Extension on Objectively Assessed Energy Intake Among Adults With Overweight in Real-life Settings: A Randomized Clinical Trial. *JAMA internal medicine* 2022;182(4):365-374. PMID 35129580. doi:10.1001/jamainternmed.2021.8098. https://pubmed.ncbi.nlm.nih.gov/35129580/
2. Nedeltcheva AV, Kilkus JM, Imperial J, et al. Insufficient sleep undermines dietary efforts to reduce adiposity. *Annals of internal medicine* 2010;153(7):435-441. PMID 20921542. doi:10.7326/0003-4819-153-7-201010050-00006. https://pubmed.ncbi.nlm.nih.gov/20921542/
3. Henst RHP, Pienaar PR, Roden LC, et al. The effects of sleep extension on cardiometabolic risk factors: A systematic review. *Journal of sleep research* 2019;28(6):e12865. PMID 31166059. doi:10.1111/jsr.12865. https://pubmed.ncbi.nlm.nih.gov/31166059/
4. Gardiner C, Weakley J, Burke LM, et al. The effect of caffeine on subsequent sleep: A systematic review and meta-analysis. *Sleep medicine reviews* 2023;69:101764. PMID 36870101. doi:10.1016/j.smrv.2023.101764. https://pubmed.ncbi.nlm.nih.gov/36870101/
5. Drake C, Roehrs T, Shambroom J, et al. Caffeine effects on sleep taken 0, 3, or 6 hours before going to bed. *Journal of clinical sleep medicine : JCSM : official publication of the American Academy of Sleep Medicine* 2013;9(11):1195-1200. PMID 24235903. doi:10.5664/jcsm.3170. https://pubmed.ncbi.nlm.nih.gov/24235903/
6. Cribb L, Sha R, Yiallourou S, et al. Sleep regularity and mortality: a prospective analysis in the UK Biobank. *eLife* 2023;12:RP88359. PMID 37995126. doi:10.7554/elife.88359. https://pubmed.ncbi.nlm.nih.gov/37995126/
7. Windred DP, Burns AC, Lane JM, et al. Sleep regularity is a stronger predictor of mortality risk than sleep duration: A prospective cohort study. *Sleep* 2024;47(1):zsad253. PMID 37738616. doi:10.1093/sleep/zsad253. https://pubmed.ncbi.nlm.nih.gov/37738616/
8. Reid KJ, Santostasi G, Baron KG, et al. Timing and intensity of light correlate with body weight in adults. *PloS one* 2014;9(4):e92251. PMID 24694994. doi:10.1371/journal.pone.0092251. https://pubmed.ncbi.nlm.nih.gov/24694994/
9. Ferracioli-Oda E, Qawasmi A, Bloch MH. Meta-analysis: melatonin for the treatment of primary sleep disorders. *PloS one* 2013;8(5):e63773. PMID 23691095. doi:10.1371/journal.pone.0063773. https://pubmed.ncbi.nlm.nih.gov/23691095/
10. Lee P, Smith S, Linderman J, et al. Temperature-acclimated brown adipose tissue modulates insulin sensitivity in humans. *Diabetes* 2014;63(11):3686-3698. PMID 24954193. doi:10.2337/db14-0513. https://pubmed.ncbi.nlm.nih.gov/24954193/
11. Silva AC, Silva A, Edwards BJ, et al. Sleep extension in athletes: what we know so far - A systematic review. *Sleep medicine* 2021;77:128-135. PMID 33352457. doi:10.1016/j.sleep.2020.11.028. https://pubmed.ncbi.nlm.nih.gov/33352457/
12. Afaghi A, O'Connor H, Chow CM. High-glycemic-index carbohydrate meals shorten sleep onset. *The American journal of clinical nutrition* 2007;85(2):426-430. PMID 17284739. doi:10.1093/ajcn/85.2.426. https://pubmed.ncbi.nlm.nih.gov/17284739/
13. Mah J, Pitre T. Oral magnesium supplementation for insomnia in older adults: a Systematic Review & Meta-Analysis. *BMC complementary medicine and therapies* 2021;21(1):125. PMID 33865376. doi:10.1186/s12906-021-03297-z. https://pubmed.ncbi.nlm.nih.gov/33865376/
14. Cheah KL, Norhayati MN, Husniati Yaacob L, et al. Effect of Ashwagandha (Withania somnifera) extract on sleep: A systematic review and meta-analysis. *PloS one* 2021;16(9):e0257843. PMID 34559859. doi:10.1371/journal.pone.0257843. https://pubmed.ncbi.nlm.nih.gov/34559859/
15. Saeidifard F, Medina-Inojosa JR, Supervia M, et al. Differences of energy expenditure while sitting versus standing: A systematic review and meta-analysis. *European journal of preventive cardiology* 2018;25(5):522-538. PMID 29385357. doi:10.1177/2047487317752186. https://pubmed.ncbi.nlm.nih.gov/29385357/
16. Shrestha N, Kukkonen-Harjula KT, Verbeek JH, et al. Workplace interventions for reducing sitting at work. *The Cochrane database of systematic reviews* 2018;12:CD010912. PMID 30556590. doi:10.1002/14651858.cd010912.pub5. https://pubmed.ncbi.nlm.nih.gov/30556590/
17. Levine JA, Lanningham-Foster LM, McCrady SK, et al. Interindividual variation in posture allocation: possible role in human obesity. *Science (New York, N.Y.)* 2005;307(5709):584-586. PMID 15681386. doi:10.1126/science.1106561. https://pubmed.ncbi.nlm.nih.gov/15681386/
18. Buffey AJ, Herring MP, Langley CK, et al. The Acute Effects of Interrupting Prolonged Sitting Time in Adults with Standing and Light-Intensity Walking on Biomarkers of Cardiometabolic Health in Adults: A Systematic Review and Meta-analysis. *Sports medicine (Auckland, N.Z.)* 2022;52(8):1765-1787. PMID 35147898. doi:10.1007/s40279-022-01649-4. https://pubmed.ncbi.nlm.nih.gov/35147898/
19. Reynolds AN, Mann JI, Williams S, et al. Advice to walk after meals is more effective for lowering postprandial glycaemia in type 2 diabetes mellitus than advice that does not specify timing: a randomised crossover study. *Diabetologia* 2016;59(12):2572-2578. PMID 27747394. doi:10.1007/s00125-016-4085-2. https://pubmed.ncbi.nlm.nih.gov/27747394/
20. Dunstan DW, Kingwell BA, Larsen R, et al. Breaking up prolonged sitting reduces postprandial glucose and insulin responses. *Diabetes care* 2012;35(5):976-983. PMID 22374636. doi:10.2337/dc11-1931. https://pubmed.ncbi.nlm.nih.gov/22374636/
21. Paluch AE, Bajpai S, Bassett DR, et al. Daily steps and all-cause mortality: a meta-analysis of 15 international cohorts. *The Lancet. Public health* 2022;7(3):e219-e228. PMID 35247352. doi:10.1016/s2468-2667(21)00302-9. https://pubmed.ncbi.nlm.nih.gov/35247352/
22. Ding D, Nguyen B, Nau T, et al. Daily steps and health outcomes in adults: a systematic review and dose-response meta-analysis. *The Lancet. Public health* 2025;10(8):e668-e681. PMID 40713949. doi:10.1016/s2468-2667(25)00164-1. https://pubmed.ncbi.nlm.nih.gov/40713949/
23. Bravata DM, Smith-Spangler C, Sundaram V, et al. Using pedometers to increase physical activity and improve health: a systematic review. *JAMA* 2007;298(19):2296-2304. PMID 18029834. doi:10.1001/jama.298.19.2296. https://pubmed.ncbi.nlm.nih.gov/18029834/
24. Creasy SA, Lang W, Tate DF, et al. Pattern of Daily Steps is Associated with Weight Loss: Secondary Analysis from the Step-Up Randomized Trial. *Obesity (Silver Spring, Md.)* 2018;26(6):977-984. PMID 29633583. doi:10.1002/oby.22171. https://pubmed.ncbi.nlm.nih.gov/29633583/
25. Rodríguez MÁ, Quintana-Cepedal M, Cheval B, et al. Effect of exercise snacks on fitness and cardiometabolic health in physically inactive individuals: systematic review and meta-analysis. *British journal of sports medicine* 2026;60(2):133-141. PMID 41057224. doi:10.1136/bjsports-2025-110027. https://pubmed.ncbi.nlm.nih.gov/41057224/
26. Wan KW, Dai ZH, Wong PS, et al. Effects of Exercise Snacks on Cardiometabolic Health and Body Composition in Adults: A Systematic Review and Meta-Analysis. *Scandinavian journal of medicine & science in sports* 2025;35(8):e70114. PMID 40814152. doi:10.1111/sms.70114. https://pubmed.ncbi.nlm.nih.gov/40814152/
27. Wewege M, van den Berg R, Ward RE, et al. The effects of high-intensity interval training vs. moderate-intensity continuous training on body composition in overweight and obese adults: a systematic review and meta-analysis. *Obesity reviews : an official journal of the International Association for the Study of Obesity* 2017;18(6):635-646. PMID 28401638. doi:10.1111/obr.12532. https://pubmed.ncbi.nlm.nih.gov/28401638/
28. Gillen JB, Martin BJ, MacInnis MJ, et al. Twelve Weeks of Sprint Interval Training Improves Indices of Cardiometabolic Health Similar to Traditional Endurance Training despite a Five-Fold Lower Exercise Volume and Time Commitment. *PloS one* 2016;11(4):e0154075. PMID 27115137. doi:10.1371/journal.pone.0154075. https://pubmed.ncbi.nlm.nih.gov/27115137/
29. Vieira AF, Costa RR, Macedo RC, et al. Effects of aerobic exercise performed in fasted v. fed state on fat and carbohydrate metabolism in adults: a systematic review and meta-analysis. *The British journal of nutrition* 2016;116(7):1153-1164. PMID 27609363. doi:10.1017/s0007114516003160. https://pubmed.ncbi.nlm.nih.gov/27609363/
30. Schoenfeld BJ, Aragon AA, Wilborn CD, et al. Body composition changes associated with fasted versus non-fasted aerobic exercise. *Journal of the International Society of Sports Nutrition* 2014;11(1):54. PMID 25429252. doi:10.1186/s12970-014-0054-7. https://pubmed.ncbi.nlm.nih.gov/25429252/
31. Laukkanen T, Khan H, Zaccardi F, et al. Association between sauna bathing and fatal cardiovascular and all-cause mortality events. *JAMA internal medicine* 2015;175(4):542-548. PMID 25705824. doi:10.1001/jamainternmed.2014.8187. https://pubmed.ncbi.nlm.nih.gov/25705824/
32. Laukkanen T, Kunutsor SK, Khan H, et al. Sauna bathing is associated with reduced cardiovascular mortality and improves risk prediction in men and women: a prospective cohort study. *BMC medicine* 2018;16(1):219. PMID 30486813. doi:10.1186/s12916-018-1198-0. https://pubmed.ncbi.nlm.nih.gov/30486813/
33. Hussain J, Cohen M. Clinical Effects of Regular Dry Sauna Bathing: A Systematic Review. *Evidence-based complementary and alternative medicine : eCAM* 2018;2018:1857413. PMID 29849692. doi:10.1155/2018/1857413. https://pubmed.ncbi.nlm.nih.gov/29849692/
34. Lee E, Kolunsarka I, Kostensalo J, et al. Effects of regular sauna bathing in conjunction with exercise on cardiovascular function: a multi-arm, randomized controlled trial. *American journal of physiology. Regulatory, integrative and comparative physiology* 2022;323(3):R289-R299. PMID 35785965. doi:10.1152/ajpregu.00076.2022. https://pubmed.ncbi.nlm.nih.gov/35785965/
35. Li Z, Jiang W, Chen Y, et al. Acute and short-term efficacy of sauna treatment on cardiovascular function: A meta-analysis. *European journal of cardiovascular nursing* 2020;20(2):96-105. PMID 32814462. doi:10.1177/1474515120944584. https://pubmed.ncbi.nlm.nih.gov/32814462/
36. Scoon GS, Hopkins WG, Mayhew S, et al. Effect of post-exercise sauna bathing on the endurance performance of competitive male runners. *Journal of science and medicine in sport* 2007;10(4):259-262. PMID 16877041. doi:10.1016/j.jsams.2006.06.009. https://pubmed.ncbi.nlm.nih.gov/16877041/
37. Solomon TPJ, Laye MJ. The effect of post-exercise heat exposure (passive heat acclimation) on endurance exercise performance: a systematic review and meta-analysis. *BMC sports science, medicine & rehabilitation* 2025;17(1):4. PMID 39762944. doi:10.1186/s13102-024-01038-6. https://pubmed.ncbi.nlm.nih.gov/39762944/
38. Leppäluoto J, Huttunen P, Hirvonen J, et al. Endocrine effects of repeated sauna bathing. *Acta physiologica Scandinavica* 1986;128(3):467-470. PMID 3788622. doi:10.1111/j.1748-1716.1986.tb08000.x. https://pubmed.ncbi.nlm.nih.gov/3788622/
39. Benjamin CL, Sekiguchi Y, Fry LA, et al. Performance Changes Following Heat Acclimation and the Factors That Influence These Changes: Meta-Analysis and Meta-Regression. *Frontiers in physiology* 2019;10:1448. PMID 31827444. doi:10.3389/fphys.2019.01448. https://pubmed.ncbi.nlm.nih.gov/31827444/
40. van Marken Lichtenbelt WD, Vanhommerig JW, Smulders NM, et al. Cold-activated brown adipose tissue in healthy men. *The New England journal of medicine* 2009;360(15):1500-1508. PMID 19357405. doi:10.1056/nejmoa0808718. https://pubmed.ncbi.nlm.nih.gov/19357405/
41. Yoneshiro T, Aita S, Matsushita M, et al. Recruited brown adipose tissue as an antiobesity agent in humans. *The Journal of clinical investigation* 2013;123(8):3404-3408. PMID 23867622. doi:10.1172/jci67803. https://pubmed.ncbi.nlm.nih.gov/23867622/
42. Ouellet V, Labbé SM, Blondin DP, et al. Brown adipose tissue oxidative metabolism contributes to energy expenditure during acute cold exposure in humans. *The Journal of clinical investigation* 2012;122(2):545-552. PMID 22269323. doi:10.1172/jci60433. https://pubmed.ncbi.nlm.nih.gov/22269323/
43. Srámek P, Simecková M, Janský L, et al. Human physiological responses to immersion into water of different temperatures. *European journal of applied physiology* 2000;81(5):436-442. PMID 10751106. doi:10.1007/s004210050065. https://pubmed.ncbi.nlm.nih.gov/10751106/
44. Hanssen MJ, Hoeks J, Brans B, et al. Short-term cold acclimation improves insulin sensitivity in patients with type 2 diabetes mellitus. *Nature medicine* 2015;21(8):863-865. PMID 26147760. doi:10.1038/nm.3891. https://pubmed.ncbi.nlm.nih.gov/26147760/
45. Søberg S, Löfgren J, Philipsen FE, et al. Altered brown fat thermoregulation and enhanced cold-induced thermogenesis in young, healthy, winter-swimming men. *Cell reports. Medicine* 2021;2(10):100408. PMID 34755128. doi:10.1016/j.xcrm.2021.100408. https://pubmed.ncbi.nlm.nih.gov/34755128/
46. Roberts LA, Raastad T, Markworth JF, et al. Post-exercise cold water immersion attenuates acute anabolic signalling and long-term adaptations in muscle to strength training. *The Journal of physiology* 2015;593(18):4285-4301. PMID 26174323. doi:10.1113/jp270570. https://pubmed.ncbi.nlm.nih.gov/26174323/
47. Grgic J. Effects of post-exercise cold-water immersion on resistance training-induced gains in muscular strength: a meta-analysis. *European journal of sport science* 2023;23(3):372-380. PMID 35068365. doi:10.1080/17461391.2022.2033851. https://pubmed.ncbi.nlm.nih.gov/35068365/
48. Petersen AC, Fyfe JJ. Post-exercise Cold Water Immersion Effects on Physiological Adaptations to Resistance Training and the Underlying Mechanisms in Skeletal Muscle: A Narrative Review. *Frontiers in sports and active living* 2021;3:660291. PMID 33898988. doi:10.3389/fspor.2021.660291. https://pubmed.ncbi.nlm.nih.gov/33898988/
49. Buijze GA, Sierevelt IN, van der Heijden BC, et al. The Effect of Cold Showering on Health and Work: A Randomized Controlled Trial. *PloS one* 2016;11(9):e0161749. PMID 27631616. doi:10.1371/journal.pone.0161749. https://pubmed.ncbi.nlm.nih.gov/27631616/
50. Bleakley C, McDonough S, Gardner E, et al. Cold-water immersion (cryotherapy) for preventing and treating muscle soreness after exercise. *The Cochrane database of systematic reviews* 2012(2):CD008262. PMID 22336838. doi:10.1002/14651858.cd008262.pub2. https://pubmed.ncbi.nlm.nih.gov/22336838/
51. Chilibeck PD, Kaviani M, Candow DG, et al. Effect of creatine supplementation during resistance training on lean tissue mass and muscular strength in older adults: a meta-analysis. *Open access journal of sports medicine* 2017;8:213-226. PMID 29138605. doi:10.2147/oajsm.s123529. https://pubmed.ncbi.nlm.nih.gov/29138605/
52. Delpino FM, Figueiredo LM, Forbes SC, et al. Influence of age, sex, and type of exercise on the efficacy of creatine supplementation on lean body mass: A systematic review and meta-analysis of randomized clinical trials. *Nutrition (Burbank, Los Angeles County, Calif.)* 2022;103-104:111791. PMID 35986981. doi:10.1016/j.nut.2022.111791. https://pubmed.ncbi.nlm.nih.gov/35986981/
53. Naddafha S, Antonio J, Kreider RB, et al. Creatine monohydrate for lean mass, strength, and bone density in postmenopausal women: a systematic review and meta-analysis. *Journal of the International Society of Sports Nutrition* 2026;23(1):2668435. PMID 42141930. doi:10.1080/15502783.2026.2668435. https://pubmed.ncbi.nlm.nih.gov/42141930/
54. Xu C, Bi S, Zhang W, et al. The effects of creatine supplementation on cognitive function in adults: a systematic review and meta-analysis. *Frontiers in nutrition* 2024;11:1424972. PMID 39070254. doi:10.3389/fnut.2024.1424972. https://pubmed.ncbi.nlm.nih.gov/39070254/
55. Hultman E, Söderlund K, Timmons JA, et al. Muscle creatine loading in men. *Journal of applied physiology (Bethesda, Md. : 1985)* 1996;81(1):232-237. PMID 8828669. doi:10.1152/jappl.1996.81.1.232. https://pubmed.ncbi.nlm.nih.gov/8828669/
56. Powers ME, Arnold BL, Weltman AL, et al. Creatine Supplementation Increases Total Body Water Without Altering Fluid Distribution. *Journal of athletic training* 2003;38(1):44-50. PMID 12937471. https://pubmed.ncbi.nlm.nih.gov/12937471/
57. Kreider RB, Kalman DS, Antonio J, et al. International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine. *Journal of the International Society of Sports Nutrition* 2017;14:18. PMID 28615996. doi:10.1186/s12970-017-0173-z. https://pubmed.ncbi.nlm.nih.gov/28615996/
58. Grgic J, Trexler ET, Lazinica B, et al. Effects of caffeine intake on muscle strength and power: a systematic review and meta-analysis. *Journal of the International Society of Sports Nutrition* 2018;15:11. PMID 29527137. doi:10.1186/s12970-018-0216-0. https://pubmed.ncbi.nlm.nih.gov/29527137/
59. Grgic J, Grgic I, Pickering C, et al. Wake up and smell the coffee: caffeine supplementation and exercise performance-an umbrella review of 21 published meta-analyses. *British journal of sports medicine* 2020;54(11):681-688. PMID 30926628. doi:10.1136/bjsports-2018-100278. https://pubmed.ncbi.nlm.nih.gov/30926628/
60. Southward K, Rutherfurd-Markwick KJ, Ali A. The Effect of Acute Caffeine Ingestion on Endurance Performance: A Systematic Review and Meta-Analysis. *Sports medicine (Auckland, N.Z.)* 2018;48(8):1913-1928. PMID 29876876. doi:10.1007/s40279-018-0939-8. https://pubmed.ncbi.nlm.nih.gov/29876876/
61. Dulloo AG, Geissler CA, Horton T, et al. Normal caffeine consumption: influence on thermogenesis and daily energy expenditure in lean and postobese human volunteers. *The American journal of clinical nutrition* 1989;49(1):44-50. PMID 2912010. doi:10.1093/ajcn/49.1.44. https://pubmed.ncbi.nlm.nih.gov/2912010/
62. Tabrizi R, Saneei P, Lankarani KB, et al. The effects of caffeine intake on weight loss: a systematic review and dos-response meta-analysis of randomized controlled trials. *Critical reviews in food science and nutrition* 2019;59(16):2688-2696. PMID 30335479. doi:10.1080/10408398.2018.1507996. https://pubmed.ncbi.nlm.nih.gov/30335479/
63. Miller PE, Van Elswyk M, Alexander DD. Long-chain omega-3 fatty acids eicosapentaenoic acid and docosahexaenoic acid and blood pressure: a meta-analysis of randomized controlled trials. *American journal of hypertension* 2014;27(7):885-896. PMID 24610882. doi:10.1093/ajh/hpu024. https://pubmed.ncbi.nlm.nih.gov/24610882/
64. Zhang X, Ritonja JA, Zhou N, et al. Omega-3 Polyunsaturated Fatty Acids Intake and Blood Pressure: A Dose-Response Meta-Analysis of Randomized Controlled Trials. *Journal of the American Heart Association* 2022;11(11):e025071. PMID 35647665. doi:10.1161/jaha.121.025071. https://pubmed.ncbi.nlm.nih.gov/35647665/
65. Skulas-Ray AC, Wilson PWF, Harris WS, et al. Omega-3 Fatty Acids for the Management of Hypertriglyceridemia: A Science Advisory From the American Heart Association. *Circulation* 2019;140(12):e673-e691. PMID 31422671. doi:10.1161/cir.0000000000000709. https://pubmed.ncbi.nlm.nih.gov/31422671/
66. Zhang YY, Liu W, Zhao TY, et al. Efficacy of Omega-3 Polyunsaturated Fatty Acids Supplementation in Managing Overweight and Obesity: A Meta-Analysis of Randomized Clinical Trials. *The journal of nutrition, health & aging* 2017;21(2):187-192. PMID 28112774. doi:10.1007/s12603-016-0755-5. https://pubmed.ncbi.nlm.nih.gov/28112774/
67. Gencer B, Djousse L, Al-Ramady OT, et al. Effect of Long-Term Marine ɷ-3 Fatty Acids Supplementation on the Risk of Atrial Fibrillation in Randomized Controlled Trials of Cardiovascular Outcomes: A Systematic Review and Meta-Analysis. *Circulation* 2021;144(25):1981-1990. PMID 34612056. doi:10.1161/circulationaha.121.055654. https://pubmed.ncbi.nlm.nih.gov/34612056/
68. Huang YH, Chiu WC, Hsu YP, et al. Effects of Omega-3 Fatty Acids on Muscle Mass, Muscle Strength and Muscle Performance among the Elderly: A Meta-Analysis. *Nutrients* 2020;12(12):E3739. PMID 33291698. doi:10.3390/nu12123739. https://pubmed.ncbi.nlm.nih.gov/33291698/
69. Pathak K, Soares MJ, Calton EK, et al. Vitamin D supplementation and body weight status: a systematic review and meta-analysis of randomized controlled trials. *Obesity reviews : an official journal of the International Association for the Study of Obesity* 2014;15(6):528-537. PMID 24528624. doi:10.1111/obr.12162. https://pubmed.ncbi.nlm.nih.gov/24528624/
70. Beaudart C, Buckinx F, Rabenda V, et al. The effects of vitamin D on skeletal muscle strength, muscle mass, and muscle power: a systematic review and meta-analysis of randomized controlled trials. *The Journal of clinical endocrinology and metabolism* 2014;99(11):4336-4345. PMID 25033068. doi:10.1210/jc.2014-1742. https://pubmed.ncbi.nlm.nih.gov/25033068/
71. Stockton KA, Mengersen K, Paratz JD, et al. Effect of vitamin D supplementation on muscle strength: a systematic review and meta-analysis. *Osteoporosis international : a journal established as result of cooperation between the European Foundation for Osteoporosis and the National Osteoporosis Foundation of the USA* 2011;22(3):859-871. PMID 20924748. doi:10.1007/s00198-010-1407-y. https://pubmed.ncbi.nlm.nih.gov/20924748/
72. Zhang X, Li Y, Del Gobbo LC, et al. Effects of Magnesium Supplementation on Blood Pressure: A Meta-Analysis of Randomized Double-Blind Placebo-Controlled Trials. *Hypertension (Dallas, Tex. : 1979)* 2016;68(2):324-333. PMID 27402922. doi:10.1161/hypertensionaha.116.07664. https://pubmed.ncbi.nlm.nih.gov/27402922/
73. Simental-Mendía LE, Sahebkar A, Rodríguez-Morán M, et al. A systematic review and meta-analysis of randomized controlled trials on the effects of magnesium supplementation on insulin sensitivity and glucose control. *Pharmacological research* 2016;111:272-282. PMID 27329332. doi:10.1016/j.phrs.2016.06.019. https://pubmed.ncbi.nlm.nih.gov/27329332/
74. Garrison SR, Korownyk CS, Kolber MR, et al. Magnesium for skeletal muscle cramps. *The Cochrane database of systematic reviews* 2020;9:CD009402. PMID 32956536. doi:10.1002/14651858.cd009402.pub3. https://pubmed.ncbi.nlm.nih.gov/32956536/
75. McMahon NF, Leveritt MD, Pavey TG. The Effect of Dietary Nitrate Supplementation on Endurance Exercise Performance in Healthy Adults: A Systematic Review and Meta-Analysis. *Sports medicine (Auckland, N.Z.)* 2017;47(4):735-756. PMID 27600147. doi:10.1007/s40279-016-0617-7. https://pubmed.ncbi.nlm.nih.gov/27600147/
76. Bahadoran Z, Mirmiran P, Kabir A, et al. The Nitrate-Independent Blood Pressure-Lowering Effect of Beetroot Juice: A Systematic Review and Meta-Analysis. *Advances in nutrition (Bethesda, Md.)* 2017;8(6):830-838. PMID 29141968. doi:10.3945/an.117.016717. https://pubmed.ncbi.nlm.nih.gov/29141968/
77. Georgiou GD, Antoniou K, Antoniou S, et al. Effect of Beta-Alanine Supplementation on Maximal Intensity Exercise in Trained Young Male Individuals: A Systematic Review and Meta-Analysis. *International journal of sport nutrition and exercise metabolism* 2024;34(6):397-412. PMID 39032921. doi:10.1123/ijsnem.2024-0027. https://pubmed.ncbi.nlm.nih.gov/39032921/
78. Trexler ET, Persky AM, Ryan ED, et al. Acute Effects of Citrulline Supplementation on High-Intensity Strength and Power Performance: A Systematic Review and Meta-Analysis. *Sports medicine (Auckland, N.Z.)* 2019;49(5):707-718. PMID 30895562. doi:10.1007/s40279-019-01091-z. https://pubmed.ncbi.nlm.nih.gov/30895562/
79. d'Unienville NMA, Blake HT, Coates AM, et al. Effect of food sources of nitrate, polyphenols, L-arginine and L-citrulline on endurance exercise performance: a systematic review and meta-analysis of randomised controlled trials. *Journal of the International Society of Sports Nutrition* 2021;18(1):76. PMID 34965876. doi:10.1186/s12970-021-00472-y. https://pubmed.ncbi.nlm.nih.gov/34965876/
80. Grgic J, Grgic I, Del Coso J, et al. Effects of sodium bicarbonate supplementation on exercise performance: an umbrella review. *Journal of the International Society of Sports Nutrition* 2021;18(1):71. PMID 34794476. doi:10.1186/s12970-021-00469-7. https://pubmed.ncbi.nlm.nih.gov/34794476/
81. Mumme K, Stonehouse W. Effects of medium-chain triglycerides on weight loss and body composition: a meta-analysis of randomized controlled trials. *Journal of the Academy of Nutrition and Dietetics* 2015;115(2):249-263. PMID 25636220. doi:10.1016/j.jand.2014.10.022. https://pubmed.ncbi.nlm.nih.gov/25636220/
82. Bueno NB, de Melo IV, Florêncio TT, et al. Dietary medium-chain triacylglycerols versus long-chain triacylglycerols for body composition in adults: systematic review and meta-analysis of randomized controlled trials. *Journal of the American College of Nutrition* 2015;34(2):175-183. PMID 25651239. doi:10.1080/07315724.2013.879844. https://pubmed.ncbi.nlm.nih.gov/25651239/
83. Leckey JJ, Ross ML, Quod M, et al. Ketone Diester Ingestion Impairs Time-Trial Performance in Professional Cyclists. *Frontiers in physiology* 2017;8:806. PMID 29109686. doi:10.3389/fphys.2017.00806. https://pubmed.ncbi.nlm.nih.gov/29109686/
84. Falkenhain K, Daraei A, Forbes SC, et al. Effects of Exogenous Ketone Supplementation on Blood Glucose: A Systematic Review and Meta-analysis. *Advances in nutrition (Bethesda, Md.)* 2022;13(5):1697-1714. PMID 35380602. doi:10.1093/advances/nmac036. https://pubmed.ncbi.nlm.nih.gov/35380602/
85. Jurgens TM, Whelan AM, Killian L, et al. Green tea for weight loss and weight maintenance in overweight or obese adults. *The Cochrane database of systematic reviews* 2012;12:CD008650. PMID 23235664. doi:10.1002/14651858.cd008650.pub2. https://pubmed.ncbi.nlm.nih.gov/23235664/
86. Hursel R, Viechtbauer W, Westerterp-Plantenga MS. The effects of green tea on weight loss and weight maintenance: a meta-analysis. *International journal of obesity (2005)* 2009;33(9):956-961. PMID 19597519. doi:10.1038/ijo.2009.135. https://pubmed.ncbi.nlm.nih.gov/19597519/
87. Zhang W, Zhang Q, Wang L, et al. The effects of capsaicin intake on weight loss among overweight and obese subjects: a systematic review and meta-analysis of randomised controlled trials. *The British journal of nutrition* 2023;130(9):1645-1656. PMID 36938807. doi:10.1017/s0007114523000697. https://pubmed.ncbi.nlm.nih.gov/36938807/
88. Xiong P, Niu L, Talaei S, et al. The effect of berberine supplementation on obesity indices: A dose- response meta-analysis and systematic review of randomized controlled trials. *Complementary therapies in clinical practice* 2020;39:101113. PMID 32379652. doi:10.1016/j.ctcp.2020.101113. https://pubmed.ncbi.nlm.nih.gov/32379652/
89. Xie W, Su F, Wang G, et al. Glucose-lowering effect of berberine on type 2 diabetes: A systematic review and meta-analysis. *Frontiers in pharmacology* 2022;13:1015045. PMID 36467075. doi:10.3389/fphar.2022.1015045. https://pubmed.ncbi.nlm.nih.gov/36467075/
90. Hadi A, Pourmasoumi M, Najafgholizadeh A, et al. The effect of apple cider vinegar on lipid profiles and glycemic parameters: a systematic review and meta-analysis of randomized clinical trials. *BMC complementary medicine and therapies* 2021;21(1):179. PMID 34187442. doi:10.1186/s12906-021-03351-w. https://pubmed.ncbi.nlm.nih.gov/34187442/
91. Kondo T, Kishi M, Fushimi T, et al. Vinegar intake reduces body weight, body fat mass, and serum triglyceride levels in obese Japanese subjects. *Bioscience, biotechnology, and biochemistry* 2009;73(8):1837-1843. PMID 19661687. doi:10.1271/bbb.90231. https://pubmed.ncbi.nlm.nih.gov/19661687/
92. Perna S, Ilyas Z, Giacosa A, et al. Is Probiotic Supplementation Useful for the Management of Body Weight and Other Anthropometric Measures in Adults Affected by Overweight and Obesity with Metabolic Related Diseases? A Systematic Review and Meta-Analysis. *Nutrients* 2021;13(2):666. PMID 33669580. doi:10.3390/nu13020666. https://pubmed.ncbi.nlm.nih.gov/33669580/
93. Prokopidis K, Moriarty F, Bahat G, et al. The Effect of Nicotinamide Mononucleotide and Riboside on Skeletal Muscle Mass and Function: A Systematic Review and Meta-Analysis. *Journal of cachexia, sarcopenia and muscle* 2025;16(3):e13799. PMID 40275690. doi:10.1002/jcsm.13799. https://pubmed.ncbi.nlm.nih.gov/40275690/
94. Chen F, Zhou D, Kong AP, et al. Effects of Nicotinamide Mononucleotide on Glucose and Lipid Metabolism in Adults: A Systematic Review and Meta-analysis of Randomised Controlled Trials. *Current diabetes reports* 2024;25(1):4. PMID 39531138. doi:10.1007/s11892-024-01557-z. https://pubmed.ncbi.nlm.nih.gov/39531138/
95. Yoshino M, Yoshino J, Kayser BD, et al. Nicotinamide mononucleotide increases muscle insulin sensitivity in prediabetic women. *Science (New York, N.Y.)* 2021;372(6547):1224-1229. PMID 33888596. doi:10.1126/science.abe9985. https://pubmed.ncbi.nlm.nih.gov/33888596/
96. Liu K, Zhou R, Wang B, et al. Effect of resveratrol on glucose control and insulin sensitivity: a meta-analysis of 11 randomized controlled trials. *The American journal of clinical nutrition* 2014;99(6):1510-1519. PMID 24695890. doi:10.3945/ajcn.113.082024. https://pubmed.ncbi.nlm.nih.gov/24695890/
97. Gliemann L, Schmidt JF, Olesen J, et al. Resveratrol blunts the positive effects of exercise training on cardiovascular health in aged men. *The Journal of physiology* 2013;591(20):5047-5059. PMID 23878368. doi:10.1113/jphysiol.2013.258061. https://pubmed.ncbi.nlm.nih.gov/23878368/
98. Schwarz C, Benson GS, Horn N, et al. Effects of Spermidine Supplementation on Cognition and Biomarkers in Older Adults With Subjective Cognitive Decline: A Randomized Clinical Trial. *JAMA network open* 2022;5(5):e2213875. PMID 35616942. doi:10.1001/jamanetworkopen.2022.13875. https://pubmed.ncbi.nlm.nih.gov/35616942/
99. Sun C, Yang A, Teng F, et al. Efficacy of collagen peptide supplementation on bone and muscle health: a meta-analysis. *Frontiers in nutrition* 2025;12:1646090. PMID 41049371. doi:10.3389/fnut.2025.1646090. https://pubmed.ncbi.nlm.nih.gov/41049371/
100. de Miranda RB, Weimer P, Rossi RC. Effects of hydrolyzed collagen supplementation on skin aging: a systematic review and meta-analysis. *International journal of dermatology* 2021;60(12):1449-1461. PMID 33742704. doi:10.1111/ijd.15518. https://pubmed.ncbi.nlm.nih.gov/33742704/
101. Akhgarjand C, Asoudeh F, Bagheri A, et al. Does Ashwagandha supplementation have a beneficial effect on the management of anxiety and stress? A systematic review and meta-analysis of randomized controlled trials. *Phytotherapy research : PTR* 2022;36(11):4115-4124. PMID 36017529. doi:10.1002/ptr.7598. https://pubmed.ncbi.nlm.nih.gov/36017529/
102. Bonilla DA, Moreno Y, Gho C, et al. Effects of Ashwagandha (Withania somnifera) on Physical Performance: Systematic Review and Bayesian Meta-Analysis. *Journal of functional morphology and kinesiology* 2021;6(1):20. PMID 33670194. doi:10.3390/jfmk6010020. https://pubmed.ncbi.nlm.nih.gov/33670194/
103. Björnsson HK, Björnsson ES, Avula B, et al. Ashwagandha-induced liver injury: A case series from Iceland and the US Drug-Induced Liver Injury Network. *Liver international : official journal of the International Association for the Study of the Liver* 2020;40(4):825-829. PMID 31991029. doi:10.1111/liv.14393. https://pubmed.ncbi.nlm.nih.gov/31991029/
104. Bessell E, Maunder A, Lauche R, et al. Efficacy of dietary supplements containing isolated organic compounds for weight loss: a systematic review and meta-analysis of randomised placebo-controlled trials. *International journal of obesity (2005)* 2021;45(8):1631-1643. PMID 33976376. doi:10.1038/s41366-021-00839-w. https://pubmed.ncbi.nlm.nih.gov/33976376/
105. Batsis JA, Apolzan JW, Bagley PJ, et al. A Systematic Review of Dietary Supplements and Alternative Therapies for Weight Loss. *Obesity (Silver Spring, Md.)* 2021;29(7):1102-1113. PMID 34159755. doi:10.1002/oby.23110. https://pubmed.ncbi.nlm.nih.gov/34159755/
106. Onakpoya I, Hung SK, Perry R, et al. The Use of Garcinia Extract (Hydroxycitric Acid) as a Weight loss Supplement: A Systematic Review and Meta-Analysis of Randomised Clinical Trials. *Journal of obesity* 2011;2011:509038. PMID 21197150. doi:10.1155/2011/509038. https://pubmed.ncbi.nlm.nih.gov/21197150/
107. Pooyandjoo M, Nouhi M, Shab-Bidar S, et al. The effect of (L-)carnitine on weight loss in adults: a systematic review and meta-analysis of randomized controlled trials. *Obesity reviews : an official journal of the International Association for the Study of Obesity* 2016;17(10):970-976. PMID 27335245. doi:10.1111/obr.12436. https://pubmed.ncbi.nlm.nih.gov/27335245/
108. Jakubowski JS, Nunes EA, Teixeira FJ, et al. Supplementation with the Leucine Metabolite β-hydroxy-β-methylbutyrate (HMB) does not Improve Resistance Exercise-Induced Changes in Body Composition or Strength in Young Subjects: A Systematic Review and Meta-Analysis. *Nutrients* 2020;12(5):E1523. PMID 32456217. doi:10.3390/nu12051523. https://pubmed.ncbi.nlm.nih.gov/32456217/
109. Morton RW, Murphy KT, McKellar SR, et al. A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. *British journal of sports medicine* 2018;52(6):376-384. PMID 28698222. doi:10.1136/bjsports-2017-097608. https://pubmed.ncbi.nlm.nih.gov/28698222/
110. Paulsen G, Cumming KT, Holden G, et al. Vitamin C and E supplementation hampers cellular adaptation to endurance training in humans: a double-blind, randomised, controlled trial. *The Journal of physiology* 2014;592(8):1887-1901. PMID 24492839. doi:10.1113/jphysiol.2013.267419. https://pubmed.ncbi.nlm.nih.gov/24492839/
111. Jovanovski E, Yashpal S, Komishon A, et al. Effect of psyllium (Plantago ovata) fiber on LDL cholesterol and alternative lipid targets, non-HDL cholesterol and apolipoprotein B: a systematic review and meta-analysis of randomized controlled trials. *The American journal of clinical nutrition* 2018;108(5):922-932. PMID 30239559. doi:10.1093/ajcn/nqy115. https://pubmed.ncbi.nlm.nih.gov/30239559/
112. Gibb RD, McRorie JW, Russell DA, et al. Psyllium fiber improves glycemic control proportional to loss of glycemic control: a meta-analysis of data in euglycemic subjects, patients at risk of type 2 diabetes mellitus, and patients being treated for type 2 diabetes mellitus. *The American journal of clinical nutrition* 2015;102(6):1604-1614. PMID 26561625. doi:10.3945/ajcn.115.106989. https://pubmed.ncbi.nlm.nih.gov/26561625/
113. Whitehead A, Beck EJ, Tosh S, et al. Cholesterol-lowering effects of oat β-glucan: a meta-analysis of randomized controlled trials. *The American journal of clinical nutrition* 2014;100(6):1413-1421. PMID 25411276. doi:10.3945/ajcn.114.086108. https://pubmed.ncbi.nlm.nih.gov/25411276/
114. Jovanovski E, Mazhar N, Komishon A, et al. Can dietary viscous fiber affect body weight independently of an energy-restrictive diet? A systematic review and meta-analysis of randomized controlled trials. *The American journal of clinical nutrition* 2020;111(2):471-485. PMID 31897475. doi:10.1093/ajcn/nqz292. https://pubmed.ncbi.nlm.nih.gov/31897475/
115. Thompson SV, Hannon BA, An R, et al. Effects of isolated soluble fiber supplementation on body weight, glycemia, and insulinemia in adults with overweight and obesity: a systematic review and meta-analysis of randomized controlled trials. *The American journal of clinical nutrition* 2017;106(6):1514-1528. PMID 29092878. doi:10.3945/ajcn.117.163246. https://pubmed.ncbi.nlm.nih.gov/29092878/
116. Sood N, Baker WL, Coleman CI. Effect of glucomannan on plasma lipid and glucose concentrations, body weight, and blood pressure: systematic review and meta-analysis. *The American journal of clinical nutrition* 2008;88(4):1167-1175. PMID 18842808. doi:10.1093/ajcn/88.4.1167. https://pubmed.ncbi.nlm.nih.gov/18842808/
117. Reis CEG, Loureiro LMR, Roschel H, et al. Effects of pre-sleep protein consumption on muscle-related outcomes - A systematic review. *Journal of science and medicine in sport* 2021;24(2):177-182. PMID 32811763. doi:10.1016/j.jsams.2020.07.016. https://pubmed.ncbi.nlm.nih.gov/32811763/
118. Mamerow MM, Mettler JA, English KL, et al. Dietary protein distribution positively influences 24-h muscle protein synthesis in healthy adults. *The Journal of nutrition* 2014;144(6):876-880. PMID 24477298. doi:10.3945/jn.113.185280. https://pubmed.ncbi.nlm.nih.gov/24477298/
119. Justesen TEH, Jespersen SE, Tagmose Thomsen T, et al. Comparing Even with Skewed Dietary Protein Distribution Shows No Difference in Muscle Protein Synthesis or Amino Acid Utilization in Healthy Older Individuals: A Randomized Controlled Trial. *Nutrients* 2022;14(21):4442. PMID 36364705. doi:10.3390/nu14214442. https://pubmed.ncbi.nlm.nih.gov/36364705/
120. Jespersen SE, Agergaard J. Evenness of dietary protein distribution is associated with higher muscle mass but not muscle strength or protein turnover in healthy adults: a systematic review. *European journal of nutrition* 2021;60(6):3185-3202. PMID 33550490. doi:10.1007/s00394-021-02487-2. https://pubmed.ncbi.nlm.nih.gov/33550490/
121. Schoenfeld BJ, Aragon AA, Krieger JW. The effect of protein timing on muscle strength and hypertrophy: a meta-analysis. *Journal of the International Society of Sports Nutrition* 2013;10(1):53. PMID 24299050. doi:10.1186/1550-2783-10-53. https://pubmed.ncbi.nlm.nih.gov/24299050/
122. Shukla AP, Dickison M, Coughlin N, et al. The impact of food order on postprandial glycaemic excursions in prediabetes. *Diabetes, obesity & metabolism* 2019;21(2):377-381. PMID 30101510. doi:10.1111/dom.13503. https://pubmed.ncbi.nlm.nih.gov/30101510/
123. Sofer S, Eliraz A, Kaplan S, et al. Greater weight loss and hormonal changes after 6 months diet with carbohydrates eaten mostly at dinner. *Obesity (Silver Spring, Md.)* 2011;19(10):2006-2014. PMID 21475137. doi:10.1038/oby.2011.48. https://pubmed.ncbi.nlm.nih.gov/21475137/
124. Klos B, Cook J, Crepaz L, et al. Impact of energy density on energy intake in children and adults: a systematic review and meta-analysis of randomized controlled trials. *European journal of nutrition* 2023;62(3):1059-1076. PMID 36460778. doi:10.1007/s00394-022-03054-z. https://pubmed.ncbi.nlm.nih.gov/36460778/
125. Robinson E, Khuttan M, McFarland-Lesser I, et al. Calorie reformulation: a systematic review and meta-analysis examining the effect of manipulating food energy density on daily energy intake. *The international journal of behavioral nutrition and physical activity* 2022;19(1):48. PMID 35459185. doi:10.1186/s12966-022-01287-z. https://pubmed.ncbi.nlm.nih.gov/35459185/
126. DiMeglio DP, Mattes RD. Liquid versus solid carbohydrate: effects on food intake and body weight. *International journal of obesity and related metabolic disorders : journal of the International Association for the Study of Obesity* 2000;24(6):794-800. PMID 10878689. doi:10.1038/sj.ijo.0801229. https://pubmed.ncbi.nlm.nih.gov/10878689/
127. McGlynn ND, Khan TA, Wang L, et al. Association of Low- and No-Calorie Sweetened Beverages as a Replacement for Sugar-Sweetened Beverages With Body Weight and Cardiometabolic Risk: A Systematic Review and Meta-analysis. *JAMA network open* 2022;5(3):e222092. PMID 35285920. doi:10.1001/jamanetworkopen.2022.2092. https://pubmed.ncbi.nlm.nih.gov/35285920/
128. Min J, Kim SY, Shin IS, et al. The Effect of Meal Replacement on Weight Loss According to Calorie-Restriction Type and Proportion of Energy Intake: A Systematic Review and Meta-Analysis of Randomized Controlled Trials. *Journal of the Academy of Nutrition and Dietetics* 2021;121(8):1551-1564.e3. PMID 34144920. doi:10.1016/j.jand.2021.05.001. https://pubmed.ncbi.nlm.nih.gov/34144920/
129. Dennis EA, Dengo AL, Comber DL, et al. Water consumption increases weight loss during a hypocaloric diet intervention in middle-aged and older adults. *Obesity (Silver Spring, Md.)* 2010;18(2):300-307. PMID 19661958. doi:10.1038/oby.2009.235. https://pubmed.ncbi.nlm.nih.gov/19661958/
130. Parretti HM, Aveyard P, Blannin A, et al. Efficacy of water preloading before main meals as a strategy for weight loss in primary care patients with obesity: RCT. *Obesity (Silver Spring, Md.)* 2015;23(9):1785-1791. PMID 26237305. doi:10.1002/oby.21167. https://pubmed.ncbi.nlm.nih.gov/26237305/
131. Robinson E, Almiron-Roig E, Rutters F, et al. A systematic review and meta-analysis examining the effect of eating rate on energy intake and hunger. *The American journal of clinical nutrition* 2014;100(1):123-151. PMID 24847856. doi:10.3945/ajcn.113.081745. https://pubmed.ncbi.nlm.nih.gov/24847856/
132. Ohkuma T, Hirakawa Y, Nakamura U, et al. Association between eating rate and obesity: a systematic review and meta-analysis. *International journal of obesity (2005)* 2015;39(11):1589-1596. PMID 26100137. doi:10.1038/ijo.2015.96. https://pubmed.ncbi.nlm.nih.gov/26100137/
133. Leidy HJ, Ortinau LC, Douglas SM, et al. Beneficial effects of a higher-protein breakfast on the appetitive, hormonal, and neural signals controlling energy intake regulation in overweight/obese, "breakfast-skipping," late-adolescent girls. *The American journal of clinical nutrition* 2013;97(4):677-688. PMID 23446906. doi:10.3945/ajcn.112.053116. https://pubmed.ncbi.nlm.nih.gov/23446906/
134. Vujović N, Piron MJ, Qian J, et al. Late isocaloric eating increases hunger, decreases energy expenditure, and modifies metabolic pathways in adults with overweight and obesity. *Cell metabolism* 2022;34(10):1486-1498.e7. PMID 36198293. doi:10.1016/j.cmet.2022.09.007. https://pubmed.ncbi.nlm.nih.gov/36198293/
135. Rolls BJ, Bell EA, Thorwart ML. Water incorporated into a food but not served with a food decreases energy intake in lean women. *The American journal of clinical nutrition* 1999;70(4):448-455. PMID 10500012. doi:10.1093/ajcn/70.4.448. https://pubmed.ncbi.nlm.nih.gov/10500012/
136. Wicherski J, Schlesinger S, Fischer F. Association between Breakfast Skipping and Body Weight-A Systematic Review and Meta-Analysis of Observational Longitudinal Studies. *Nutrients* 2021;13(1):272. PMID 33477881. doi:10.3390/nu13010272. https://pubmed.ncbi.nlm.nih.gov/33477881/
137. Hollands GJ, Shemilt I, Marteau TM, et al. Portion, package or tableware size for changing selection and consumption of food, alcohol and tobacco. *The Cochrane database of systematic reviews* 2015(9):CD011045. PMID 26368271. doi:10.1002/14651858.cd011045.pub2. https://pubmed.ncbi.nlm.nih.gov/26368271/
138. Hall KD, Ayuketah A, Brychta R, et al. Ultra-Processed Diets Cause Excess Calorie Intake and Weight Gain: An Inpatient Randomized Controlled Trial of Ad Libitum Food Intake. *Cell metabolism* 2019;30(1):67-77.e3. PMID 31105044. doi:10.1016/j.cmet.2019.05.008. https://pubmed.ncbi.nlm.nih.gov/31105044/
139. Madigan CD, Daley AJ, Lewis AL, et al. Is self-weighing an effective tool for weight loss: a systematic literature review and meta-analysis. *The international journal of behavioral nutrition and physical activity* 2015;12:104. PMID 26293454. doi:10.1186/s12966-015-0267-4. https://pubmed.ncbi.nlm.nih.gov/26293454/
140. Benn Y, Webb TL, Chang BP, et al. What is the psychological impact of self-weighing? A meta-analysis. *Health psychology review* 2016;10(2):187-203. PMID 26742706. doi:10.1080/17437199.2016.1138871. https://pubmed.ncbi.nlm.nih.gov/26742706/
141. Hollis JF, Gullion CM, Stevens VJ, et al. Weight loss during the intensive intervention phase of the weight-loss maintenance trial. *American journal of preventive medicine* 2008;35(2):118-126. PMID 18617080. doi:10.1016/j.amepre.2008.04.013. https://pubmed.ncbi.nlm.nih.gov/18617080/
142. Berry R, Kassavou A, Sutton S. Does self-monitoring diet and physical activity behaviors using digital technology support adults with obesity or overweight to lose weight? A systematic literature review with meta-analysis. *Obesity reviews : an official journal of the International Association for the Study of Obesity* 2021;22(10):e13306. PMID 34192411. doi:10.1111/obr.13306. https://pubmed.ncbi.nlm.nih.gov/34192411/
143. Burke LE, Wang J, Sevick MA. Self-monitoring in weight loss: a systematic review of the literature. *Journal of the American Dietetic Association* 2011;111(1):92-102. PMID 21185970. doi:10.1016/j.jada.2010.10.008. https://pubmed.ncbi.nlm.nih.gov/21185970/
144. Westenhoefer J, Stunkard AJ, Pudel V. Validation of the flexible and rigid control dimensions of dietary restraint. *The International journal of eating disorders* 1999;26(1):53-64. PMID 10349584. doi:10.1002/(sici)1098-108x(199907)26:1<53::aid-eat7>3.0.co;2-n. https://pubmed.ncbi.nlm.nih.gov/10349584/
145. Carrière K, Khoury B, Günak MM, et al. Mindfulness-based interventions for weight loss: a systematic review and meta-analysis. *Obesity reviews : an official journal of the International Association for the Study of Obesity* 2018;19(2):164-177. PMID 29076610. doi:10.1111/obr.12623. https://pubmed.ncbi.nlm.nih.gov/29076610/
146. Jensen MT, Nielsen SS, Jessen-Winge C, et al. The effectiveness of social-support-based weight-loss interventions-a systematic review and meta-analysis. *International journal of obesity (2005)* 2024;48(5):599-611. PMID 38332127. doi:10.1038/s41366-024-01468-9. https://pubmed.ncbi.nlm.nih.gov/38332127/
147. Gong Y, Trentadue TP, Shrestha S, et al. Financial incentives for objectively-measured physical activity or weight loss in adults with chronic health conditions: A meta-analysis. *PloS one* 2018;13(9):e0203939. PMID 30252864. doi:10.1371/journal.pone.0203939. https://pubmed.ncbi.nlm.nih.gov/30252864/
148. Hondmann SM, van Vliet MHM, van Eersel RA, et al. Enhancing Weight Loss Programs: A Meta-Analysis of Financial Incentives and Behavior Change Techniques. *Obesity reviews : an official journal of the International Association for the Study of Obesity* 2026;27(10):e70124. PMID 41846433. doi:10.1111/obr.70124. https://pubmed.ncbi.nlm.nih.gov/41846433/
149. Wei M, Brandhorst S, Shelehchi M, et al. Fasting-mimicking diet and markers/risk factors for aging, diabetes, cancer, and cardiovascular disease. *Science translational medicine* 2017;9(377):eaai8700. PMID 28202779. doi:10.1126/scitranslmed.aai8700. https://pubmed.ncbi.nlm.nih.gov/28202779/
150. Jahrami HA, Alsibai J, Clark CCT, et al. A systematic review, meta-analysis, and meta-regression of the impact of diurnal intermittent fasting during Ramadan on body weight in healthy subjects aged 16 years and above. *European journal of nutrition* 2020;59(6):2291-2316. PMID 32157368. doi:10.1007/s00394-020-02216-1. https://pubmed.ncbi.nlm.nih.gov/32157368/
151. Fernando HA, Zibellini J, Harris RA, et al. Effect of Ramadan Fasting on Weight and Body Composition in Healthy Non-Athlete Adults: A Systematic Review and Meta-Analysis. *Nutrients* 2019;11(2):E478. PMID 30813495. doi:10.3390/nu11020478. https://pubmed.ncbi.nlm.nih.gov/30813495/
152. Kul S, Savaş E, Öztürk ZA, et al. Does Ramadan fasting alter body weight and blood lipids and fasting blood glucose in a healthy population? A meta-analysis. *Journal of religion and health* 2014;53(3):929-942. PMID 23423818. doi:10.1007/s10943-013-9687-0. https://pubmed.ncbi.nlm.nih.gov/23423818/
153. Stote KS, Baer DJ, Spears K, et al. A controlled trial of reduced meal frequency without caloric restriction in healthy, normal-weight, middle-aged adults. *The American journal of clinical nutrition* 2007;85(4):981-988. PMID 17413096. doi:10.1093/ajcn/85.4.981. https://pubmed.ncbi.nlm.nih.gov/17413096/
154. Trepanowski JF, Kroeger CM, Barnosky A, et al. Effect of Alternate-Day Fasting on Weight Loss, Weight Maintenance, and Cardioprotection Among Metabolically Healthy Obese Adults: A Randomized Clinical Trial. *JAMA internal medicine* 2017;177(7):930-938. PMID 28459931. doi:10.1001/jamainternmed.2017.0936. https://pubmed.ncbi.nlm.nih.gov/28459931/
155. Parr EB, Camera DM, Areta JL, et al. Alcohol ingestion impairs maximal post-exercise rates of myofibrillar protein synthesis following a single bout of concurrent training. *PloS one* 2014;9(2):e88384. PMID 24533082. doi:10.1371/journal.pone.0088384. https://pubmed.ncbi.nlm.nih.gov/24533082/
156. Wilding JPH, Batterham RL, Calanna S, et al. Once-Weekly Semaglutide in Adults with Overweight or Obesity. *The New England journal of medicine* 2021;384(11):989-1002. PMID 33567185. doi:10.1056/nejmoa2032183. https://pubmed.ncbi.nlm.nih.gov/33567185/
157. Jastreboff AM, Aronne LJ, Ahmad NN, et al. Tirzepatide Once Weekly for the Treatment of Obesity. *The New England journal of medicine* 2022;387(3):205-216. PMID 35658024. doi:10.1056/nejmoa2206038. https://pubmed.ncbi.nlm.nih.gov/35658024/
158. Jastreboff AM, Kaplan LM, Frías JP, et al. Triple-Hormone-Receptor Agonist Retatrutide for Obesity - A Phase 2 Trial. *The New England journal of medicine* 2023;389(6):514-526. PMID 37366315. doi:10.1056/nejmoa2301972. https://pubmed.ncbi.nlm.nih.gov/37366315/
159. Bikou A, Dermiki-Gkana F, Penteris M, et al. A systematic review of the effect of semaglutide on lean mass: insights from clinical trials. *Expert opinion on pharmacotherapy* 2024;25(5):611-619. PMID 38629387. doi:10.1080/14656566.2024.2343092. https://pubmed.ncbi.nlm.nih.gov/38629387/
160. Knowler WC, Barrett-Connor E, Fowler SE, et al. Reduction in the incidence of type 2 diabetes with lifestyle intervention or metformin. *The New England journal of medicine* 2002;346(6):393-403. PMID 11832527. doi:10.1056/nejmoa012512. https://pubmed.ncbi.nlm.nih.gov/11832527/
161. Diabetes Prevention Program Research Group. Long-term safety, tolerability, and weight loss associated with metformin in the Diabetes Prevention Program Outcomes Study. *Diabetes care* 2012;35(4):731-737. PMID 22442396. doi:10.2337/dc11-1299. https://pubmed.ncbi.nlm.nih.gov/22442396/
162. Torgerson JS, Hauptman J, Boldrin MN, et al. XENical in the prevention of diabetes in obese subjects (XENDOS) study: a randomized study of orlistat as an adjunct to lifestyle changes for the prevention of type 2 diabetes in obese patients. *Diabetes care* 2004;27(1):155-161. PMID 14693982. doi:10.2337/diacare.27.1.155. https://pubmed.ncbi.nlm.nih.gov/14693982/
163. Sjöström L, Narbro K, Sjöström CD, et al. Effects of bariatric surgery on mortality in Swedish obese subjects. *The New England journal of medicine* 2007;357(8):741-752. PMID 17715408. doi:10.1056/nejmoa066254. https://pubmed.ncbi.nlm.nih.gov/17715408/
164. Cai X, Yang W, Gao X, et al. The Association Between the Dosage of SGLT2 Inhibitor and Weight Reduction in Type 2 Diabetes Patients: A Meta-Analysis. *Obesity (Silver Spring, Md.)* 2018;26(1):70-80. PMID 29165885. doi:10.1002/oby.22066. https://pubmed.ncbi.nlm.nih.gov/29165885/
165. Confederat LG, Pînzariu AC, Serban IL, et al. SGLT2 Inhibitors Between Benefits and Euglycemic Ketoacidosis: A Concise Review. *International journal of molecular sciences* 2026;27(12):5224. PMID 42352947. doi:10.3390/ijms27125224. https://pubmed.ncbi.nlm.nih.gov/42352947/
166. Isidori AM, Giannetta E, Greco EA, et al. Effects of testosterone on body composition, bone metabolism and serum lipid profile in middle-aged men: a meta-analysis. *Clinical endocrinology* 2005;63(3):280-293. PMID 16117815. doi:10.1111/j.1365-2265.2005.02339.x. https://pubmed.ncbi.nlm.nih.gov/16117815/
167. Bhasin S, Storer TW, Berman N, et al. The effects of supraphysiologic doses of testosterone on muscle size and strength in normal men. *The New England journal of medicine* 1996;335(1):1-7. PMID 8637535. doi:10.1056/nejm199607043350101. https://pubmed.ncbi.nlm.nih.gov/8637535/
168. Kaptein EM, Beale E, Chan LS. Thyroid hormone therapy for obesity and nonthyroidal illnesses: a systematic review. *The Journal of clinical endocrinology and metabolism* 2009;94(10):3663-3675. PMID 19737920. doi:10.1210/jc.2009-0899. https://pubmed.ncbi.nlm.nih.gov/19737920/
169. Schoenfeld BJ, Aragon AA. How much protein can the body use in a single meal for muscle-building? Implications for daily protein distribution. *Journal of the International Society of Sports Nutrition* 2018;15:10. PMID 29497353. doi:10.1186/s12970-018-0215-1. https://pubmed.ncbi.nlm.nih.gov/29497353/
170. Ma J, Stevens JE, Cukier K, et al. Effects of a protein preload on gastric emptying, glycemia, and gut hormones after a carbohydrate meal in diet-controlled type 2 diabetes. *Diabetes care* 2009;32(9):1600-1602. PMID 19542012. doi:10.2337/dc09-0723. https://pubmed.ncbi.nlm.nih.gov/19542012/
171. King DG, Walker M, Campbell MD, et al. A small dose of whey protein co-ingested with mixed-macronutrient breakfast and lunch meals improves postprandial glycemia and suppresses appetite in men with type 2 diabetes: a randomized controlled trial. *The American journal of clinical nutrition* 2018;107(4):550-557. PMID 29635505. doi:10.1093/ajcn/nqy019. https://pubmed.ncbi.nlm.nih.gov/29635505/
172. López Barrón G, Bacardí Gascón M, De Lira García C, et al. [Meal replacement efficacy on long-term weight loss: a systematic review]. *Nutricion hospitalaria* 2011;26(6):1260-1265. PMID 22411370. doi:10.1590/s0212-16112011000600011. https://pubmed.ncbi.nlm.nih.gov/22411370/
173. Kunutsor SK, Khan H, Laukkanen T, et al. Joint associations of sauna bathing and cardiorespiratory fitness on cardiovascular and all-cause mortality risk: a long-term prospective cohort study. *Annals of medicine* 2018;50(2):139-146. PMID 28972808. doi:10.1080/07853890.2017.1387927. https://pubmed.ncbi.nlm.nih.gov/28972808/
174. Lunsford-Avery JR, Engelhard MM, Navar AM, et al. Validation of the Sleep Regularity Index in Older Adults and Associations with Cardiometabolic Risk. *Scientific reports* 2018;8(1):14158. PMID 30242174. doi:10.1038/s41598-018-32402-5. https://pubmed.ncbi.nlm.nih.gov/30242174/
175. Dos Santos EEP, de Araújo RC, Candow DG, et al. Efficacy of Creatine Supplementation Combined with Resistance Training on Muscle Strength and Muscle Mass in Older Females: A Systematic Review and Meta-Analysis. *Nutrients* 2021;13(11):3757. PMID 34836013. doi:10.3390/nu13113757. https://pubmed.ncbi.nlm.nih.gov/34836013/
176. Irwin C, Khalesi S, Desbrow B, et al. Effects of acute caffeine consumption following sleep loss on cognitive, physical, occupational and driving performance: A systematic review and meta-analysis. *Neuroscience and biobehavioral reviews* 2020;108:877-888. PMID 31837359. doi:10.1016/j.neubiorev.2019.12.008. https://pubmed.ncbi.nlm.nih.gov/31837359/
177. Bird JK, Troesch B, Warnke I, et al. The effect of long chain omega-3 polyunsaturated fatty acids on muscle mass and function in sarcopenia: A scoping systematic review and meta-analysis. *Clinical nutrition ESPEN* 2021;46:73-86. PMID 34857251. doi:10.1016/j.clnesp.2021.10.011. https://pubmed.ncbi.nlm.nih.gov/34857251/
178. Hoon MW, Johnson NA, Chapman PG, et al. The effect of nitrate supplementation on exercise performance in healthy individuals: a systematic review and meta-analysis. *International journal of sport nutrition and exercise metabolism* 2013;23(5):522-532. PMID 23580439. doi:10.1123/ijsnem.23.5.522. https://pubmed.ncbi.nlm.nih.gov/23580439/
179. Gu J, Wei Y, Huang J, et al. Effects of beta-alanine supplementation on exercise performance and related physiological outcomes in women: a systematic review and meta-analysis. *Frontiers in nutrition* 2026;13:1857513. PMID 42370349. doi:10.3389/fnut.2026.1857513. https://pubmed.ncbi.nlm.nih.gov/42370349/
180. de Camargo JBB, Brigatto FA. Beta-Alanine for Improving Exercise Capacity, Muscle Strength, and Functional Performance of Older Adults: A Systematic Review. *Journal of aging and physical activity* 2025;33(4):399-407. PMID 39724872. doi:10.1123/japa.2024-0118. https://pubmed.ncbi.nlm.nih.gov/39724872/
181. Rhim HC, Kim SJ, Park J, et al. Effect of citrulline on post-exercise rating of perceived exertion, muscle soreness, and blood lactate levels: A systematic review and meta-analysis. *Journal of sport and health science* 2020;9(6):553-561. PMID 33308806. doi:10.1016/j.jshs.2020.02.003. https://pubmed.ncbi.nlm.nih.gov/33308806/
182. Ge X, Sun H, Wu C, et al. Effects of acute or short-term oral sodium bicarbonate supplementation on high-intensity intermittent exercise performance and physiological responses in team-sport athletes: a systematic review and meta-analysis. *Frontiers in nutrition* 2026;13:1936178. PMID 42781544. doi:10.3389/fnut.2026.1936178. https://pubmed.ncbi.nlm.nih.gov/42781544/
183. Marcotte-Chénard A, Tremblay R, Falkenhain K, et al. Effect of Acute and Chronic Ingestion of Exogenous Ketone Supplements on Blood Pressure: A Systematic Review and Meta-Analysis. *Journal of dietary supplements* 2024;21(3):408-426. PMID 38145410. doi:10.1080/19390211.2023.2289961. https://pubmed.ncbi.nlm.nih.gov/38145410/
184. Bonnechère B, Stephens EB, Boileau AC, et al. The effect of exogenous ketone bodies on cognition across health and disease: a systematic review and meta-analysis. *Frontiers in nutrition* 2026;13:1802531. PMID 42063954. doi:10.3389/fnut.2026.1802531. https://pubmed.ncbi.nlm.nih.gov/42063954/
185. Gholami F, Antonio J, Iranpour M, et al. Does green tea catechin enhance weight-loss effect of exercise training in overweight and obese individuals? a systematic review and meta-analysis of randomized trials. *Journal of the International Society of Sports Nutrition* 2024;21(1):2411029. PMID 39350601. doi:10.1080/15502783.2024.2411029. https://pubmed.ncbi.nlm.nih.gov/39350601/
186. Launholt TL, Kristiansen CB, Hjorth P. Safety and side effects of apple vinegar intake and its effect on metabolic parameters and body weight: a systematic review. *European journal of nutrition* 2020;59(6):2273-2289. PMID 32170375. doi:10.1007/s00394-020-02214-3. https://pubmed.ncbi.nlm.nih.gov/32170375/
187. Liu S, Ouyang K, Fang X, et al. Efficacy of probiotic supplementation for body weight management in overweight and obese adults: a meta-analysis of randomized controlled trials predominantly from East Asia. *Frontiers in public health* 2026;14:1767108. PMID 41938967. doi:10.3389/fpubh.2026.1767108. https://pubmed.ncbi.nlm.nih.gov/41938967/
188. Wirth M, Benson G, Schwarz C, et al. The effect of spermidine on memory performance in older adults at risk for dementia: A randomized controlled trial. *Cortex; a journal devoted to the study of the nervous system and behavior* 2018;109:181-188. PMID 30388439. doi:10.1016/j.cortex.2018.09.014. https://pubmed.ncbi.nlm.nih.gov/30388439/
189. Pu SY, Huang YL, Pu CM, et al. Effects of Oral Collagen for Skin Anti-Aging: A Systematic Review and Meta-Analysis. *Nutrients* 2023;15(9):2080. PMID 37432180. doi:10.3390/nu15092080. https://pubmed.ncbi.nlm.nih.gov/37432180/
190. García-Alonso A, Sánchez-González JL, Navarro-López V, et al. The Role of HMB Supplementation in Enhancing the Effects of Resistance Training in Older Adults: A Systematic Review and Meta-Analysis on Muscle Quality, Body Composition, and Physical Function. *Nutrients* 2025;17(22):3624. PMID 41305674. doi:10.3390/nu17223624. https://pubmed.ncbi.nlm.nih.gov/41305674/
191. Rahimi MH, Shab-Bidar S, Mollahosseini M, et al. Branched-chain amino acid supplementation and exercise-induced muscle damage in exercise recovery: A meta-analysis of randomized clinical trials. *Nutrition (Burbank, Los Angeles County, Calif.)* 2017;42:30-36. PMID 28870476. doi:10.1016/j.nut.2017.05.005. https://pubmed.ncbi.nlm.nih.gov/28870476/
192. Ruffault A, Czernichow S, Hagger MS, et al. The effects of mindfulness training on weight-loss and health-related behaviours in adults with overweight and obesity: A systematic review and meta-analysis. *Obesity research & clinical practice* 2017;11(5 Suppl 1):90-111. PMID 27658995. doi:10.1016/j.orcp.2016.09.002. https://pubmed.ncbi.nlm.nih.gov/27658995/
193. Livhits M, Mercado C, Yermilov I, et al. Is social support associated with greater weight loss after bariatric surgery?: a systematic review. *Obesity reviews : an official journal of the International Association for the Study of Obesity* 2011;12(2):142-148. PMID 20158617. doi:10.1111/j.1467-789x.2010.00720.x. https://pubmed.ncbi.nlm.nih.gov/20158617/
194. Romu T, Vavruch C, Dahlqvist-Leinhard O, et al. A randomized trial of cold-exposure on energy expenditure and supraclavicular brown adipose tissue volume in humans. *Metabolism: clinical and experimental* 2016;65(6):926-934. PMID 27173471. doi:10.1016/j.metabol.2016.03.012. https://pubmed.ncbi.nlm.nih.gov/27173471/
195. Huo C, Song Z, Yin J, et al. Effect of Acute Cold Exposure on Energy Metabolism and Activity of Brown Adipose Tissue in Humans: A Systematic Review and Meta-Analysis. *Frontiers in physiology* 2022;13:917084. PMID 35837014. doi:10.3389/fphys.2022.917084. https://pubmed.ncbi.nlm.nih.gov/35837014/

### Null-result search log (supports the `REJECT` entries; Europe PMC, 2026-09-30)

- Title search "carb backloading" / "carb back-loading" / "carbohydrate back-loading": 0 records (A4).
- Title search "protein cycling" / "protein-cycling": 4 records, all yeast/receptor/G-protein biology, none human dietary (§4B).
- Title searches for weekend/consistency dieting vs weight change: 0 records; no meal-prepping RCT/meta-analysis located (G3).
- Cold-exposure RCTs on adiposity: only [41] (fat −0.70 kg, n = 11) and [194] (BAT volume, MR; no fat outcome) located; no replication of the fat-loss result (D3).
- UPDATE trial (ultra-processed vs minimally processed, 8-wk UK crossover): results paper not located, only the protocol; Hall 2019 [138] is the sole verified RCT (G5).
