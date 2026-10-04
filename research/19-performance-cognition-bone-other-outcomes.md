# 19 — Performance, cognition/mood, bone, immune, skin and other outcomes (+ master outcome-metric list)

Status: research dossier for the Vitals simulation engine. Author: research agent #19. Date of literature work: 2026-09-30.
Evidence was retrieved from PubMed (E-utilities), Europe PMC, PMC full texts and journal pages. Every number below has a source in
section 11 (`[n]`). `UNVERIFIED` = could not be confirmed against a source I actually opened. `PROPOSED FIT` = my own functional form fitted to the
data points listed next to it (not a published equation). Grades A-D follow `RESEARCH_PROTOCOL.md`.

---------------------------------------------------------------------------------------------------------------------------------

## 1. Scope

This dossier covers the "everything else" outcomes that diet, meal timing and exercise move over a 1-6 month horizon and that are *not* owned by
another dossier (fat/lean mass 01/03/09/14, glycogen 04, ketosis 05, lipids/BP/glycaemia 06, autophagy/IGF-1 08, VO2max 10, hormones/hunger 12,
sleep/menopause 16, safety limits 17). For each candidate outcome it gives drivers -> mechanism -> quantitative relationship -> time course ->
evidence grade -> **verdict** (numeric model / qualitative flag / do not model).
It also **explicitly rejects** outcomes that are not defensible as numeric predictions, and ends (section 6) with the **master candidate list of
outcome metrics for the whole app** (56 candidates, recommended "core 30").

Headline conclusions (details and sources in sections 4-8):
1. *Energy availability* (EA = (intake − exercise expenditure)/FFM) is the single best-supported driver for bone turnover, menstrual disturbance,
   strength/power decrement, illness and mood in lean, active people. Threshold ~30 kcal/kg FFM/day; bone formation is suppressed within 3-5 days already
   at EA 15-30 [16][17][18][20]. It is a poor driver in people with high adiposity (see open question O1).
2. *Strength is not lean mass*: in trained/untrained people doing resistance training (RT) in a moderate deficit, strength gains are preserved
   (ES 0.84 vs 0.81) while lean-mass gains are lost at ~500 kcal/day deficit [27]. Real strength/power losses (−16 to −29 %) appear only with severe, prolonged
   deficits in lean people (Ranger course, contest prep) [30][31][32].
3. *Endurance*: muscle glycogen sets time-to-exhaustion at ~75 % VO2max (TTE ≈ 36.8 + 41.6 × glycogen[g/100 g wet muscle] min, r = 0.92) [46]; a ketogenic
   low-CHO pattern raises O2 cost by ~5-8 % at race-relevant intensities and cancelled the training benefit in elite athletes [49][50]; the economy penalty is
   intensity-gated (absent ≤60 % VO2max) [53].
4. *Bone*: diet-induced weight loss costs ~1-2 % hip BMD per ~10 % body-weight loss in young/middle-aged adults (2-4 % in older/postmenopausal), mainly hip not spine,
   visible from ~6 months; exercise (esp. exercise-induced loss) and calcium attenuate it; obese premenopausal women may not lose bone at all [1][3][4][5][8].
5. *Mood/cognition*: moderate deficits in overweight/non-lean people **improve** mood (CALERIE-2 ES 0.35) [71]; ketosis gives **no cognitive advantage** and a transient
   induction penalty (days 2-28); severe deficits in lean people **worsen** mood (contest prep TMD 6 -> 43) [31]. Model as tiered flags, not a cognition score.
6. *Do not model as numbers*: mortality/longevity from macronutrient pattern, cognition scores, dental caries, exercise enjoyment, "detox", hair/nail quality, acne
   count, infection incidence. Model as flags or not at all (verdict table below).

### 1.1 Verdict table for the 18 candidate outcomes

| # | Candidate | Verdict | Grade | Main engine drivers |
|---|-----------|---------|-------|---------------------|
| 1 | Strength / power / training capacity | **Numeric multiplier** on dossier 09 strength: EA-penalty (slow) + acute glycogen/hydration modifiers (flag-level) | B (moderate deficit: no loss), C (severe/lean: −15-30 %) | EA, leanness, RT dose, protein, deficit duration |
| 2 | Endurance performance | **Numeric**: glycogen-limited TTE (A/B); LCHF economy penalty (B); body-mass/P:W (A physics); iron & hydration = flags | A/B | glycogen, fat-adaptation state, relative intensity, body mass, in-session CHO |
| 3 | Subjective energy, mood, cognition | **Qualitative tiered flag** + keto-induction symptom window; **do not model cognition score** | C | EA, deficit rate, leanness, carbohydrate step-change, sleep |
| 4 | Bone | **Numeric**: BMD %, turnover indices (formation/resorption) | B (mean effect A: 2 meta-analyses) ; C (moderators) | EA_s, cumulative weight loss, age/menopause, RT, Ca, protein |
| 5 | Immune / illness | **Flag** (LEA-linked); no incidence model | C | EA_c, deficit duration, training load |
| 6 | GI comfort | **Flags** (fibre ramp rate, sugar alcohol/MCT dose; dossier 15 owns thresholds) | C | fibre Δ, polyols, MCT, stool-relevant fibre level |
| 7 | Skin / hair / nails | Hair-shedding **delayed flag** (C); acne **glycaemic-load flag** (B−); nails/skin colour **do not model** | C | weight-loss rate, protein, VLED; GL |
| 8 | Sleep quality (as outcome) | **Modifier/flag only**; numeric owned by 16 | C | weight loss ≥5 %, carbohydrate/fibre/sat-fat, caffeine, meal-to-bed time |
| 9 | Libido / menstrual regularity | Menstrual disturbance **numeric risk** (B); libido **flag** (C) | B / C | average energy deficit %, EA_c |
| 10 | Body temperature / cold intolerance | Derived tiny ΔT_core (−0.2 °C) or **flag** | C | T3 (dossier 12/02), energy deficit duration |
| 11 | Resting HR / HRV | **Numeric derived** (RHR B/C; HRV C) | B/C | fitness, deficit, carbohydrate step, weight loss |
| 12 | Breath acetone / odour | Acetone = **derived proxy of BHB** (C); odour **flag** (D) | C | BHB (dossier 05) |
| 13 | Hydration / cramps / orthostatic | **Flag** (numeric water/sodium in 15) | C | natriuresis days 1-4, water deficit |
| 14 | Oxidative stress / inflammation / bio-age clocks | **Note only** (06/08); DunedinPACE optional display | B/D | see 08 |
| 15 | Dental, GERD, gout, kidney stone, gallstone | Dental: **do not model**; GERD: **flag** from dinner-to-bed time; gout/stone: **flags**; gallstone: **flag** (17 owns) | C | sugar, meal timing, ketosis/fasting, acid load, fluid, loss rate |
| 16 | Longevity / mortality from macros | **Do not model as numeric** | D/C (observational) | — |
| 17 | Diet fatigue / binge risk / body image | **Flag + adherence coupling** to dossier 12 | C | restriction depth/duration, rigidity, breaks |
| 18 | Cravings, taste adaptation, exercise enjoyment | Palate adaptation = **qualitative text**; cravings **flag**; enjoyment **do not model** | C/B− | restricted food class, months |

---------------------------------------------------------------------------------------------------------------------------------

## 2. State variables

All rates are per simulated day unless stated. "From 0x" means the value is supplied by another dossier's engine module.

| Name | Unit | Typical range | Represents | Initial-value rule |
|------|------|---------------|------------|--------------------|
| `EA` | kcal·kgFFM⁻¹·d⁻¹ | −5…70 | Daily energy availability = (energy intake − exercise energy expenditure, EEE) / FFM. EEE = *exercise only* (not RMR/NEAT) [16][20] | computed each day from intake (schedule), EEE (10), FFM (01/14) |
| `EA_s` | same | −5…70 | EWMA of EA, τ = 3 d; drives fast bone/hormonal indices | = EA(day 0); if user says "weight-stable" assume ≈45 |
| `EA_c` | same | | 14-day trailing mean of EA; drives chronic penalties/flags | = EA_s(0) |
| `P1NP_rel` | ratio | 0.75…1.05 | bone-formation index (P1NP/PICP/osteocalcin composite) relative to own baseline | 1.0 |
| `CTX_rel` | ratio | 0.95…1.40 | bone-resorption index (CTX/NTX) relative to baseline | 1.0 |
| `WL_pct` | % | 0…35 | cumulative body-weight loss vs baseline, 14-d smoothed scale weight (from 01, *water/glycogen not removed*) | 0 |
| `dBMD_hip` | % vs baseline | −8…+2 | total-hip areal BMD change | 0 |
| `dBMD_spine` | % vs baseline | −6…+3 | lumbar-spine BMD change | 0 |
| `M_EA` | fraction | 0.70…1.00 | slow multiplier on strength/power capacity from chronic low EA | 1.0 |
| `M_acute` | fraction | 0.85…1.05 | fast multiplier for acute glycogen/hydration/caffeine effects on *volume-tolerance* tasks | 1.0 |
| `A_econ` | 0…1 | 0…1 | running/walking economy penalty state = fat-adaptation state A_fat (from 05) × intensity gate | 0 |
| `KI` | 0…1 | 0…1 | keto-induction symptom load (days since large carbohydrate step-down) | 0 |
| `W_tier` | 0/1/2 | | wellbeing risk tier (green/amber/red), recomputed daily | 0 |
| `MEN` | % | 0…60 | average energy deficit (% of baseline needs) over last 3 cycles (women) | 0 |
| `H_load` | 0…1 | 0…1 | hair-shedding trigger load; shedding risk window opens 60 d after trigger | 0 |
| `RHR_off` | bpm | −15…+5 | resting HR offset from baseline | 0 |
| `HRV_off` | ms (rMSSD) | −25…+15 | nocturnal/waking rMSSD offset | 0 |
| `Tcore_off` | °C | −0.4…0 | core-temperature offset | 0 |
| `Acetone` | ppm (breath) | 0.3…40 | derived from BHB (05); proxy only | ≈1 ppm at BHB 0.2 mmol/L |

---------------------------------------------------------------------------------------------------------------------------------

## 3. Inputs that drive it

| Input | Unit | How it enters |
|-------|------|---------------|
| Energy intake `EI`, exercise expenditure `EEE` | kcal/d | EA (4.1). Deficit % vs baseline needs (MEN, 4.9) |
| FFM, fat mass, body-fat % | kg, % | EA denominator; leanness gate on penalties (O1); FFMI |
| Cumulative weight loss, weekly loss rate | %, %/wk | bone (4.2), hair (4.7), gallstone flag, wellbeing rubric |
| Protein intake | g/kg/d | bone LS-BMD term, hair flag, strength/LBM (03) |
| Net carbohydrate intake and its day-to-day step | g/d | keto-induction window (4.5), LCHF economy (4.4), bone low-CHO term, glycogen (04) |
| Fat-adaptation state `A_fat`, BHB | 0-1, mmol/L | economy penalty, acetone, HRV/RHR keto term |
| Muscle glycogen | g/100 g ww or mmol/kg dw (dossier 04 units) | endurance TTE (4.4), repeated-sprint volume tolerance (4.3) |
| Resistance-training dose (sessions/wk, progressive loading) | sessions | bone attenuation ρ_RT, strength baseline (09) |
| Endurance training, relative intensity of key sessions `I_rel` | % VO2max | economy gate, RHR fitness term |
| Body-water change (acute), sodium/potassium intake | % BM, g | hydration/orthostatic flag (15 supplies numbers) |
| Fibre step change, polyols, MCT dose | g/d/wk | GI flags (15) |
| Calcium, vitamin D intake | g/d, IU/d | bone modifier `mCa` (qualitative) |
| Age, sex, menopausal status, contraceptive use | | bone `mAge`, menstrual model, sex factors |
| Sleep (duration/quality), caffeine | h, mg/kg | wellbeing rubric; caffeine ergogenic modifier (A) |
| Last-meal clock time, bedtime | h | GERD flag (4.15) |
| In-session carbohydrate intake | g/kg/h | endurance ≥90 min sessions (4.4) |

---------------------------------------------------------------------------------------------------------------------------------

## 4. Mechanisms & equations

Notation: `clip(x,a,b) = min(max(x,a),b)`; daily EWMA step with time-constant τ (days): `X ← X + (X_tgt − X)·(1 − exp(−1/τ))`.

### 4.1 Energy availability (EA): the shared driver and its tiers

**Mechanism.** Below a critical availability of fuel per kg of lean tissue the body down-regulates "expensive" systems: reproductive axis (LH pulsatility),
bone formation, IGF-1, T3, leptin, insulin. These changes appear within 3-5 days in controlled experiments [16][17][18][20]. EA is defined *relative to FFM* and
counts only exercise energy, not total expenditure.

```
EA  = (EI − EEE) / FFM                     // kcal per kg FFM per day
EA_s ← EWMA(EA, τ = 3 d);  EA_c = mean(EA over last 14 d)
tier(EA_c): T0 ≥ 45 | T1 30–45 | T2 15–30 | T3 < 15
```

| Data point | Result | Source |
|-----------|--------|--------|
| 29 normal-weight, sedentary women, 5 d, EA 45 vs 10/20/30 (exercise 15 kcal/kgLBM/d at 70 % VO2max) | LH pulsatility **unaffected at 30**; below 30 pulse frequency ↓, amplitude ↑ (all P<0.04) | Loucks & Thuma 2003 [20] |
| same experiment, bone | osteocalcin & PICP suppressed at **all** restricted EA (10, 20, 30; P<0.05); PICP falls **linearly** with EA; OC drop is abrupt between 20 and 30; NTX (resorption) ↑ only at EA 10 (P<0.01) | Ihle & Loucks 2004 [16] |
| 10 active women, 3 d, EA 15 by diet vs 15 by exercise vs 45 | diet-LEA: P1NP −17 % (54.8→45.2 µg/L, P=0.001), CTX +15 % n.s. (0.48→0.55), IGF-1 −13 %, T3 −15 %; exercise-LEA: P1NP −8 % n.s. | Papageorgiou 2018 [17] |
| 11 women + 11 men, 5 d, EA 45 vs 15 | women: CTX AUC ↑ (P=0.03), P1NP AUC ↓ (P=0.01); men: n.s.; no significant sex difference | Papageorgiou 2017 [18] |
| 6 men, 4 d, EA 15 vs 40 | leptin −53 to −56 %, insulin −34 to −38 %; T3, testosterone, IGF-1, ghrelin n.s. | Koehler 2016 [111] |
| Elite distance athletes, 7-d diaries | amenorrhoeic (37 %) and low-testosterone (40 %) athletes had lower T3, BMD (F) and ~4.5× more bone injuries; **reproductive function was a better marker than calculated EA** | Heikura 2018 [22] |

**Caveats.** (i) The 30 kcal/kg FFM threshold comes from 5-day experiments in normal-weight sedentary young women; extrapolation to men, older adults, weeks-long
exposure and to people with high fat mass is unverified (O1). (ii) EA is noisy to measure in free living [22]; the engine has exact inputs, so this is less of a problem
than in the field. (iii) Exercise-created LEA produced smaller bone-formation effects than diet-created LEA (−8 % n.s. vs −17 %) [17] — one small study.
**Evidence grade: B** (several controlled human experiments, consistent; small n, short, one population).

### 4.2 Bone (turnover indices and BMD)

**Mechanism.** (a) Fast endocrine pathway: low EA → ↓insulin, IGF-1, T3, oestradiol, leptin → osteoblast formation falls first (days), resorption rises only at deeper deficit. (b) Slow
mechanical pathway: lower body weight → less skeletal loading → hip (weight-bearing) BMD falls over months. (c) Reduced calcium absorption during weight loss [13]. (d) Very-low-carbohydrate,
high-training pattern: independent uncoupling of turnover markers in elite athletes [19]. Resistance/impact loading and (post-menopause) calcium partly offset.

**Quantitative evidence.**

| Study | Population / intervention | Result |
|-------|---------------------------|--------|
| Zibellini 2015 meta-analysis (41 publications) [1] | overweight/obese adults, diet-induced loss | total-hip BMD −0.010 to −0.015 g/cm² at 6, 12, 24 mo (CI −0.014…−0.005 @6 mo; −0.021…−0.008 @12; −0.024…−0.000 @24); **not significant at 3 mo**; lumbar spine n.s.; whole body −0.011 at 6 mo; markers (OC +0.26 nmol/L, CTX +4.72, NTX +3.70) ↑ at 2-3 mo but **not** at 6-24 mo; P1NP n.s. |
| Soltani 2016 meta-analysis (32 RCTs) [2] | adults | hip −0.008 g/cm², spine −0.018 g/cm²; hip loss appears after >4 mo, esp. obese; diet and diet+exercise lose hip BMD, **exercise-only weight loss raises hip BMD** |
| Villareal 2006 RCT [3] | n=48, age 57, BMI 27, 1 y | CR (−10.7 % weight): total hip −2.2±3.1 % (vs HL +1.2 %), spine −2.2 %; **exercise-induced loss (−8.4 %): no BMD decrease**; weight change–BMD r=0.61 in CR only |
| Villareal 2011 RCT [4] | 107 obese adults ≥65 y, 1 y | diet −10 % weight: hip BMD −3 %; diet+exercise −9 % weight: hip BMD −1 % (P<0.05 between) |
| CALERIE-2 bone (Villareal 2016) [5] | n=218, age 38, BMI 25, 25 % CR target, 2 y (−7.5 kg, FFM −2.2 kg) | 24 mo vs ad-lib: lumbar spine −0.013 vs +0.007, total hip −0.017 vs +0.001, femoral neck −0.015 vs −0.005 g/cm² (baseline hip ≈0.98 → ≈ −1.7 %); CTX +0.098 vs +0.025 µg/L at 12 mo; BSAP −1.4 vs −0.3 U/L; ΔFFM the only predictor of hip BMD change |
| Riedt 2005 RCT [6] | 66 overweight postmenopausal women, 6 mo, −9.3 % weight | trochanter BMD −4.2 % at 1.0 g Ca/d vs −1.4 % at 1.7 g Ca/d (P<0.05); weight loss–trochanter BMD r=0.687 |
| Ricci 1998 [7] | obese postmenopausal, 6 mo, −10 % weight | Ca 1 g/d suppressed turnover markers; BMD loss tended 1.4 % greater on placebo (P<0.08) |
| Shapses 2001 [8] | 38 obese **premenopausal** women, 6 mo, −7.5 % weight | **no bone loss** with or without Ca; Ca tended to raise spine BMD +1.7 % |
| Beavers 2025 RCT [9] | 150 older adults (66 y, BMI 33.6), 12 mo, ≈ −9 to −11 % weight | trabecular hip vBMD −1.2 to −1.9 % in **all** arms; neither weighted vest (+0.91 mg/cm³, n.s.) nor RT prevented loss |
| Weaver 2026 RCT [10] | 187 older adults, 6 mo WL (−8 %) + aerobic | 1.2 vs 0.8 g protein/kg: hip *bone strength* +3.8 % vs +0.5 % at 6 mo; aBMD still fell with weight loss (P<0.001) |
| Shams-White 2017 meta-analysis [11] | 16 RCTs | higher protein: LS-BMD +0.52 % (0.06-0.97); no effect on hip/FN/total body; "no adverse effects" |
| Mason 2016 RCT [12] | 218 postmenopausal, 12 mo WL + exercise | vitamin D3 2000 IU/d: no BMD/lean-mass benefit; leg strength slightly lower |
| Shapses 2013 [13] | 82 postmenopausal, 6 wk | weight loss lowers true fractional Ca absorption; vitamin D raises it (Ca 1.2 g/d) |
| Reddy 2002 metabolic study [25] | 10 adults, LCHP diet 2 wk induction + 4 wk | urine pH 6.09→5.56; net acid +56 mEq/d; citrate −41 %; urinary Ca +61 % (160→258 mg/d); Ca balance −130 mg/d; OC ↓, NTX trending ↑ |
| Heikura 2020 [19] | 25 M + 5 F elite race walkers, isoenergetic, 3.5 wk | LCHF (<50 g CHO/d, 75-80 % fat): fasting CTX **+22 %** (d=0.69), P1NP **−14 %**, OC **−25 %**; post-exercise CTX above baseline; CHO restored CTX in hours but P1NP/OC stayed suppressed |
| Mullath 2025 meta-analysis [26] | 14 RCT + 16 cohort | no pooled BMD difference across diet categories (very heterogeneous); calorie restriction consistently raised resorption markers |

**Equations.**

*(a) Fast turnover indices (PROPOSED FIT; data: Papageorgiou 2018 (EA 45 → 0 %, EA 15 → −17 % P1NP; CTX +15 % n.s.), Ihle 2004 (linear PICP-EA; NTX ↑ only at EA 10; OC/PICP suppressed at EA 30, 20, 10)):*
```
sexF  = 1.0 (female), 0.5 (male)            // men n.s. in [18], but sex difference n.s. too → half weight, low confidence
srcF  = 1 − 0.5·f_EEE ,  f_EEE = share of the energy deficit created by exercise (0..1)   // [17]: −8 % vs −17 %
P1NP_tgt = 1 − 0.17 · clip((45 − EA_s)/30, 0, 1.3) · sexF · srcF
CTX_tgt  = 1 + 0.15 · clip((20 − EA_s)/5 , 0, 1.3) · sexF
P1NP_rel, CTX_rel ← EWMA toward targets, τ_b = 2 d (onset ≤3 d [17]; recovery time UNVERIFIED, assume same)
lowCHO term (optional, grade C): if netCHO < 0.7 g/kg/d for ≥7 d AND training ≥ 5 h/wk: add ΔP1NP = −0.14, ΔCTX = +0.22, approach with τ = 10 d (full at ~3.5 wk [19]); remove CTX part within 1 d of CHO restoration, P1NP part decays τ = 14 d (UNVERIFIED)
```
*(b) BMD (PROPOSED FIT; data: Villareal 2006 [3], CALERIE [5], Villareal 2011 [4], Zibellini [1], Soltani [2], Riedt [6], Shapses 2001 [8], Beavers [9]):*
```
BMDh_tgt  = − k_h · mAge · mRT · mCa · mSrc · WL_pct
BMDs_tgt  = − k_s · mAge · mRT · mCa · mSrc · WL_pct
dBMD/dt   = (BMD_tgt − BMD) / τ_bone ,   τ_bone = 120 d when BMD_tgt < BMD (loss); 240 d when recovering (asymmetry PROPOSED; UNVERIFIED — no human recovery data located)
```
| Symbol | Value (range) | Unit | Basis |
|--------|---------------|------|-------|
| `k_h` | 0.20 (0.10-0.30) | % BMD per % weight lost, premenopausal/mid-age | Villareal 2006: 2.2/10.7 = 0.21; CALERIE ≈1.8/≈10 = 0.18; Zibellini 0.010-0.015 g/cm² (≈1.0-1.6 %) at typical 7-10 % loss ⇒ 0.10-0.19 |
| `k_s` | 0.13 (0-0.20) | % per % | CALERIE spine −1.3 % vs +0.7 % ad-lib; Zibellini n.s.; Soltani −0.018 g/cm² — inconsistent → grade C |
| `mAge` | 1.0 (age <50/premenopausal); 1.5 (≥65 or postmenopausal) | – | Villareal 2011 (−3 %/10 %); Riedt (postmenopausal); Shapses 2001 (premenopausal obese: ~0); [14][15] qualitative. Numeric 1.5 is `UNVERIFIED` |
| `mRT` | 1 − ρ_RT; ρ_RT = 0.35 (0-0.67) if progressive RT ≥2×/wk | – | Villareal 2011: −3 % → −1 % (ρ≈0.67); Beavers 2025: ρ≈0 (n.s.); Villareal 2006/Soltani: exercise-induced loss spares BMD. **Contested** |
| `mSrc` | 0.25 if ≥60 % of the deficit is exercise energy | – | Villareal 2006 (n=19 per arm), Soltani; grade C |
| `mCa` | 1.0 (Ca ≥1.0 g/d or premenopausal); 1.5 if postmenopausal and Ca <1.0 g/d | – | Riedt: −4.2 vs −1.4 % (factor 3 at trochanter); Ricci: 1.4 % difference; the 1.5 is a conservative `UNVERIFIED` shrink |
| protein | LS-BMD +0.5 % if protein ≥1.2 g/kg/d during loss | % | Shams-White [11]; Weaver [10] (bone strength) |
| vitamin D | no BMD effect modelled | – | Mason [12]; Shapses 2013 [13] (absorption only) |

*Time dynamics.* Turnover markers respond in 3-5 d [16][17][18] and rise in the first 2-3 months of weight loss then normalise [1]; BMD change is not detectable at 3 mo but present at ≥6 mo [1], hip
loss continues while weight falls (CALERIE 12→24 mo [5]) and is plateaued when weight is stable; regain: UNVERIFIED.
*Moderators.* age/menopause (large), sex (LEA effects in women; men less studied), adiposity (loss "greater in older and lean adults" [15]; obese premenopausal women may lose none [8]), calcium status, RT, exercise-vs-diet origin of deficit.
**Evidence grade:** mean effect direction and size **A** (two meta-analyses [1][2] + CALERIE RCT [5]); moderators **C** (few, small, sometimes contradictory RCTs [4][9]); fast turnover-EA relationship **B**; low-CHO bone term **C** (one elite-athlete study, markers only).
**Verdict: model as numeric** (`dBMD_hip` % as a *safety/constraint* output; `P1NP_rel`, `CTX_rel` as advanced-view indices). Do **not** convert to fracture risk (no data over 1-6 months).

### 4.3 Strength, power and training capacity

**Mechanism.** Strength = neural drive × muscle size × technique. In a moderate deficit with resistance training, neural/technique gains continue and strength rises even when lean-mass gains stall [27][34].
Severe, prolonged deficits in lean people erode muscle, drive, and glycogen, and depress anabolic/thyroid hormones, so max strength and especially power fall [30][31][32][35][36]. Acute factors (glycogen,
dehydration) mostly hurt *repeated/high-volume* efforts rather than a single 1RM [38][40].

**Quantitative evidence.**

| Study | Population / conditions | Result |
|-------|------------------------|--------|
| Murphy & Koehler 2022 meta-analysis [27] | RCTs of RT in energy deficit ≥3 wk | lean-mass gains impaired (ES −0.57 vs no-deficit RT; matched analysis −0.11 vs +0.20), **strength gains comparable** (ES −0.31 n.s.; matched 0.84 vs 0.81); meta-regression: **~500 kcal/d deficit prevented lean-mass gain** |
| Longland 2016 [34] | 40 young men, 4 wk, −40 % energy, RT+HIIT 6 d/wk | protein 2.4 vs 1.2 g/kg: LBM +1.2 vs +0.1 kg; performance measures improved in both |
| Pasiakos 2013 RCT [45] | 39 adults, 21 d at −40 % energy after 10 d maintenance | −3.2 kg in all groups; protein 1.6 and 2.4 g/kg (vs 0.8) lowered the share of loss from FFM and preserved the anabolic response to a protein meal |
| Mäestu 2010 [44] | 7 male bodybuilders vs 7 controls, 11 wk energy restriction before a contest | IGF-1 and insulin fell significantly (ΔIGF-1 ↔ Δinsulin r=0.74, ↔ Δfat mass r=0.71); testosterone fell only from week 11 to week 5 (20.3→18.0 nmol/L) despite high protein |
| Garthe 2011 [28] | 24 elite athletes, RT 4×/wk, 8.5 vs 5.3 wk | −0.7 %/wk BW (SR): LBM +2.1 %; −1.4 %/wk (FR): LBM −0.2 % (unchanged); authors conclude ≈0.7 %/wk is preferable for LBM and 1RM strength (individual 1RM/jump/sprint values not in the abstract) |
| Nindl 2007 [30] | 50 male soldiers, 8 wk Ranger course, ≈ −1000 kcal/d | BM −13 %, FFM −6 %, FM −50 %; jump −16 %, power −21 %, **max lifting strength −20 %**; IGF-1, testosterone ↓, cortisol ↑ |
| Rossow 2013 [31] | 1 drug-free bodybuilder, 6 mo prep | BF 14.8→4.5 %; strength **decreased, not fully recovered at 6 mo**; testosterone 9.22→2.27 ng/mL; TMD 6→43; recovery: BF 14.6 %, T 9.91, TMD 4 |
| Pardue 2017 [32] | 1 bodybuilder, 8 mo prep, intake 3860→1724 kcal | peak anaerobic power 753→536.5 W (−29 %), RMR 107→81 % of predicted, T 623→173 ng/dL, T3 123→40 ng/dL; largely (not fully) reversed by month 13 |
| Hulmi 2016 [33] | 27 female fitness competitors, 4 mo, −12 % weight, −35-50 % fat | small lean-mass/muscle-CSA loss; leptin, T3, testosterone (P<0.001), oestradiol ↓; more menstrual irregularity; recovered 3-4 mo after refeeding except T3/testosterone |
| Tornberg 2017 [35] | 14 amenorrhoeic vs 16 eumenorrhoeic elite endurance athletes | knee strength −11 %, knee endurance −20 %, reaction time +7 %; lower T3, oestradiol, glucose; higher cortisol |
| Vanheest 2014 [36] | 10 junior elite swimmers, 12 wk | ovarian-suppressed: 400 m velocity **−9.8 %** vs **+8.2 %** in cyclic swimmers; lower T3 and EA |
| Melin 2024 review [37] | LEA and performance | short/moderate LEA can improve power-to-weight; severe/chronic LEA reduces strength/endurance and training response |
| Judelson 2007 [38] | 7 resistance-trained men, hypohydration −2.4 % / −4.8 % BM | vertical jump, peak power, peak isometric force **unchanged**; total work in a 6-set squat protocol fell from set 2-3 (2.4 %) / 2-5 (4.8 %); central activation ratio 95.6→94.0→92.5 % (P=0.075) |
| Abaïdia 2020 meta-analysis (11 studies) [39] | Ramadan fasting | strength, jump, aerobic performance **not affected**; Wingate mean/peak power and repeated-sprint performance **decreased**; morning sprint ↓ |
| Cholewa 2019 review [40] | carbohydrate restriction & RT | severe CHO restriction may not impair strength *adaptations*, but adequate CHO in the days before testing may raise max strength and strength-endurance |
| Murphy 2021 systematic review (17 studies) [41] | KD ≥14 d vs mixed | power/strength outcomes: 3 lower, 11 no difference, 2 higher |
| Gawelczyk 2026 meta-analysis [42] | LCD/KD, anaerobic | peak power d=+0.29 (−0.08…0.66), repeated-sprint d=−0.33 (−0.80…+0.14), blood lactate d=−0.89 (−1.20…−0.58) (2026 meta-analysis of 13 studies, very few citations; low confidence) |
| Warren 2010 meta-analysis [43] | caffeine | MVC strength ES 0.19; muscular endurance ES 0.28 (open end-point tests only) |

**Equations (PROPOSED FIT; data points above).**
```
// chronic penalty: only when EA_c < 30 (Loucks threshold) — leanness-gated (see O1)
pen_tgt  = a · clip((30 − EA_c)/15, 0, 1.3) · g_lean        a_strength = 0.15 ; a_power = 0.20   (range 0.10-0.30)
M_EA_tgt = 1 − pen_tgt
M_EA ← M_EA + (M_EA_tgt − M_EA)·(1 − exp(−1/τ)),  τ_on = 28 d (falling), τ_off = 75 d (recovering)   // Nindl 8 wk; Rossow/Pardue/Hulmi: recovery 3-13 mo. UNVERIFIED time constants
Strength(t)  = Strength_RTmodel(09)(t) · M_EA · M_acute(t)     // no penalty for moderate deficit (EA_c ≥ 30) [27][34]
g_lean       = 1 if BF% ≤ 18 (M) / 28 (F); linear to 0.3 at BF% ≥ 30 (M) / 40 (F)      // UNVERIFIED thresholds (O1)
```
Anchors for `a`: EA_c 15 ⇒ −15 % (Tornberg −11 % / −20 %; Nindl −20 %; Vanheest ≈ −18 pp vs cyclic; Pardue power −29 %).
*Acute modifiers (flag-level; `M_acute`, applied only to volume-tolerance/repeated-effort tasks):*
- hypohydration ≥2.4 % BM: later-set work ↓ (no change in peak force/power) [38] → set flag "reduced set-to-set performance"; magnitude UNVERIFIED (not in abstract).
- very-low-CHO (<50 g/d for ≥7 d) → repeated-sprint / glycolytic set performance d≈−0.3 [42], single maximal efforts unchanged [41][42] → `M_acute = 1 − 0.03` (UNVERIFIED conversion of d to %).
- caffeine 3-6 mg/kg → +0.19 SD strength, +0.28 SD muscular endurance [43]; endurance TT −2.2 % time [60] (grade A, dossier 15 owns dosing).
- fasting (Ramadan-type, ≥12 h): sprint/repeated-sprint ↓; aerobic and strength not affected [39].

*Time dynamics.* Penalty onset weeks (not days); moderate deficit with RT: none; recovery months. *Moderators.* leanness (dominant), RT stimulus and protein (03), sleep (16), sex (women more sensitive to LEA hormonally; performance data mostly female-athlete [35][36]).
**Evidence grade: B** for "no strength loss in moderate deficit with RT" (meta-analysis + RCTs); **C** for the size/time-constants of the severe-deficit penalty (case studies, one military cohort, cross-sectional athlete data).
**Verdict: numeric multiplier** on dossier 09's strength/power outputs + acute volume-tolerance flags. **Do not** output a separate "training capacity" number (no verified dose-response).

### 4.4 Endurance performance

**Mechanism.** At ~70-80 % VO2max, exhaustion coincides with depletion of working-muscle glycogen to ≈25 mmol/kg wet weight [47]; starting glycogen therefore sets time-to-exhaustion (TTE) [46].
Below ~90 min or above ~5 min of high-intensity work extra glycogen does not help [47]. A ketogenic low-CHO pattern (i) raises fat oxidation ~2-3× [50][51][52] but (ii) lowers the muscle's ability to
oxidise carbohydrate and raises O2 cost per unit speed, so high-intensity performance is impaired despite unchanged/improved VO2peak [49][50][53]. Body mass enters through cost per kg
(running) or power-to-weight (climbing) [55][56][57].

**Quantitative evidence.**

| Study | Population / conditions | Result |
|-------|------------------------|--------|
| Bergström 1967 [46] | 9 healthy men, cycling at 75 % (71-82 %) VO2max to exhaustion after 3 d fat+protein (P), mixed (M) or CHO-rich (C) diets | mean glycogen 0.63 / 1.75 / 3.31 g/100 g ww ↔ TTE **56.9 / 113.6 / 166.5 min** (n=9; abstract quotes 59/126/189 min for the six subjects on the P→C sequence); regression **TTE(min) = 41.6·G + 36.8, r=0.92, P<0.001** (G in g/100 g ww); glycogen range 0.6-4.7 |
| Hawley 1997 review [47] | carbohydrate loading | no benefit for <5 min high-intensity or 60-90 min moderate efforts; **~20 % delay of fatigue in events >90 min**; 2-3 % TT improvement |
| Vandenbogaerde & Hopkins 2011 [48] | 88 crossover studies, 155 estimates | in-exercise carbohydrate: effects from **+6 % to −2 %** mean power; best supplement ≈0.7 g/kg/h glucose polymer + 0.2 g/kg/h fructose + 0.2 g/kg/h protein in a 3-10 % solution; +fasting 9 h and protein: small extra; >0.25 g/kg/h fructose reduces benefit |
| Burke 2017 [49] | 29 elite race walkers, 3 wk intensified training, isoenergetic: HCHO (8.6 g/kg CHO) / PCHO / LCHF (<50 g/d, 78 % fat) | VO2peak ↑ in all groups (P<0.001); LCHF peak fat oxidation 1.57±0.32 g/min at ~80 % VO2peak; O2 cost at 20-km pace (as % of new VO2peak) fell in HCHO (90 % CI −7.05…−2.55 pp; midpoint ≈ −4.8) and PCHO (−5.18…−0.86; midpoint ≈ −3.0) but was **maintained (no fall) in LCHF**; 10-km time: HCHO −6.6 % (faster; 4.1-9.1), PCHO −5.3 %, **LCHF +1.6 % slower (−8.5…+5.3)** |
| Burke 2021 [50] | 13 world-class race walkers, 5-6 d LCHF vs HCHO, then washout | fat oxidation >+200 % (≈1.43 g/min); **relative VO2 +8 % and +5 % at 50-km and 20-km speeds**; 10,000 m race after 24 h HCHO + 2 g/kg pre-race CHO: HCHO +5.7 (5.6) % faster, **6/7 LCHF athletes slower (2.2 [3.4] %)**; substrate use back to baseline after **5-6 d** of HCHO |
| Volek 2016 [52] | 10 LC vs 10 HC ultra-runners, 9-36 mo | peak fat oxidation 1.54 vs 0.67 g/min (at 70 vs 55 % VO2max); mean 180-min fat oxidation +59 %; **resting muscle glycogen and depletion identical** |
| Shaw 2019 [53] | 8 trained men, 31 d KD crossover | VO2max unchanged; **efficiency impaired at >70 % VO2max, maintained at <60 %**; TTE at 70 % VO2max 239→219 min (n.s.); individual decrements when RER at VO2max <1.0 |
| Zajac 2014 RCT [62] | 8 male off-road cyclists, mixed vs ketogenic crossover | relative VO2max ↑ (lower body/fat mass) but **maximal workload and workload at lactate threshold lower after KD**; VO2 and HR higher at submaximal stages (consistent with an economy cost) |
| Murphy 2021 review [41] | 17 studies (13 endurance outcomes) | 3 lower, 10 no difference for endurance performance on KD |
| Gawelczyk 2026 [162] | 33 aerobic studies (Newcastle-Ottawa, vote-counting) | claims performance impaired only ≤7 d, maintained thereafter — **conflicts with [49][50]; low quality, not used** |
| Marquet 2016 [54] | 21 triathletes, 3 wk "sleep-low" (same 6 g/kg CHO, different timing) | 10-km time −2.9±2.2 % vs −0.1 %; delta efficiency +11 % vs +1.4 %. Single RCT; Burke [51]: periodised models have not beaten guideline-based intake |
| Cureton 1978 [55] | 6 subjects, added trunk weight 0/5/10/15 % | each **+5 % mass: VO2max (ml/kg total) −2.4, treadmill time −35 s, 12-min distance −89 m**; absolute VO2max unchanged |
| Teunissen 2007 [56] | 10 runners at 3 m/s | metabolic cost ∝ added weight, slightly more than proportional; weight support is ≤74 % of net cost |
| Swain 1994 [57] | cycling | drag scales with mass^(1/3); VO2max with mass^(2/3); **uphill cost exponent 0.79** → light riders favoured on climbs, heavier on flat |
| Burden 2015 [58] | 17 studies, iron-deficient non-anaemic athletes | iron treatment: VO2max Hedges g 0.61 (0.40-0.82) — driver is iron status, not modelled (flag) |
| Goulet 2012 [59] | endurance athletes | pre-exercise BM loss ≥3 % may reduce performance; ≤1 h exercise: dehydration does not reduce it; drink to thirst |
| Southward 2018 [60] | 46 studies | caffeine 3-6 mg/kg: TT time −2.2±2.6 %, mean power +3.0±3.1 % |

**Equations.**
```
// (1) glycogen-limited endurance capacity at ~75 % VO2max (Bergström); G in g/100 g wet muscle (convert from dossier 04 units)
TTE_75(G) = 36.8 + 41.6 · G                  [min]   valid G ∈ [0.6, 4.7], I ∈ 71–82 % VO2max, n=9 men
// general rule (Hawley): glycogen matters only if session duration × muscle-glycogen use rate would deplete stores to ≈25 mmol/kg ww:
t_lim = (G_start − 25 mmol/kg ww) / r_gly(I)         // r_gly(I) from dossiers 04/10; if planned duration < t_lim → no glycogen penalty
// (2) in-session carbohydrate bonus (only if session > 60-90 min and CHO ingested): TT_gain ∈ [0, 6] %, central 2-3 %  [47][48]; dose ≈ 0.7 g/kg/h glucose + 0.2 g/kg/h fructose
// (3) economy penalty from fat adaptation (A_fat from dossier 05, 0..1)
gI      = clip((I_rel − 0.60) / 0.10, 0, 1)                  // 0 at ≤60 % VO2max, 1 at ≥70 %  [53]
dO2cost = 0.065 · A_fat · gI                                  // fractional rise in O2 cost (range 0.05–0.08)   [50]
econ_factor = 1 / (1 + dO2cost)                               // multiplies speed/power sustainable at fixed metabolic power
A_econ ← A_fat·gI ; wash-out with A_fat (substrate use normal in 5-6 d [50]); economy recovery after CHO restoration UNVERIFIED (assume τ = 3 d; note 24 h CHO restoration did not restore race performance [50])
// (4) mass effect
speed_run  ∝ VO2max_rel / Cr ,  Cr ≈ const per kg (+ slightly >proportional with added load) [56];  +5 % inert mass ⇒ −2.4 ml/kg/min relative VO2max [55]
climb_speed ∝ P_thr / M^0.79  [57]
```
*Time dynamics.* Glycogen effects are hours-days (04); economy penalty present after 5-6 d and persistent through ≥3 wk of ketogenic adaptation [49][50]; wash-out of substrate use 5-6 d.
*Moderators.* relative intensity (dominant), training status (data are elite/trained), individual responders (Shaw: those with RER >1.0 at VO2max preserved TTE), sex (mostly male data [53]).
**Evidence grade:** glycogen–TTE **A** (classic + reviews, mechanistically solid; original n=9); LCHF economy penalty **B** (two RCTs by one group, consistent physiology, plus independent Shaw/Volek); mass effects **B** (physics + small experiments); iron/hydration **flags** (B/C).
**Verdict: numeric** (`TTE index`, `economy factor`, `power-to-weight`); **flags** for hydration (≥3 % pre-exercise BM loss, [59]) and iron deficiency ([58]); "sleep-low"/periodisation = contested preset, not a modelled effect.

### 4.5 Subjective energy/fatigue, mood and cognition

**Mechanism.** Four largely separate effects: (i) *induction transient* when carbohydrate falls steeply: natriuresis/diuresis days 1-4, low glycogen/insulin, mild hypovolaemia → fatigue, dizziness, headache, "brain fog"
(2-4 wk) [70]; (ii) *acute fasting/hunger*: modest, task-specific effects; (iii) *deficit + weight loss in non-lean people*: mood, tension, sleep and general health improve [67][68][71][104]; (iv) *severe deficit in lean
people* (EA <30, very low fat mass): fatigue, irritability, mood disturbance, preoccupation with food, cognitive slowing [31][76][154]. Cognition per se shows small, inconsistent, task-specific changes.

| Study | Population / conditions | Result |
|-------|------------------------|--------|
| Benau 2014 systematic review (10 studies) [63] | experimental short-term fasting, healthy adults | "equivocal": several studies no difference, others deficits in psychomotor speed, executive function, mental rotation |
| Harder-Lauridsen 2017 [64] | 10 lean men, 28 d Ramadan-type (14 h abstinence) | body composition, glucose, **cognitive tests unchanged**; hunger AUC ↑, satiety ↓, steps ↓, "less positive feelings in the afternoon" |
| Gudden 2021 review [84] | intermittent fasting | no clear short-term cognitive benefit in healthy subjects |
| Galioto 2016 review (38 studies) [79] | breakfast vs fast ≥8 h | small robust advantage for memory (delayed recall); attention/executive/motor equivocal |
| Philippou 2014 (11 studies) [81] | glycaemic index & cognition | inconsistent; low-GI meal "may favour" cognition in adults, inconclusive |
| McLellan 2016 review [80] | caffeine 40-300 mg | ↑alertness, vigilance, attention, reaction time; memory/executive inconsistent |
| Kretsch 1997 [65] | 14 obese women, 15 wk at −50 % energy | simple reaction time **slowed**; attention, immediate memory, motor unaffected; word recall +24 % |
| Wing 1995 [66] | 21 women, 28 d VLED ketogenic vs non-ketogenic | attention unchanged; trail-making (mental flexibility) **worse on ketogenic, mainly baseline→week 1** |
| Halyburton 2007 RCT [67] | 93 overweight, 8 wk, −30 % energy, LCHF vs HCLF | mood improved in both, most in first 2 wk, no group difference; speed of processing improved **less** on LCHF (P=0.04); working memory same |
| Brinkworth 2009 RCT [68] | 106 overweight, 1 y | overall mean loss 13.7 kg with no group difference; **HCLF better mood** (BDI, anxiety, TMD, anger, depression; P<0.05); working memory improved over time, no diet effect |
| CALERIE-2 [71] | 218 non-obese (BMI 22-28), 25 % CR target for 2 y (−7.6 kg) | vs ad-lib: BDI-II −0.76 (ES −0.35), POMS tension −0.79 (ES −0.39), SF-36 general health +6.45 (ES 0.75), sexual drive/relationship +1.06 (ES 0.35), sleep duration better at 12 mo; greater % loss ↔ more vigor (ρ=−0.30), less mood disturbance (ρ=0.27); **no negative effects** |
| Alfaris 2015 [104] | 390 obese, behavioural WL | ≥5 % loss vs <5 %: +21.6 min sleep, PSQI −1.2, PHQ-8 −2.5 vs −0.1 at 6 mo; mood benefit persisted at 24 mo |
| Rossow 2013 [31] | drug-free bodybuilder | total mood disturbance 6→43 during 6-mo prep, 4 at 6 mo recovery |
| Rohrig 2017 [85], Halliday 2016 [86] | female physique competitors | mood stable until month 5 then variable [85]; EA −5.4 kcal/kg FFM, menstrual irregularity in month 1, last menses week 11 [86] |
| Lieberman 2005 [76] | 31 officers, 53 h simulated combat (sleep 3 h, −4.1 kg, mostly water) | vigilance, reaction time, attention, memory, reasoning impaired; vigor, fatigue, confusion, depression, tension worse (multi-stressor, not diet alone) |
| Wittbrodt 2018 meta-analysis (33 studies) [77] | dehydration 1-6 % BM | cognition ES −0.21 (−0.31…−0.11); attention −0.52; executive −0.24; **>2 % BM loss −0.28 vs ≤2 % −0.14** |
| Adan 2012 review [161] | dehydration ~2 % | impairs attention, psychomotor and immediate-memory tasks and subjective state; long-term/working memory and executive function more preserved |
| Armstrong 2012 [78] | 25 women, −1.36 % BM | mood (vigor, fatigue, TMD), concentration, headache worse; cognitive tests mostly unaffected |
| Bostock 2020 [69] | 300 forum users, 101 described "keto flu" | symptoms peak week 1, dwindle after 4 wk; resolution day 3-30 (median 4.5, IQR 3-15) |
| Skartun 2025 scoping review [70] | adults on keto-induction | onset 2-3 d, resolve 2-4 wk; adult rates: fatigue 18 % (weakness 25 % vs 8 % low-fat), dizziness 15-21 %, headache 8-25 %, "brain fog" ~10 %, nausea 8-16 %, constipation 1-27 % (68 vs 35 % in one RCT), diarrhoea 2 % (23 vs 7 %) |
| Krikorian 2012 [82] | 23 older adults with MCI, 6 wk VLC | verbal memory improved (P=0.01); ketone level correlated (P=0.04) — MCI, tiny |
| Bonnechère 2026 meta-analysis [83] | 38 studies of *exogenous* ketones | SMD 0.29 (0.16-0.41), dose-related; supplements, mostly acute — not a dietary-ketosis result |
| Firth 2019 meta-analysis [72] | 16 RCTs, n=45,826 | dietary improvement: depressive symptoms g=0.162 (0.055-0.269), anxiety n.s. |
| SMILES 2017 RCT [73] | 67 adults with major depression, 12 wk | MADRS d=−1.16; remission 32.3 % vs 8.0 %, NNT 4.1 (small, single-blind, adjunctive) |
| Lassale 2019 / Molero 2025 [74][75] | observational / mixed | Mediterranean-diet adherence ↔ incident depression RR 0.67 (0.55-0.82) [74]; overall "very low" strength of evidence, prevention RCTs null [75] |

**Equations / rules (PROPOSED — heuristic, not a fitted model).**
```
// keto-induction symptom load (numeric, drives a flag and prevalence text)
t_k  = first day where 7-d mean net-CHO ≥ 100 g/d fell to < 50 g/d for ≥ 2 consecutive days
KI(t)= 0 for (t−t_k) < 2 ;  1 for 2 ≤ (t−t_k) ≤ 4 ;  exp(−((t−t_k) − 4)/10) afterwards      // onset 2–3 d, resolves 2–4 wk [69][70]
show at KI ≥ 0.5: "expected in ~10-25 % of adults: fatigue/dizziness/headache; ~10 % brain fog; resolves in 2–4 wk"   // prevalence ranges from [70]
// wellbeing risk tier (integer points; green 0-1, amber 2-3, red ≥4)
pts  = [EA_c ∈ 15–30]·1 + [EA_c < 15]·2                       // [16][17][20][31]
     + [r ∈ 1.0–1.5 %BW/wk]·1 + [r > 1.5 %BW/wk]·2           // r = 14-d weight-loss rate; Helms 0.5–1 %/wk recommended [29]; Garthe: 1.4 %/wk lost LBM [28]; the >1.5 %/wk cut-off is PROPOSED (the gallstone flag uses Weinsier's absolute 1.5 kg/wk [138] separately)
     + [KI ≥ 0.3]·1                                            // [69][70]
     + [sleep debt > 1 h/night (dossier 16)]·1
     + [very lean: BF% < 10 (M) or < 18 (F)]·1                 // thresholds UNVERIFIED; Rossow BF 4.5 % [31]
// benefit text (not a number): if BF% above the leanness gate (O1) and deficit moderate (EA_c ≥ 30) and weight loss ≥5 % → "mood/sleep/general health typically improve" [67][71][104]
```
*Time dynamics.* Induction transient 2-28 d; deficit mood effects build over weeks (first 2 wk of a moderate deficit are the *best* for mood in trials [67]); severe-deficit mood decline builds over months (month 5 in [85]) and recovers in ≈6 mo after refeeding [31].
*Moderators.* baseline adiposity (benefit ↔ harm switch), EA, sleep, caffeine (acute alertness), depression history (SMILES applies to *diagnosed* depression), hydration (≥2 % BM).
**Evidence grade: C** (mixed RCT/observational; effects small; heterogeneity high; single-case data for extreme prep).
**Verdict: qualitative tier + keto-induction window; do NOT model or display a "cognitive performance" score**; do not claim "mental clarity from ketosis" or "brain fog from fasting" — both unsupported as generalisations (section 8).

### 4.6 Immune function / illness risk

**Mechanism.** Chronic low EA + heavy training + sleep loss are associated with more upper-respiratory illness in athletes; fasting acutely lowers circulating monocytes without impairing emergency mobilisation [91];
moderate CR for 2 y *improved* thymopoiesis [92]. "Extreme exercise suppresses immunity" ("open window"/J-curve) is contested [89][90].

| Study | Result |
|-------|--------|
| Drew 2018 [87] | 132 Olympic athletes (42 % response): LEA (LEAF-Q) associated with illness in previous month, **URTI OR 3.8 (1.2-12)**; all athletes reported ≥1 illness symptom; cross-sectional |
| Nieman 2011 [88] | 1002 adults, 12 wk: URTI days **−43 %** with ≥5 d/wk aerobic exercise vs ≤1 d/wk, −46 % (high vs low fitness); observational |
| Campbell & Turner 2018 [89]; Simpson 2020 [90] | "open window" evidence weak; infection risk multifactorial (sleep, travel, nutrition, stress) |
| Jordan 2019 [91] | short-term fasting ↓ circulating monocytes and their inflammatory activity, emergency mobilisation preserved (mechanistic study; species mix not verified here) |
| Spadaro 2022 [92] | ~14 % CR for 2 y (CALERIE) improved thymopoiesis |
| McKay 2019 [93] | 26 elite race walkers, 3 wk HCHO/PCHO/LCHF: resting s-IgA ~2× ↑ in all groups, no diet difference |

**Rule (PROPOSED).** `IMM_flag = amber` if EA_c < 30 for ≥ 28 d; `red` if EA_c < 15 for ≥ 14 d, or (EA_c < 30 AND sleep debt > 1 h/night AND weekly training > 10 h). Text only: "illness risk higher in lean, very-low-energy-availability training blocks (observational, OR ≈ 4)".
**Evidence grade: C.** **Verdict: flag only. Do not output infection probability.** Do not claim immunity gains from fasting.

### 4.7 Skin, hair and nails

**Hair (telogen effluvium, TE).** Trigger events (severe caloric restriction, protein/EFA/zinc deficiency, rapid weight loss, illness) push follicles from anagen into telogen; shedding starts **2-3 months after the trigger**, lasts <6 months
(acute TE), and remits in ~95 % of acute cases [100]. EFA deficiency: 2-4 months after insufficient intake [100]. Incidence: ~3-5 % (RR ≈3.3) in GLP-1-agonist trials and 47-57 % pooled after bariatric surgery (per review abstract [102]; primary sources UNVERIFIED).
Iron/vitamin D links are "very controversial"; supplementation without documented deficiency is not supported and some supplements worsen hair loss [100][101].
```
trigger_day when (a) 14-d weight-loss rate ≥ 1.0 %BW/wk for ≥ 28 d, or (b) intake < 800 kcal/d (VLED) for ≥ 14 d, or (c) protein < 0.5 g/kg/d for ≥ 28 d   // thresholds PROPOSED, UNVERIFIED (no dose-response found)
H_flag window: [trigger+60 d, trigger+180 d]; tier by trigger severity: (a)=moderate, (b)/(c)=high
```
**Acne.** Low-glycaemic-load diet RCTs: Smith 2007 (43 males 15-25 y, 12 wk, 25 % protein/45 % low-GI CHO): total lesions −23.5±3.9 vs −12.0±3.5 (P=0.03) with concurrent weight loss −2.9 kg and better insulin sensitivity [97]; Kwon 2012 (32 pts, 10 wk) fewer inflammatory/non-inflammatory lesions, smaller sebaceous glands [98]; review: "modest yet significant pro-acnegenic effect" of high GI/GL, dairy uncertain [99]. Flag "high glycaemic load pattern (dossier 04) may worsen acne" only.
**Skin colour.** Fruit/vegetables +2.9 portions/d for 6 wk changed skin redness/yellowness perceptibly (n=35, correlational within-subject) [103] — cosmetic; not modelled.
**Nails.** No human diet-outcome data located → **do not model**.
**Grade: C** (hair timeline B− descriptive; acne B−). **Verdict:** hair = delayed flag; acne = flag; skin colour/nails = do not model.

### 4.8 Gastrointestinal comfort

**Mechanism.** Constipation relates to stool bulk/fermentable fibre; bloating/flatulence to rapid fibre or polyol increases; diarrhoea to polyols, MCT, fructose/lactose loads. Dossier 15 owns the fibre/polyol thresholds; this dossier adds the outcome layer.
- Fibre supplements in chronic idiopathic constipation: response 77 % vs 44 % (RR 1.71, 1.20-2.42); stool frequency SMD 0.39; softer stools SMD 0.35; **flatulence SMD 0.56** (7 RCTs, low quality) [94].
- Low-digestible carbohydrates (fibre, resistant starch, polyols) cause dose-dependent, transient abdominal discomfort, flatus and diarrhoea at high intakes; no upper limit set (review of 68 studies) [95].
- 8-wk −30 % energy RCT (n=91): very-low-carbohydrate diet reduced faecal output (−61 vs +21 g/d), defecation frequency, faecal butyrate/SCFA and bifidobacteria vs high-CHO high-fibre; **adverse GI symptom incidence did not differ** [96]. Keto-induction adult constipation 1-27 % (68 vs 35 % in one trial [70]; the two adult trials conflict — treat constipation as an uncertain flag, not a prediction).
**Flags (PROPOSED thresholds, UNVERIFIED — take numeric limits from dossier 15):** `bloating_flag` if fibre rises by > ~10 g/d within 7 d; `stool_bulk_flag` if fibre < 15 g/d together with ketogenic-range carbohydrate (Volek/Phinney advise 15-20 g/d fibre, cited in [70]); `polyol/MCT_flag` per 15.
**Grade: C. Verdict: flags only** (no stool-frequency prediction).

### 4.9 Menstrual regularity and libido / sexual function

**Mechanism.** GnRH/LH pulsatility is suppressed once EA falls below ≈30 kcal/kg FFM/day [20]; over weeks this shows up as luteal-phase defects, then anovulation/oligomenorrhoea/amenorrhoea, lower oestradiol [21][33][86]. In men, testosterone falls with
severe, prolonged deficits [31][32]. In *obese* people the direction reverses: weight loss raises testosterone and erectile function [109][110].

| Study | Result |
|-------|--------|
| Williams 2015 RCT [21] | 34 analysed untrained ovulatory women (40 completed), 3 cycles, exercise + controlled diet; average energy deficit EXCON 0 %, ED1 −8±2 %, ED2 −22±3 %, ED3 −42±3 % of needs (≈ −470 to −810 kcal/d for ED2-ED3). **≥1 luteal-phase defect in 3 cycles: 1/8, 1/6 (printed as 38 % in the table; 1/6 = 17 %), 10/12, 7/8** (P=0.001); frequency of all disturbances ∝ % deficit (β=−0.48, r²=0.23, P=0.003); anovulation/oligomenorrhoea **not** dose-dependent; luteal phase shortened by cycle 3 in ED3 |
| Loucks & Thuma 2003 [20] | LH pulsatility disrupted below EA 30 (5 d) |
| Hulmi 2016 [33] | 4-mo diet in 27 fitness competitors (−12 % weight): oestradiol ↓, more menstrual irregularity; recovery of most hormones 3-4 mo after refeeding |
| Halliday 2016 [86] | 20-wk prep: menstrual irregularity in month 1, last menses week 11 (EA −5.4 kcal/kg FFM); intake, body mass/composition and EA returned to baseline by the end of the 20-wk recovery (menstrual status at end not stated in the abstract) |
| Heikura 2018 [22] | amenorrhoea prevalence 37 % in elite distance women; low BMD, bone injuries ~4.5× |
| CALERIE-2 [71] | 25 % CR, non-obese: sexual drive/relationship ↑ (ES 0.35), no negative effects |
| Esposito 2004 RCT [109] | 110 obese men (BMI ≥30) with ED, 2 y, −10 % weight goal + activity: IIEF 13.9→17.0 vs 13.5→13.6; IIEF ≥22 in 17 vs 3 men (P=0.001); ΔBMI, activity, CRP independently associated |
| Corona 2013 meta-analysis [110] | 24 studies: total testosterone rises with weight loss (low-calorie diet +2.87, 95 % CI 1.68-4.07; bariatric +8.73; units presumably nmol/L, UNVERIFIED); best predictor = degree of weight loss |
| Rossow 2013 [31]; Pardue 2017 [32] | testosterone 9.22→2.27 ng/mL (6 mo prep); 623→173 ng/dL (8 mo) — in **lean** men |
| Minnesota experiment [154][155][156] | "sexual interest drastically reduced" (Keys 1950 via secondary summary [156], UNVERIFIED primary) |

```
// premenopausal, eumenorrhoeic, not on hormonal contraception (which masks the signal). MEN = average energy deficit % of baseline needs (incl. exercise), last 3 cycles
P_LPD  = clip( 1 / (1 + exp(−0.20 · (MEN − 15))), 0.10, 0.90 )       // PROPOSED FIT to (0 %, 0.13), (8 %, 0.17), (22 %, 0.83), (42 %, 0.88): predicted 0.10 (clip), 0.20, 0.80, 0.90 (clip)
amenorrhoea_flag  = EA_c < 30 for ≥ 90 d (women)                        // consistent with [22][33][86]; time to first irregularity 4-11 wk in prep case reports
libido_flag: DOWN if (EA_c < 30 or BF% < 10 (M)/18 (F)) for ≥ 28 d (UNVERIFIED thresholds);  UP-text if BMI ≥ 30 and weight loss ≥ 5 %
```
**Grade:** menstrual dose-response **B** (one controlled trial, n=34, plus mechanistic EA data); libido **C** (self-report scales, opposite directions by adiposity).
**Verdict:** menstrual disturbance = **numeric risk (women)** used as a *constraint*; libido = **flag** (no numeric score).

### 4.10 Sleep quality as an outcome (coordinate dossier 16)

| Study | Result |
|-------|--------|
| Alfaris 2015 [104] | ≥5 % weight loss: +21.6 min sleep, PSQI −1.2 at 6 mo (n=390) |
| CALERIE-2 [71] | sleep duration improved at 12 mo (between-group −0.26 on the item scale, ES −0.32); better sleep quality ↔ greater % loss (ρ=0.28) |
| Afaghi 2008 [105] | 14 men, 48 h very-low-CHO diet: slow-wave sleep 13.9→17.8 % (P=0.02), REM % ↓ (P=0.006 acute, 0.05 ketosis) |
| Afaghi 2007 [106] | high-GI meal 4 h before bed: sleep-onset latency 9.0 vs 17.5 min (n=12); 1 h before: 14.6 min |
| St-Onge 2016 [107] | 26 adults inpatient: more fibre → more SWS; more saturated fat → less SWS; more sugar → more arousals |
| Barnard 2022 systematic review (35 studies) [108] | evening caffeine >2 mg/kg (after 17:00) ↓ duration/efficiency, ↑ latency |
| Pardue 2017 [32] | contest prep: subjective sleep quality ↓, objective actigraphy unchanged |

**Verdict: do not model sleep quality as a numeric outcome of diet.** Provide dossier 16 with inputs: caffeine timing/dose, last-meal-to-bed interval, deficit depth; show text "typically improves with ≥5 % weight loss in overweight people". **Grade C.**

### 4.11 Body temperature and cold intolerance

**Mechanism.** Chronic energy deficit lowers T3, leptin and sympathetic tone, cutting thermogenesis and core temperature; the effect is small in humans.

| Study | Result |
|-------|--------|
| Soare 2011 [112] | 24 long-term CR (6 y) vs sedentary vs exercise-matched: 24-h core temperature significantly lower in CR (~0.2 °C vs exercisers) |
| Fontana 2006 [113] | same cohort type: T3 73.6 vs 91.0 vs 94.3 ng/dL (CR −20 %); T4, rT3, TSH unchanged |
| Heilbronn 2006 [114] | 6 mo, −10 % weight: core temperature reduced in CR and CR+exercise (P<0.05; magnitude not extracted); sedentary 24-h EE −135 kcal/d beyond composition |
| Redman 2018 [115] | 2 y, ~15 % CR: EE 80-120 kcal/d below expected; thyroid-axis activity ↓; F2-isoprostane ↓ |
| Müller 2015 [116] | 32 men, 3 wk at −50 %: T3 −39 %, leptin −44 %, SNS −38 %, REE −266 kcal/d, HR −14 % |
| Pardue 2017 [32] | T3 123→40 ng/dL during 8-mo prep |

```
Tcore_off = −0.2 °C · clip( T3_drop_fraction / 0.20, 0, 1.5 )     // PROPOSED FIT: T3 −20 % ⇔ −0.2 °C [112][113]; follows T3 (dossier 12/02) with its time-constant
cold_flag = T3_drop_fraction ≥ 0.25 AND EA_c < 30 for ≥ 28 d    // thresholds PROPOSED (UNVERIFIED); subjective "feeling cold": no quantification located → qualitative
```
**Grade C** (T3 fall itself B). **Verdict: flag; optional derived ΔT (do not chart by default).**

### 4.12 Resting heart rate (RHR) and heart-rate variability (HRV)

| Study | Result |
|-------|--------|
| Reimers 2018 meta-analysis (191 studies) [117] | exercise vs control: RHR **−3.3 bpm (−4.7 %)** overall (F −3.4, M −4.3, mixed −2.6); endurance training −2.7 to −5.8 bpm; strength training n.s. (women −2.2); bigger falls with higher baseline RHR and younger age |
| Sandercock 2005 meta-analysis [118] | training: HF power d=0.48 (0.26-0.70), RR interval d=0.75 (0.51-0.96); smaller in older subjects |
| Dai 2025 meta-analysis [163] | adding exercise to intermittent fasting: RHR −2.68 bpm (−4.71…−0.64) vs IF alone |
| Müller 2015 [116] | 3 wk at −50 % energy: HR −14 %, BP −7 %, SNS activity −38 % |
| Karason 1999 [119] | 28 obese gastroplasty patients: −28 % weight at 1 y → SDANN and HF ↑, BP and noradrenaline ↓ vs weight-stable obese |
| Maunder 2021 RCT [120] | 8 trained runners, 31 d KD: waking rMSSD **−9.77±4.03 ms** (P=0.02), day-to-day variability ↑; −22 ms in the 4 with reduced exercise capacity |
| Polito 2022 RCT [121] | 26 obese, VLCKD vs LCD: HR fell in both, significant only VLCKD |

```
RHR_off = RHR_fit + RHR_en
RHR_fit = −3.3 · (1 − exp(−t_endurance/60 d)) · endurance_dose01 · (RHR0/65)          // PROPOSED FIT to [117]; τ = 60 d PROPOSED (UNVERIFIED); strength training: 0
RHR_en  = −0.14 · RHR0 · clip(deficit_frac/0.50, 0, 1.2) , relaxation τ = 10 d          // PROPOSED FIT to single trial [116] (3 wk); reflects lower SNS tone; time-constant UNVERIFIED; reverses on refeeding
HRV_off = −9.8 · A_ketosis_4wk  +  HRV_fit ,  HRV_fit ≈ +0.5 SD_rMSSD after ≥ 8 wk endurance training [118]   // KD term from n=8 [120]; grade C
```
Alcohol and poor sleep lower HRV in wearables data — dose-response **UNVERIFIED (no source fetched)**; do not model.
**Interpretation caution:** a falling RHR from energy restriction reflects reduced sympathetic tone (not fitness); a *rising* RHR/falling HRV with low EA + high load is a recognised overreaching marker but was not quantified here (UNVERIFIED).
**Grade:** RHR-from-training **B**; RHR-from-deficit **C** (one trial); HRV **C**. **Verdict: RHR numeric derived output (optional goal); HRV display-only.**

### 4.13 Breath acetone and "keto breath/odour"

| Study | Result |
|-------|--------|
| Musa-Veloso 2002 [122] | 12 healthy adults, 4 ketogenic meals/12 h: plasma AcAc, BHB and breath acetone all ↑ ~3.5×; breath acetone predicts plasma AcAc (R²=0.70) and BHB (R²=0.54) |
| Musa-Veloso 2006 [123] | children on KD: breath acetone curvilinearly related to plasma BHB (r²=0.94), AcAc (0.89) |
| Anderson 2015 review [124] | ~1 ppm in healthy non-dieting to 1250 ppm in DKA; drivers: macronutrient composition > caloric restriction > exercise; correlates with rate of fat loss |
| Kundu 1993 [125] | 78 dieters: breath acetone (nmol/L) = 15.3 + 52.2 × fat-loss rate (g/d), r=0.81 (units not cross-checked, UNVERIFIED; not used) |
| Sun 2015 [127] | healthy breath acetone 0.1-2.6 ppm (fasting 0.3-2.6) |
| Prabhakar 2015 [126] | 11 healthy: fasting-day acetone build-up higher after 79-90 % fat day; higher in those with higher REE and lower BMI |

```
Acetone_ppm = 1.0 · (BHB[mmol/L] / 0.2)        // PROPOSED FIT through (BHB 0.2 → 1 ppm) and (BHB ×3.5 → acetone ×3.5); uncertainty ×/÷3; concave at higher BHB [123]; no absolute calibration to devices
keto_breath_flag = BHB ≥ 0.5 mmol/L for ≥ 3 d      // "halitosis" is listed as a keto-induction symptom [70]; prevalence not quantified → grade D
```
**Grade C** (proxy relationship R² 0.5-0.7; device-dependent). **Verdict: display-only derived proxy; never a planner goal**; odour = flag.

### 4.14 Hydration, cramps and orthostatic symptoms (numeric water/sodium in dossier 15)

Fasting and keto-induction cause profound natriuresis/kaliuresis and diuresis, greatest on days 1-4, stopping promptly with carbohydrate; symptoms include dizziness, orthostatic hypotension, cramps, headache, constipation [70]. In a 10-day-fast metabolic study, fructose infusion
virtually abolished fasting ketosis and hyperuricaemia and significantly reduced urinary sodium loss [132]. Volek/Phinney advise 1-2 g extra sodium/day (no trial data) [70]. Hydration deficits ≥2 % BM impair attention/executive function (ES −0.28 vs −0.14) [77], mood at 1.4 % [78],
later-set resistance work at ≥2.4 % [38], endurance when ≥3 % pre-exercise [59].
```
HYD_flag: amber if acute body-water loss ≥ 2 % BM (from dossier 04/13/15 water model) OR (KI window days 1–4 AND sodium below the dossier-15 minimum); red if ≥ 3 %
```
**Grade C. Verdict: flag.**

### 4.15 Dental health, GERD, gout, kidney stones, gallstones

| Outcome | Evidence (human) | Verdict |
|---------|------------------|---------|
| Dental caries | systematic review of 55 studies: caries lower when free sugars <10 % energy (moderate-quality evidence); <5 % E relationship very-low quality [141]. Caries develops over years; frequency-of-eating effects UNVERIFIED (not fetched) | **Do not model** (time-scale mismatch); show "free sugars <10 % E" as a static guideline only |
| GERD | dinner-to-bed <3 h: OR 7.45 (3.38-16.4) vs ≥4 h (147 cases/294 controls) [128]; VLC diet (<20 g CHO/d) 6 d in 8 obese GERD pts: Johnson-DeMeester score 34.7→14.0, time pH<4 5.1→2.5 %, symptom score 1.28→0.72 [129]; effect of weight loss per se UNVERIFIED | **Flag** `late_meal_flag` if last meal ≤ 3 h before bedtime (needs bedtime from 16) — grade C |
| Gout | fasting/ketosis raise serum urate (impaired renal urate excretion; hyperuricaemia abolished by fructose) [132]; acute urate nephropathy case reports [133]; KD cohort: urate 5.69→8.41 mg/dL at 6 wk in normouricaemic PCOS women [134]; 16-wk −7.7 kg with moderate calorie/CHO restriction: urate 0.57→0.47 mmol/L, attacks 2.1→0.6/mo (n=13) [130]; systematic review: weight loss favourable long-term, short-term unfavourable effects after bariatric surgery [131] | **Flag** `gout_flag` (user history of gout/hyperuricaemia × [fast ≥ 24 h, ketosis onset, loss > 1 %/wk], first 4-8 wk); numeric urate in 06 |
| Kidney stones | LCHP diet 6 wk: urine pH −0.5, citrate −41 %, calcium +61 %, uric-acid saturation >2× [25]; KD in children: stones 6.7 % (13/195), potassium citrate 3.2 % vs 10.0 % [135]; increased fluid (≥2 L/d or urine >2.5 L/d) halves recurrence (RR 0.45; 0.39) [136][137] | **Flag** `stone_flag` (high net acid load + low urine volume, prior stone history) |
| Gallstones | risk rises exponentially above 1.5 kg/wk loss [138]; 500 kcal/d VLCD 3 mo: 152 vs 44 hospital-treated gallstone events/10,000 person-years vs 1,200-1,500 kcal/d LCD, HR 3.4 (1.8-6.3) [139]; UDCA RR 0.33 (0.18-0.60), higher-fat diets RR 0.09 (0.01-0.61; low certainty) [140] | **Flag** `gall_flag` (loss > 1.5 kg/wk or intake < 800 kcal/d ≥ 4 wk); dossier 17 owns thresholds |

**Grade C** for the flags (mixed observational, small metabolic studies) — B for gallstone rate-dependence (pooled prospective data).

### 4.16 Oxidative stress, inflammation, biological-age clocks (coordinate 06, 08)

Noted only. Two-year CR reduced F2-isoprostane [115] and improved thymopoiesis [92]; hsCRP belongs to 06; the CALERIE trial slowed the DunedinPACE pace-of-ageing measure (small effect) but not PhenoAge or GrimAge [147]. The trial horizon (2 y) exceeds
the app's 1-6-month horizon; **do not model epigenetic clocks**; IGF-1 and the Autophagy Signal Index are specified in 08.

### 4.17 Longevity and mortality from macronutrient patterns — **do not model as numeric**

| Study | Design | Finding |
|-------|--------|---------|
| Seidelmann 2018 [142] | ARIC 15,428 adults, 25 y + 7-cohort meta-analysis (432,179) | U-shape: lowest mortality at **50-55 % energy from carbohydrate**; pooled HR 1.20 (1.09-1.32) for <40 %, 1.23 (1.11-1.36) for >70 %; animal-based substitution HR 1.18, plant-based 0.82 |
| Dehghan 2017 (PURE) [143] | 135,335 adults, 18 countries, 7.4 y | highest vs lowest carbohydrate quintile HR 1.28 (1.12-1.46) total mortality; total fat HR 0.77 (0.67-0.87), saturated fat 0.86 |
| Song 2016 [144] | 131,342 US professionals | plant protein HR 0.90 per 3 % E (all-cause); animal protein HR 1.02 per 10 % E (n.s.), CV mortality 1.08 |
| Naghshi 2020 [145] | 31 cohort meta-analysis (715,128) | total protein HR 0.94 (0.89-0.99); plant protein 0.92; +3 % E plant protein ≈ −5 % risk |
| Levine 2014 [146] | NHANES III | age 50-65: high protein +75 % all-cause mortality (4× cancer death); ≥65: reduced |

**Why not modelled:** (i) single baseline food-frequency questionnaires, healthy-user and reverse-causation confounding; (ii) results contradict each other (Seidelmann: carbohydrate optimum ~50-55 %; PURE: higher carbohydrate = worse, fat = better; protein
effect reverses with age); (iii) effect depends on *food source* (animal vs plant), which the mechanistic engine does not code; (iv) time scale 7-25 years vs 1-6 months; (v) no causal RCT evidence for mortality. **Use mechanistic surrogates** (LDL/ApoB, BP, glycaemia, weight, RHR — dossiers 06/10) and show the observational U-shape only as a static "evidence note". **Grade D/C.**

### 4.18 Diet fatigue, binge risk and body-image outcomes (feeds adherence model, dossier 12)

| Study | Result |
|-------|--------|
| Minnesota experiment (Keys 1950) [154][155][156] | 36 men, 24 wk semi-starvation (~1,560 vs ~3,200 kcal/d per secondary summary [156]), ~25 % weight loss: fatigue, apathy, irritability, depression/hysteria/hypochondriasis ↑, sexual interest ↓, social withdrawal, persistent food preoccupation through rehabilitation; refeeding phase psychologically hardest (secondary summary; primary book not accessed) |
| Patton 1999 [148] | 3-y cohort of adolescent girls: severe dieters 18×, moderate dieters 5× more likely to develop an eating disorder vs non-dieters |
| Stice 2017 [149] | 1,272 body-dissatisfied young women: dieting predicted onset of bulimia/BED/purging disorder |
| Stewart 2002 [150]; Westenhoefer 2013 [151] | rigid restraint ↔ eating-disorder symptoms, mood disturbance, food/shape attentional bias, *less* weight loss; flexible restraint ↔ better maintenance (cross-sectional/observational) |
| Raymond 2002 [152] | 128 obese, VLCD programme: 56 % of BED patients no longer met BED criteria 1 y later (dieting did not worsen diagnosis in this clinical sample) |
| Byrne 2018 (MATADOR) [153] | 51 men with obesity, 16 wk at −33 %: continuous −9.1 kg vs intermittent (2-wk blocks alternating with maintenance) −14.1 kg; adjusted REE fall −749 vs −360 kJ/d |

**Rule (PROPOSED).** No numeric "binge probability". Provide dossier 12 with `restraint_depth = deficit_frac`, `duration_since_break`, `rigidity` (user-chosen fixed vs flexible schedule), so the adherence hazard can rise with depth × duration and fall after planned maintenance blocks [153][151].
Screen out/warn users with eating-disorder history and adolescents (dossier 17). **Grade C. Verdict: flag + adherence coupling.**

### 4.19 Cravings, palate adaptation, enjoyment and other outcomes

| Outcome | Evidence | Verdict |
|---------|----------|---------|
| Food cravings | 2-y RCT, n=270 obese adults: LCD vs LFD — LCD ↓ cravings for carbohydrates/starches and preferences for high-sugar/high-CHO foods; LFD ↓ cravings for high-fat foods; LCD less bothered by hunger [157] | qualitative: "cravings fall for the restricted food class over weeks-months" (B−) |
| Salt taste | 5 mo low-sodium diet: preferred salt level in soup and crackers fell; perceived intensity of salt in crackers rose [158] | text only (B−) |
| Sweet taste | 13 vs 16 adults, 3 mo replacing 40 % of energy from simple sugars: low-sugar group rated puddings ≈40 % sweeter by month 3; **pleasantness unchanged** [159] | text only (B−; small n) |
| Exercise enjoyment | no adequate source located | **do not model** (UNVERIFIED) |
| Skin colour | see 4.7 [103] | do not model |
| Caffeine as ergogenic/alertness modifier | strength ES 0.19; endurance TT −2.2 %; alertness ↑ at 40-300 mg [43][60][61][80] | input modifier (dossier 15 owns dosing); ISSN coffee position stand: 3-6 mg/kg caffeine equivalent ~60 min pre-exercise improves performance from reaction time to aerobic tasks in most but not all studies [160] |
| Iron-deficiency performance loss | VO2max g=0.61 with treatment in iron-deficient non-anaemic athletes [58] | flag only |

### 4.20 Parameter register (all numeric constants in one place)

`Basis` = source or `ASSUMPTION` (my choice, needs calibration). Ranges are the plausible band the planner's uncertainty ensemble (dossier 18) may sample.

| Symbol | Value | Unit | Uncertainty / range | Basis |
|--------|-------|------|---------------------|-------|
| EA tier limits | 45 / 30 / 15 | kcal·kgFFM⁻¹·d⁻¹ | ±3 | [16][17][20] (sedentary young women; O1) |
| τ_EAs (EA smoothing) | 3 | d | 2-5 | ASSUMPTION consistent with 3-5 d responses [16][17][18] |
| P1NP drop at EA 15 (diet-created) | 0.17 | fraction | 0.10-0.25 | [17] (54.8±12.7 → 45.2±9.3 µg/L) |
| CTX rise at EA ≤15 | 0.15 | fraction | 0.05-0.25 (n.s. in [17]) | [17][16] |
| CTX threshold EA | 20 | kcal·kgFFM⁻¹·d⁻¹ | 15-25 | [16] (NTX ↑ only at 10) |
| τ_b (bone-marker relaxation) | 2 | d | 1-5 | ASSUMPTION |
| sexF (men) | 0.5 | – | 0-1 | [18] n.s. in men, no sex difference |
| srcF (exercise-created LEA) | 0.5 | – | 0.3-1 | [17] |
| low-CHO bone term | P1NP −0.14, CTX +0.22, τ 10 d | fraction | ±50 % | [19] (grade C) |
| k_h (hip) / k_s (spine) | 0.20 / 0.13 | % BMD per % weight lost | 0.10-0.30 / 0-0.20 | [1][3][5] / [5][2] |
| mAge (≥65 or postmenopausal) | 1.5 | – | 1.0-2.0 | [4][6][8][14] (UNVERIFIED numeric) |
| ρ_RT | 0.35 | – | 0-0.67 | [4] vs [9] |
| mSrc (exercise-created deficit) | 0.25 | – | 0-0.5 | [2][3] |
| mCa (postmenopausal, Ca <1 g/d) | 1.5 | – | 1.0-3.0 | [6][7] |
| τ_bone loss / recovery | 120 / 240 | d | 60-200 / 120-480 | ASSUMPTION ([1]: ≥6 mo to see loss) |
| a_strength / a_power at EA_c 15 | 0.15 / 0.20 | fraction | 0.10-0.30 | [30][32][35][36] |
| τ_on / τ_off (M_EA) | 28 / 75 | d | 14-56 / 40-180 | ASSUMPTION ([30][31][32][33]) |
| g_lean | full ≤18 % (M) / 28 % (F); 0.3 at ≥30 % / 40 % | BF % | ±4 pp | ASSUMPTION (O1) |
| M_acute (very-low-CHO, glycolytic sets) | 0.97 | – | 0.90-1.00 | [42] (d≈−0.3) |
| TTE_75 intercept, slope | 36.8, 41.6 | min; min per g/100 g ww | r=0.92; n=9 | [46] |
| Glycogen exhaustion level | ≈25 | mmol/kg ww | – | [47] |
| In-session CHO gain (>90 min) | 0-6 (central 2-3) | % time-trial | – | [47][48] |
| dO2cost (full LCHF adaptation) | 0.065 | fraction | 0.05-0.08 | [49][50][53] |
| gI window | 0.60 → 0.70 | fraction VO2max | ±0.05 | [53] |
| τ_econ recovery | 3 | d | 1-7 | ASSUMPTION ([50]: 5-6 d for substrate use) |
| KI onset / plateau / τ | 2 d / days 2-4 / 10 d | d | ±1 / ±1 / 5-15 | [69][70] |
| Wellbeing cut-offs | tier green 0-1, amber 2-3, red ≥4 | points | – | ASSUMPTION (O13) |
| P_LPD midpoint, slope, clip | 15 %, 0.20 per %, 0.10-0.90 | % deficit | midpoint 12-18 | [21] (n=34) |
| Amenorrhoea flag | EA_c <30 for ≥90 d | d | ±30 | [22][33][86] |
| ΔT_core per T3 drop | −0.2 per −20 % | °C | ±0.1 | [112][113] |
| RHR_fit | −3.3 (τ 60 d) | bpm | −2.6…−5.8 | [117] |
| RHR_en | −0.14 × RHR0 per 50 % deficit (τ 10 d) | fraction | −0.05…−0.20 | [116] (n=32) |
| ΔrMSSD on ketogenic diet (4 wk) | −9.8 | ms | ±4.0 (SE) | [120] (n=8) |
| Acetone / BHB | 5 (= 1 ppm at 0.2 mmol/L) | ppm per mmol/L | ×/÷3 | [122][124] |
| TE timing | onset +60 d, window to +180 d | d | 45-90 / 150-210 | [100] |
| TE triggers | ≥1.0 %BW/wk ×28 d; <800 kcal/d ×14 d; protein <0.5 g/kg ×28 d | – | – | ASSUMPTION (UNVERIFIED) |
| Weight-loss-rate limits | 1.0 / 1.5 | %BW/wk | – | [28][29] (PROPOSED); gallstone 1.5 kg/wk [138] |

---------------------------------------------------------------------------------------------------------------------------------

## 5. Interactions with other subsystems

| Dossier / module | This dossier needs | This dossier gives |
|------------------|--------------------|--------------------|
| 01 body-weight model / 14 anthropometrics | FFM, FM, BF %, 14-d smoothed weight → `WL_pct`, weekly loss rate `r` | — (read-only) |
| 02 energy expenditure | exercise expenditure `EEE` (separate from RMR/NEAT), T3 drop, deficit fraction | EA definition (must use exercise-only EEE) |
| 03 protein / 09 resistance training | protein g/kg, RT sessions/wk, `Strength_RTmodel(t)` | multiplier `M_EA`, `M_acute` on strength/power; ρ_RT input for bone |
| 04 carbohydrate/glycogen | muscle glycogen (g/100 g ww ↔ mmol/kg dw), net CHO, body water | `TTE_75(G)`, repeated-sprint volume-tolerance flag |
| 05 ketosis | BHB, fat-adaptation state `A_fat`, ketosis onset day | economy penalty `dO2cost`, `Acetone`, `KI` window, HRV keto term |
| 06 cardiometabolic | serum urate, BP, net acid load (via 15) | gout/stone flags; RHR/HRV outputs |
| 07 fasting/timing/circadian | eating-window clock, last-meal time | GERD `late_meal_flag`; fasting performance notes (sprint ↓, aerobic/strength unchanged) |
| 08 autophagy/longevity | IGF-1, ASI | none; bio-age clocks not modelled here |
| 10 cardio | `I_rel` of key sessions, VO2max, EEE | `econ_factor`, `RHR_fit` |
| 12 hormones/appetite/adherence | T3, leptin, testosterone, oestradiol, hunger | `EA` tiers, `MEN`, `W_tier`, restraint depth/rigidity inputs for adherence hazard |
| 13 transitions | carbohydrate step-change timing | `KI` trigger day |
| 15 fibre/hydration/substances | fibre Δ, polyols, MCT, sodium, water, caffeine dose/timing | GI, hydration flags (thresholds owned by 15); caffeine ergogenic modifier |
| 16 sleep/stress/sex/age | sleep debt, bedtime, menopausal status, contraception | caffeine-timing and meal-to-bed inputs for sleep model; bone `mAge` |
| 17 safety guardrails | tiers | proposed hard limits (section 9) |
| 20 extended water fasting | — | For zero-intake days `EA = −EEE/FFM` (negative): clip at −5 in all formulas; 3-d smoothing damps 1-day fasts; bone/hormonal effects of 24-72 h fasts are **UNVERIFIED** here (no verified data); gout/orthostatic/refeeding flags should be extended by 20 |
| 21 intervention catalogue | — | verdicts on caffeine, sleep-low, carbohydrate periodisation (contested), keto-induction mitigation |

---------------------------------------------------------------------------------------------------------------------------------

## 6. Output metrics for the UI

### 6.1 Metrics owned by this dossier

| Metric | Unit | Direction of good | Computation | Grade | Planner use |
|--------|------|-------------------|-------------|-------|-------------|
| Energy availability (+ tier T0-T3) | kcal·kgFFM⁻¹·d⁻¹ | ≥30 (guard) | 4.1 | A/B | constraint (hard floor at EA_c ≥ 30 by default) |
| Hip BMD change | % vs baseline | ≥ −1 % | `dBMD_hip` (4.2) | B (moderators C) | constraint / optional goal "limit bone loss" |
| Spine BMD change | % | ≥ −1 % | `dBMD_spine` | C | display |
| Bone formation index P1NP_rel; resorption index CTX_rel | ratio | ↑ / ↓ | 4.2(a) | B (women), C (men, low-CHO term) | display |
| Strength capacity multiplier `M_EA` (and power) | fraction | 1.0 | 4.3 | B/C | goal via dossier 09 strength; guard |
| Endurance capacity (TTE at fixed %VO2max; TT index) | min / % | ↑ | 4.4 | A/B | goal (athlete mode) |
| Economy (O2 cost change) | % | ↓ | `dO2cost` | B | display; explains LCHF penalty |
| Power-to-weight (VO2max/kg; W/kg at threshold) | | ↑ | VO2max (10)/mass | A | goal (runner/cyclist mode) |
| Keto-induction symptom load `KI` (+ prevalence text) | 0-1 | ↓ | 4.5 | B/C | guard (avoid abrupt CHO step-downs) |
| Mood/energy risk tier | green/amber/red | green | 4.5 rubric | C | guard |
| Menstrual disturbance risk | P(≥1 LPD in 3 cycles) | ↓ | 4.9 | B | guard (women) |
| Resting heart rate offset | bpm | ↓ | 4.12 | B/C | optional goal |
| HRV (rMSSD) offset | ms | ↑ | 4.12 | C | display |
| Core-temperature offset | °C | display | 4.11 | C | display |
| Breath acetone (proxy) | ppm | display | 4.13 | C | display only |
| Flags: immune, hair-shedding, GI (bloating/stool), hydration/orthostatic, GERD late-meal, gout, stone, gallstone, libido, cold intolerance, acne (GL), keto breath | tier | green | 4.6-4.15 | C (gallstone B) | guards / info banners |

### 6.2 Master candidate list of outcome metrics for the whole app (56 candidates)

Legend — **Role**: G = usable as a planner goal; C = constraint/guard (planner must respect or warn); D = display only. **Grade**: expected evidence grade of the *engine's prediction* (A-D as in the protocol).
★ = recommended member of the **core 30**. "Owner" = dossier that specifies it (metrics owned by other dossiers are listed so the UI has one coherent catalogue; their exact definitions live there).

**Body composition**

| ID | Metric | Unit | Direction of good | Role | Grade | Owner | Core |
|----|--------|------|-------------------|------|-------|-------|------|
| M01 | Body weight (daily and 14-d smoothed) | kg | ↓ / target | G | A | 01 | ★ |
| M02 | Fat mass | kg | ↓ | G | A | 01/14 | ★ |
| M03 | Body-fat percentage | % | ↓ / target band | G | A | 14 | ★ |
| M04 | Fat-free (lean) mass | kg | ↑ / preserve | G | A | 01/03 | ★ |
| M05 | Skeletal-muscle (appendicular lean) mass | kg | ↑ | G | B | 03/09 | ★ |
| M06 | Visceral fat (with waist circumference as its measurable proxy) | L or cm²; cm | ↓ | G | B | 14/06 | ★ |
| M07 | Total body water ("water weight": glycogen-bound + sodium-driven) | kg | display / explain scale noise | D | B | 04/13/15 | |

**Fuel & metabolism**

| ID | Metric | Unit | Direction of good | Role | Grade | Owner | Core |
|----|--------|------|-------------------|------|-------|-------|------|
| M08 | Muscle glycogen | % of max / mmol·kg⁻¹ dw | context (↑ for performance) | G | A/B | 04 | ★ |
| M09 | Liver glycogen | g | display | D | B | 04 | |
| M10 | Blood β-hydroxybutyrate and ketosis state (incl. hours/day ≥0.5 mmol/L) | mmol/L; h/d | target (↑ if ketosis is the goal) | G | A | 05 | ★ |
| M11 | Whole-body fat oxidation | g/d; g/min | ↑ (display) | D | A/B | 05 | |
| M12 | Glycaemia: mean/fasting glucose (and HbA1c) | mmol/L; % | ↓ within normal range | G | A/B | 04/06 | ★ |
| M13 | Insulin sensitivity (HOMA-IR/Matsuda-type; fasting insulin) | index | ↑ | G | A | 04/06 | ★ |
| M14 | Resting metabolic rate/TDEE and metabolic adaptation | kcal/d; % of predicted | preserve | G | A | 02 | ★ |
| M15 | Autophagy Signal Index | 0-1 relative | ↑ (contested value) | G | D/C | 08 | ★ |
| M16 | Breath acetone (BHB proxy) | ppm | display | D | C | 19 | |

**Hormones**

| ID | Metric | Unit | Direction of good | Role | Grade | Owner | Core |
|----|--------|------|-------------------|------|-------|-------|------|
| M17 | Leptin | % of baseline | avoid deep fall | C | B | 12 | ★ |
| M18 | Thyroid T3 | % of baseline | avoid deep fall | C | A/B | 12/02 | ★ |
| M19 | Reproductive hormones (testosterone in men; oestradiol/cycle function in women) | % of baseline | preserve | C | B | 12/19 | ★ |
| M20 | Cortisol | % of baseline | ↓ (display) | D | C | 12 | |
| M21 | IGF-1 | % of baseline | user-chosen (longevity ↓ vs muscle ↑) | G | B | 08 | |

**Cardiometabolic**

| ID | Metric | Unit | Direction of good | Role | Grade | Owner | Core |
|----|--------|------|-------------------|------|-------|-------|------|
| M22 | LDL-C / ApoB | mg/dL | ↓ | G | A | 06 | ★ |
| M23 | HDL-C | mg/dL | ↑ | G | A | 06 | |
| M24 | Triglycerides | mg/dL | ↓ | G | A | 06 | ★ |
| M25 | Blood pressure (SBP/DBP) | mmHg | ↓ | G | A | 06 | ★ |
| M26 | Liver fat | % | ↓ | G | B | 06 | |
| M27 | hsCRP | mg/L | ↓ | G | B | 06 | ★ |
| M28 | Serum urate | mg/dL | ↓ (guard) | C | B | 06/19 | |
| M29 | Resting heart rate | bpm | ↓ | G | B/C | 19/10 | ★ |
| M30 | Heart-rate variability (rMSSD) | ms | ↑ | D | C | 19 | |

**Performance**

| ID | Metric | Unit | Direction of good | Role | Grade | Owner | Core |
|----|--------|------|-------------------|------|-------|-------|------|
| M31 | VO2max | mL·kg⁻¹·min⁻¹ | ↑ | G | A | 10 | ★ |
| M32 | Strength (composite relative e1RM / strength index) | % of baseline; kg/kg BW | ↑ | G | A/B | 09/19 | ★ |
| M33 | Muscle power (jump / Wingate proxy) | W/kg | ↑ | G | B/C | 09/19 | |
| M34 | Endurance capacity (TTE at fixed %VO2max; time-trial index) | min; % | ↑ | G | A/B | 19/10 | ★ |
| M35 | Power-to-weight (W/kg at threshold; VO2max/kg) | W/kg | ↑ | G | A | 10/19 | |
| M36 | Economy (O2 cost at race pace) | % change | ↓ | D | B | 19/10 | |

**Wellbeing**

| ID | Metric | Unit | Direction of good | Role | Grade | Owner | Core |
|----|--------|------|-------------------|------|-------|-------|------|
| M37 | Hunger (VAS) | 0-100 | ↓ | G | B | 12 | ★ |
| M38 | Adherence probability / diet-fatigue | % | ↑ | G (as constraint) | C | 12/19 | ★ |
| M39 | Mood & energy risk tier | green/amber/red | green | C | C | 19 | ★ |
| M40 | Keto-induction symptom load | 0-1; expected % symptomatic | ↓ | C | B/C | 19/05 | |
| M41 | Sleep quality (modifier more than outcome) | index | ↑ | D | C | 16 | |
| M42 | Libido / sexual-function flag | tier | – | D | C | 19 | |
| M43 | GI comfort flags (bloating, stool bulk) | tier | green | C | C | 15/19 | |
| M44 | Cravings / palate adaptation | text | – | D | B− | 19 | |

**Cellular & longevity**

| ID | Metric | Unit | Direction of good | Role | Grade | Owner | Core |
|----|--------|------|-------------------|------|-------|-------|------|
| M45 | Biological-age pace (DunedinPACE-type) | ratio | ↓ | D | B (2-y CR) / D (short horizon) | 08 | |
| M46 | Oxidative stress (F2-isoprostane) | relative | ↓ | D | C | 08 | |

**Safety**

| ID | Metric | Unit | Direction of good | Role | Grade | Owner | Core |
|----|--------|------|-------------------|------|-------|-------|------|
| M47 | Energy availability and RED-S tier | kcal·kgFFM⁻¹·d⁻¹ | ≥30 | C | A/B | 19/17 | ★ |
| M48 | Hip BMD change | % | ≥ −1 | C (optional G) | B | 19 | ★ |
| M49 | Bone turnover balance (P1NP, CTX) | ratio | display | D | B | 19 | |
| M50 | Menstrual disturbance risk (women) | % per 3 cycles | ↓ | C | B | 19 | ★ |
| M51 | Rapid-loss / gallstone risk | tier | green | C | B | 17/19 | ★ |
| M52 | Hydration/electrolyte (orthostatic-cramp) flag | tier | green | C | C | 15/19 | |
| M53 | Kidney-stone and gout-flare flags | tier | green | C | C | 19/06 | |
| M54 | Hair-shedding risk (delayed) | tier | green | D | C | 19 | |
| M55 | Illness/immune-risk flag | tier | green | D | C | 19 | |
| M56 | Refeeding risk after ≥3-5-day fasts | tier | green | C | B | 20/17 | |

### 6.3 Recommended "core 30" (★ above) and how to use it

Body composition 6 (M01-M06) · fuel/metabolism 6 (M08, M10, M12, M13, M14, M15) · hormones 3 (M17-M19) · cardiometabolic 5 (M22, M24, M25, M27, M29) · performance 3 (M31, M32, M34) · wellbeing 3 (M37-M39) · safety 4 (M47, M48, M50, M51) = **30**.
Rationale: the core set has (i) at least grade-B prediction quality for every metric except the autophagy index (kept because the user explicitly wants it; label D/C); (ii) one metric per physiological question; (iii) the safety guards the planner must always evaluate.
**Not recommended for the core, and why:** cognition score, mortality/longevity, dental, infection incidence, exercise enjoyment, nail/skin quality (section 8); HRV, acetone, core temperature (proxies with weak calibration); bone turnover indices (advanced view).
**Planner conflict notes** (for dossier 18): goals that compete — muscle gain (M05) vs. deep deficit; ketosis (M10) vs. high-intensity endurance (M34: economy penalty) and vs. bone turnover in heavy training (C); autophagy (M15) vs. muscle (M05, see 08); fat loss speed (M02) vs. menstrual/bone/mood guards (M47, M48, M50, M39); glycogen (M08) vs. ketosis (M10).

---------------------------------------------------------------------------------------------------------------------------------

## 7. Validation targets

Tolerances are suggestions for unit tests (engine output vs published value).

| # | Study (subjects, intervention, duration) | Published result | Engine output to check | Tolerance |
|---|------------------------------------------|------------------|------------------------|-----------|
| V1 | Bergström 1967 [46]: 9 men, cycling at 75 % VO2max to exhaustion after 3 d P / M / C diets | glycogen 0.63 / 1.75 / 3.31 g/100 g ww ↔ TTE 56.9 / 113.6 / 166.5 min; TTE = 41.6·G + 36.8 | `TTE_75(G)` | ±10 min |
| V2 | Burke 2017 [49]: 29 elite race walkers, 3 wk intensified training, LCHF vs HCHO (iso-energetic) | 10-km time: HCHO 6.6 % faster, LCHF 1.6 % slower; O2 cost at 20-km pace: HCHO fell (CI midpoint ≈ −4.8 pp) vs ~0 (LCHF); peak fat oxidation 1.57 g/min | LCHF − HCHO performance gap ≈ 8 pp; `dO2cost` ≈ 5-6.5 % at I_rel ≥ 0.7 | ±3 pp |
| V3 | Burke 2021 [50]: 13 race walkers, 5-6 d LCHF, washout 5-6 d HCHO | O2 cost +5 % (20-km pace), +8 % (50-km pace); 6/7 slower; substrate use restored after 5-6 d | `A_econ` reaches ≥0.8 within 6 d; falls ≤0.2 within 6 d of HCHO | ±3 pp |
| V4 | Shaw 2019 [53]: 8 trained men, 31-d KD | efficiency preserved <60 % VO2max, impaired >70 %; TTE 239→219 min (n.s.) | `gI`=0 at I_rel 0.55, =1 at 0.75 | qualitative |
| V5 | CALERIE-2 bone [5]: n=218, age 38, BMI 25, −7.5 kg over 2 y | hip −0.017 g/cm² (≈ −1.7 %), spine −0.013 (≈ −1.3 %), FN −0.015; CTX +0.098 µg/L at 12 mo | `dBMD_hip` ≈ −1.5 to −2.0 % when `WL_pct` ≈ 10 (mAge 1, mRT 1) | ±0.7 pp |
| V6 | Villareal 2006 [3]: n=48, age 57, BMI 27, 1 y: CR −10.7 % vs exercise −8.4 % | CR hip −2.2±3.1 %; EX no decrease | CR arm: −2 to −2.5 %; exercise-deficit arm (`mSrc` 0.25): ≈ −0.5 % | ±1 pp |
| V7 | Papageorgiou 2018 [17]: 10 active women, 3 d EA 15 (diet vs exercise) vs 45 | P1NP −17 % (diet), −8 % n.s. (exercise); CTX +15 % n.s. | `P1NP_rel` 0.83 ± 0.05 (diet), 0.915 (exercise) at day 3-5 | ±5 pp |
| V8 | Williams 2015 [21]: 3 cycles, deficits 0 / −8 / −22 / −42 % | P(≥1 LPD) 0.13 / 0.17 / 0.83 / 0.88 | `P_LPD` | ±0.15 |
| V9 | Murphy & Koehler 2022 [27] / Longland 2016 [34]: RT + ≈500 kcal/d deficit | strength gain preserved (ES 0.84 vs 0.81); lean-mass gain ≈0 | `M_EA` = 1.0 (EA_c ≥ 30); dossier 09/03 lean-mass gain ≈0 at −500 kcal/d | strength within ±5 % |
| V10 | Nindl 2007 [30]: 50 lean soldiers, 8 wk, ≈ −1000 kcal/d | BM −13 %, FFM −6 %; strength −20 %, power −21 %, jump −16 % | with EA_c ≈ 10-20, BF 14.7 %, `M_EA` ≈ 0.80-0.90 at 8 wk | ±7 pp |
| V11 | Rossow 2013 [31] (drug-free bodybuilder, 6 mo prep, then 6 mo recovery) | TMD 6→43→4; testosterone 9.22→2.27→9.91 ng/mL; strength not fully recovered | `W_tier` red in late prep; green after ≥6 mo; M_EA recovers with τ_off 75 d (ok for ≥85 % at 6 mo) | qualitative |
| V12 | CALERIE-2 QoL [71]: 25 % CR target, 2 y | mood ES −0.35, tension ES −0.39, general health ES 0.75, sexual drive ES 0.35 | `W_tier` green throughout at EA_c ≥ 30 and BF above the leanness gate | qualitative |
| V13 | Maunder 2021 [120] (8 runners, 31 d KD) and Reimers 2018 [117] | rMSSD −9.8 ms; exercise RHR −3.3 bpm | `HRV_off` ≈ −10 ms at 4 wk; `RHR_fit` ≈ −3 bpm after ~3-4 mo of endurance training | ±3 ms / ±1.5 bpm |

---------------------------------------------------------------------------------------------------------------------------------

## 8. Myths / contested claims

| Claim | What the evidence says | Model consequence |
|-------|-----------------------|-------------------|
| "Ketosis gives mental clarity and energy" | Weight-loss RCTs: ketogenic ≈ non-ketogenic for attention/working memory; trail-making worse in week 1 [66]; speed of processing improved *less* on LCHF (P=0.04) [67]; mood better on HCLF at 1 y [68]; induction symptoms in 10-25 % for 2-4 wk [70]. Positive signals: 23 older adults with MCI (verbal memory) [82]; exogenous-ketone meta-analysis SMD 0.29 — supplements, mainly acute, not dietary ketosis [83] | No cognitive bonus for ketosis; model induction penalty window only |
| "Fasting sharpens the mind" / "fasting causes brain fog" | Systematic review: equivocal, task-specific [63]; 28-d Ramadan-type: no cognitive change, afternoon mood dip, more hunger [64]; IF: no clear cognitive benefit in healthy adults [84] | neither effect modelled; show hunger/mood dip text |
| "Fat-adapted athletes recover normal glycogen and performance" | Chronic LC ultra-runners had equal resting glycogen and depletion [52], yet elite walkers lost economy and race performance after 5-6 d and 3 wk [49][50]; TTE at 70 % VO2max preserved in runners but efficiency worse above 70 % [53]; 13 endurance outcomes: 3 lower, 10 no difference [41] | economy penalty gated by intensity; no glycogen "normalisation" assumed beyond dossier 04/05 |
| "Sleep-low / train-low is proven to improve endurance" | One RCT (n=21) +2.9 % 10-km [54]; periodised models not shown superior to guidelines [51] | contested preset only |
| "Weight loss inevitably wrecks bone" / "it is harmless" | Both wrong: ≈1-2 % hip BMD per ~10 % loss in mid-age adults [3][5], more in older/postmenopausal [4][6], none in obese premenopausal women [8]; but formation is suppressed within 3-5 d at low EA [16][17] and hip loss appears from ~6 mo [1] | age/EA/RT-dependent numeric model |
| "Resistance training protects bone during weight loss" | Villareal 2011: hip −3 % → −1 % with exercise [4]; Beavers 2025: neither RT nor vest prevented trabecular loss [9]; exercise-*induced* loss spares bone [2][3] | wide ρ_RT range (0-0.67) |
| "High protein / acid load leaches calcium and hurts bone" | LCHP metabolic study: urinary Ca +61 %, citrate −41 %, Ca balance −130 mg/d [25]; but meta-analysis of 16 RCTs: no adverse BMD effects, LS-BMD +0.52 % [11] | protein positive/neutral for BMD; acid load → stone flag, not BMD penalty |
| "Vitamin D supplements protect bone/muscle during dieting" | 2000 IU/d: no BMD or lean-mass benefit, leg strength slightly lower [12]; raises Ca absorption [13] | no vitamin-D BMD term |
| "Exercise suppresses immunity (open window)" | limited reliable evidence; redistribution not suppression; infection multifactorial [89][90]; active people have 43 % fewer URTI days (observational) [88] | no exercise-immune penalty; LEA flag only |
| "Hair loss on a diet = need biotin/protein powder" | TE follows rapid loss/caloric restriction by 2-3 mo and remits in ~95 %; supplements not helpful without documented deficiency [100][101] | timeline flag only |
| "Low-carb always causes constipation / keto flu is 'detox'" | adult constipation 1-27 % (68 vs 35 % in one trial; another RCT found no symptom difference) [70][96]; keto-flu mechanism plausibly natriuresis/hypovolaemia (days 1-4) [70] | flags, sodium/fluid advice via 15 |
| "Skipping breakfast wrecks focus" | small memory advantage (delayed recall) from breakfast; attention equivocal [79] | none |
| "Low-GI meals prevent energy crashes" | 11 studies inconsistent [81] | none |
| "There is an optimal macronutrient split for lifespan" | contradictory observational U-shapes/monotonic trends [142][143][144][145][146] | do not model |
| "Dieting causes eating disorders" / "dieting is harmless" | severe dieting predicts onset in adolescent girls (18×) and high-risk young women [148][149]; but 56 % of BED patients lost the diagnosis 1 y after a VLCD programme [152]; rigid restraint is the risky pattern, flexible restraint is not [150][151] | flags + adherence coupling; screen high-risk users |
| "Ketone breath = fat-loss rate" | R² 0.54-0.70 vs blood ketones in adults; device/lung dependent; correlates with fat-loss rate r=0.81 in one dieting study [122][125] | display proxy only |

---------------------------------------------------------------------------------------------------------------------------------

## 9. Safety bounds relevant to this topic (proposed; dossier 17 is authoritative)

| Bound | Value | Basis |
|-------|-------|-------|
| Energy availability floor for *prescribed* plans | EA_c ≥ 30 kcal/kg FFM/d (14-d mean); ≥45 recommended in heavy-training blocks; simulator may go lower with red banner | [16][20][22][23][24] |
| Severe-LEA red zone | EA_c < 15 for ≥ 14 d | [17][18] |
| Weekly weight-loss rate | ≤1 %BW/wk default (0.5-1 % advised); amber 1.0-1.5; red >1.5 %/wk; ≤1.5 kg/wk absolute | [28][29][138] |
| Very-low-energy diets | <800 kcal/d only with explicit warning (gallstones ×3.4 vs LCD at 500 kcal/d; hair, cold, mood flags) | [139] |
| Muscle-gain goals | deficit ≤ ~500 kcal/d | [27] |
| Premenopausal women (not on hormonal contraception) | average deficit ≥ ~20 % of needs with exercise for >1-2 cycles ⇒ P_LPD > 0.5: warn; > 0.8: red | [21] |
| Bone | warn if projected `dBMD_hip` < −2 % (proposed); older/postmenopausal: require RT, calcium ≥1.0-1.2 g/d, protein ≥1.2 g/kg/d, vitamin D adequacy | [4][6][10][13] |
| Intentional dehydration / "water cutting" | avoid >2 % BM before training/competition; never for physique "peaking" | [29][38][59][77] |
| Keto-induction | flag abrupt CHO step-down; electrolyte guidance from 15; exclude users with contraindications (17) | [70] |
| Kidney stones | fluid to keep urine >2 L/d (≥2.5 L urine in prior stone formers); warn on LCHP/KD with stone history | [25][135][136][137] |
| Gout | warn if gout/hyperuricaemia history and fast ≥24 h, ketosis onset or rapid loss | [130][132][134] |
| Eating-disorder history, adolescents | block deficit plans; show restraint warnings | [148][149] |
| Endurance events | avoid starting very-low-CHO within ≥6 wk of key high-intensity events; 24 h CHO restoration does not restore performance | [49][50] |

---------------------------------------------------------------------------------------------------------------------------------

## 10. Open questions / weakest assumptions

- **O1 EA outside its validation range.** The 30 kcal/kg FFM threshold was found in normal-weight, sedentary young women over 5 days [20]. In people with high fat mass the same EA per kg FFM clearly does not produce the same clinical picture (obese adults in deficit gain strength and function [4][34][27]). The leanness gate `g_lean` (BF ≤18 % men/≤28 % women full effect; ×0.3 at ≥30/40 %) is my assumption, **UNVERIFIED**; it is the largest structural uncertainty for strength, mood, immune and libido flags.
- **O2 Time constants** for strength-penalty onset (28 d) and recovery (75 d), bone-marker recovery (2 d), economy recovery (3 d) and RHR relaxation (10 d) are assumptions consistent with sparse data (Nindl 8 wk; Rossow/Pardue/Hulmi recovery 3-13 mo; Burke wash-out 5-6 d).
- **O3 Bone after regain/refeeding** — no verified human data on BMD recovery; asymmetry (τ 120 vs 240 d) is a guess.
- **O4 RT protection** — contested (ρ_RT 0-0.67). **O5 calcium/vitamin D** numeric modifiers rest on two postmenopausal RCTs [6][7] and are qualitative in the engine.
- **O6 Men and low EA** — bone-marker and hormonal responses were non-significant in small samples [18][111]; `sexF=0.5` is a compromise.
- **O7 Keto and bone** — only 3.5-wk marker data in 30 elite athletes [19]; no BMD outcome; mechanism unresolved.
- **O8 Economy penalty** — data are elite race walkers (mostly male) plus 8-9-subject crossovers [49][50][53][62]; recreational athletes, women, longer adaptation (>3 wk) not established; a 2026 vote-count review claims recovery after 1 wk but is low quality and contradicts primary RCTs [162].
- **O9 RHR/HRV** — deficit effect rests on one 3-wk trial (n=32) [116]; keto HRV on n=8 [120]; overreaching-related RHR rises not quantified.
- **O10 Hair-loss thresholds** — no dose-response found; incidence numbers come from a review abstract [102].
- **O11 Cognition** — heterogeneous tests; no validated mapping from diet inputs to test scores → rejected as numeric.
- **O12 Menstrual model** — one RCT (n=34, untrained women); deficit defined as % of needs (not EA); hormonal contraception masks; trained/older women unknown [21].
- **O13 Wellbeing rubric** is a transparent heuristic, unvalidated; needs user testing and calibration against dossier 12 hunger/adherence.
- **O14 Multi-day fasting** (24-72 h+) effects on bone, immune function, mood and gout were not covered by verified data here → dossier 20.
- **O15 Minnesota details** (kcal, psychology) come from a secondary summary [156]; the primary 1950 monograph was not accessed.
- **O16 Recency.** Several 2025-2026 papers (e.g., [10][15][26][42][83][102][162]) are recent with few citations; treat as preliminary.

---------------------------------------------------------------------------------------------------------------------------------

## 11. References

Format: `[n] citation. PMID; DOI; URL`. All PMIDs/DOIs were checked programmatically against PubMed (E-utilities) on 2026-09-30. Full texts (or full-text pages) were opened for [5], [19], [21], [46] (scanned page images), [70], [100], [112], [117] and the secondary page in [156]; every other number comes from the PubMed/Europe PMC abstract of the cited paper.

[1] Zibellini J, Seimon RV, Lee CM, et al. Does diet-induced weight loss lead to bone loss in overweight or obese adults? A systematic review and meta-analysis of clinical trials. J Bone Miner Res 2015;30:2168-2178.; PMID 26012544; DOI 10.1002/jbmr.2564; https://pubmed.ncbi.nlm.nih.gov/26012544/
[2] Soltani S, Hunter GR, Kazemi A, Shab-Bidar S. The effects of weight loss approaches on bone mineral density in adults: a systematic review and meta-analysis of randomized controlled trials. Osteoporos Int 2016.; PMID 27154437; DOI 10.1007/s00198-016-3617-4; https://pubmed.ncbi.nlm.nih.gov/27154437/
[3] Villareal DT, Fontana L, Weiss EP, et al. Bone mineral density response to caloric restriction-induced weight loss or exercise-induced weight loss: a randomized controlled trial. Arch Intern Med 2006;166:2502-2510.; PMID 17159017; DOI 10.1001/archinte.166.22.2502; https://pubmed.ncbi.nlm.nih.gov/17159017/
[4] Villareal DT, Chode S, Parimi N, et al. Weight loss, exercise, or both and physical function in obese older adults. N Engl J Med 2011;364:1218-1229.; PMID 21449785; DOI 10.1056/NEJMoa1008234; https://pubmed.ncbi.nlm.nih.gov/21449785/
[5] Villareal DT, Fontana L, Das SK, et al. Effect of two-year caloric restriction on bone metabolism and bone mineral density in non-obese younger adults: a randomized clinical trial (CALERIE). J Bone Miner Res 2016. (PMC4834845); PMID 26332798; DOI 10.1002/jbmr.2701; https://pubmed.ncbi.nlm.nih.gov/26332798/
[6] Riedt CS, Cifuentes M, Stahl T, et al. Overweight postmenopausal women lose bone with moderate weight reduction and 1 g/day calcium intake. J Bone Miner Res 2005.; PMID 15746990; DOI 10.1359/JBMR.041132; https://pubmed.ncbi.nlm.nih.gov/15746990/
[7] Ricci TA, Chowdhury HA, Heymsfield SB, et al. Calcium supplementation suppresses bone turnover during weight reduction in postmenopausal women. J Bone Miner Res 1998.; PMID 9626637; DOI 10.1359/jbmr.1998.13.6.1045; https://pubmed.ncbi.nlm.nih.gov/9626637/
[8] Shapses SA, Von Thun NL, Heymsfield SB, et al. Bone turnover and density in obese premenopausal women during moderate weight loss and calcium supplementation. J Bone Miner Res 2001.; PMID 11450709; DOI 10.1359/jbmr.2001.16.7.1329; https://pubmed.ncbi.nlm.nih.gov/11450709/
[9] Beavers KM, Lynch SD, Fanning J, et al. Weighted vest use or resistance exercise to offset weight loss-associated bone loss in older adults: a randomized clinical trial. JAMA Netw Open 2025.; PMID 40540267; DOI 10.1001/jamanetworkopen.2025.16772; https://pubmed.ncbi.nlm.nih.gov/40540267/
[10] Weaver AA, Greene KA, Leng X, et al. Effect of protein supplementation on hip bone mineral density, cortical thickness, and bone strength in older adults during a caloric restriction and aerobic exercise weight loss intervention: a randomized controlled trial. Osteoporos Int 2026.; PMID 41553490; DOI 10.1007/s00198-026-07845-6; https://pubmed.ncbi.nlm.nih.gov/41553490/
[11] Shams-White MM, Chung M, Du M, et al. Dietary protein and bone health: a systematic review and meta-analysis from the National Osteoporosis Foundation. Am J Clin Nutr 2017.; PMID 28404575; DOI 10.3945/ajcn.116.145110; https://pubmed.ncbi.nlm.nih.gov/28404575/
[12] Mason C, Tapsoba JD, Duggan C, et al. Effects of vitamin D3 supplementation on lean mass, muscle strength, and bone mineral density during weight loss: a double-blind randomized controlled trial. J Am Geriatr Soc 2016.; PMID 27060050; DOI 10.1111/jgs.14049; https://pubmed.ncbi.nlm.nih.gov/27060050/
[13] Shapses SA, Sukumar D, Schneider SH, et al. Vitamin D supplementation and calcium absorption during caloric restriction: a randomized double-blind trial. Am J Clin Nutr 2013.; PMID 23364004; DOI 10.3945/ajcn.112.044909; https://pubmed.ncbi.nlm.nih.gov/23364004/
[14] Shapses SA, Riedt CS. Bone, body weight, and weight reduction: what are the concerns? J Nutr 2006;136:1453-1456.; PMID 16702302; DOI 10.1093/jn/136.6.1453; https://pubmed.ncbi.nlm.nih.gov/16702302/
[15] Shapses SA, McGuire BD. Why do we lose bone during weight loss: can it be prevented? Curr Osteoporos Rep 2026.; PMID 42714789; DOI 10.1007/s11914-026-00984-z; https://pubmed.ncbi.nlm.nih.gov/42714789/
[16] Ihle R, Loucks AB. Dose-response relationships between energy availability and bone turnover in young exercising women. J Bone Miner Res 2004;19:1231-1240.; PMID 15231009; DOI 10.1359/jbmr.040410; https://pubmed.ncbi.nlm.nih.gov/15231009/
[17] Papageorgiou M, Martin D, Colgan H, et al. Bone metabolic responses to low energy availability achieved by diet or exercise in active eumenorrheic women. Bone 2018;114:181-188.; PMID 29933113; DOI 10.1016/j.bone.2018.06.016; https://pubmed.ncbi.nlm.nih.gov/29933113/
[18] Papageorgiou M, Elliott-Sale KJ, Parsons A, et al. Effects of reduced energy availability on bone metabolism in women and men. Bone 2017;105:191-199.; PMID 28847532; DOI 10.1016/j.bone.2017.08.019; https://pubmed.ncbi.nlm.nih.gov/28847532/
[19] Heikura IA, Burke LM, Hawley JA, et al. A short-term ketogenic diet impairs markers of bone health in response to exercise. Front Endocrinol 2019;10:880 (2020).; PMID 32038477; DOI 10.3389/fendo.2019.00880; https://pubmed.ncbi.nlm.nih.gov/32038477/
[20] Loucks AB, Thuma JR. Luteinizing hormone pulsatility is disrupted at a threshold of energy availability in regularly menstruating women. J Clin Endocrinol Metab 2003;88:297-311.; PMID 12519869; DOI 10.1210/jc.2002-020369; https://pubmed.ncbi.nlm.nih.gov/12519869/
[21] Williams NI, Leidy HJ, Hill BR, et al. Magnitude of daily energy deficit predicts frequency but not severity of menstrual disturbances associated with exercise and caloric restriction. Am J Physiol Endocrinol Metab 2015. (PMC4281686); PMID 25352438; DOI 10.1152/ajpendo.00386.2013; https://pubmed.ncbi.nlm.nih.gov/25352438/
[22] Heikura IA, Uusitalo ALT, Stellingwerff T, et al. Low energy availability is difficult to assess but outcomes have large impact on bone injury rates in elite distance athletes. Int J Sport Nutr Exerc Metab 2018.; PMID 29252050; DOI 10.1123/ijsnem.2017-0313; https://pubmed.ncbi.nlm.nih.gov/29252050/
[23] Mountjoy M, Sundgot-Borgen JK, Burke LM, et al. IOC consensus statement on relative energy deficiency in sport (RED-S): 2018 update. Br J Sports Med 2018.; PMID 29773536; DOI 10.1136/bjsports-2018-099193; https://pubmed.ncbi.nlm.nih.gov/29773536/
[24] De Souza MJ, Nattiv A, Joy E, et al. 2014 Female Athlete Triad Coalition consensus statement on treatment and return to play of the Female Athlete Triad. Br J Sports Med 2014.; PMID 24463911; DOI 10.1136/bjsports-2013-093218; https://pubmed.ncbi.nlm.nih.gov/24463911/
[25] Reddy ST, Wang CY, Sakhaee K, et al. Effect of low-carbohydrate high-protein diets on acid-base balance, stone-forming propensity, and calcium metabolism. Am J Kidney Dis 2002.; PMID 12148098; DOI 10.1053/ajkd.2002.34504; https://pubmed.ncbi.nlm.nih.gov/12148098/
[26] Mullath Ullas A, Boamah J, Hussain A, et al. Impact of dietary patterns on skeletal health: a systematic review and meta-analysis. Nutrients 2025.; PMID 41470790; DOI 10.3390/nu17243845; https://pubmed.ncbi.nlm.nih.gov/41470790/
[27] Murphy C, Koehler K. Energy deficiency impairs resistance training gains in lean mass but not strength: a meta-analysis and meta-regression. Scand J Med Sci Sports 2022.; PMID 34623696; DOI 10.1111/sms.14075; https://pubmed.ncbi.nlm.nih.gov/34623696/
[28] Garthe I, Raastad T, Refsnes PE, et al. Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes. Int J Sport Nutr Exerc Metab 2011.; PMID 21558571; DOI 10.1123/ijsnem.21.2.97; https://pubmed.ncbi.nlm.nih.gov/21558571/
[29] Helms ER, Aragon AA, Fitschen PJ. Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation. J Int Soc Sports Nutr 2014;11:20.; PMID 24864135; DOI 10.1186/1550-2783-11-20; https://pubmed.ncbi.nlm.nih.gov/24864135/
[30] Nindl BC, Barnes BR, Alemany JA, et al. Physiological consequences of U.S. Army Ranger training. Med Sci Sports Exerc 2007.; PMID 17762372; DOI 10.1249/MSS.0b013e318067e2f7; https://pubmed.ncbi.nlm.nih.gov/17762372/
[31] Rossow LM, Fukuda DH, Fahs CA, et al. Natural bodybuilding competition preparation and recovery: a 12-month case study. Int J Sports Physiol Perform 2013;8:582-592.; PMID 23412685; DOI 10.1123/ijspp.8.5.582; https://pubmed.ncbi.nlm.nih.gov/23412685/
[32] Pardue A, Trexler ET, Sprod LK. Case study: unfavorable but transient physiological changes during contest preparation in a drug-free male bodybuilder. Int J Sport Nutr Exerc Metab 2017.; PMID 28770669; DOI 10.1123/ijsnem.2017-0064; https://pubmed.ncbi.nlm.nih.gov/28770669/
[33] Hulmi JJ, Isola V, Suonpaa M, et al. The effects of intensive weight reduction on body composition and serum hormones in female fitness competitors. Front Physiol 2016;7:689.; PMID 28119632; DOI 10.3389/fphys.2016.00689; https://pubmed.ncbi.nlm.nih.gov/28119632/
[34] Longland TM, Oikawa SY, Mitchell CJ, et al. Higher compared with lower dietary protein during an energy deficit combined with intense exercise promotes greater lean mass gain and fat mass loss: a randomized trial. Am J Clin Nutr 2016.; PMID 26817506; DOI 10.3945/ajcn.115.119339; https://pubmed.ncbi.nlm.nih.gov/26817506/
[35] Tornberg AB, Melin A, Koivula FM, et al. Reduced neuromuscular performance in amenorrheic elite endurance athletes. Med Sci Sports Exerc 2017.; PMID 28723842; DOI 10.1249/MSS.0000000000001383; https://pubmed.ncbi.nlm.nih.gov/28723842/
[36] Vanheest JL, Rodgers CD, Mahoney CE, et al. Ovarian suppression impairs sport performance in junior elite female swimmers. Med Sci Sports Exerc 2014.; PMID 23846160; DOI 10.1249/MSS.0b013e3182a32b72; https://pubmed.ncbi.nlm.nih.gov/23846160/
[37] Melin AK, Areta JL, Heikura IA, et al. Direct and indirect impact of low energy availability on sports performance. Scand J Med Sci Sports 2024.; PMID 36894187; DOI 10.1111/sms.14327; https://pubmed.ncbi.nlm.nih.gov/36894187/
[38] Judelson DA, Maresh CM, Farrell MJ, et al. Effect of hydration state on strength, power, and resistance exercise performance. Med Sci Sports Exerc 2007.; PMID 17909410; DOI 10.1249/mss.0b013e3180de5f22; https://pubmed.ncbi.nlm.nih.gov/17909410/
[39] Abaidia AE, Daab W, Bouzid MA. Effects of Ramadan fasting on physical performance: a systematic review with meta-analysis. Sports Med 2020.; PMID 31960369; DOI 10.1007/s40279-020-01257-0; https://pubmed.ncbi.nlm.nih.gov/31960369/
[40] Cholewa JM, Newmire DE, Zanchi NE. Carbohydrate restriction: friend or foe of resistance-based exercise performance? Nutrition 2019.; PMID 30586657; DOI 10.1016/j.nut.2018.09.026; https://pubmed.ncbi.nlm.nih.gov/30586657/
[41] Murphy NE, Carrigan CT, Margolis LM. High-fat ketogenic diets and physical performance: a systematic review. Adv Nutr 2021.; PMID 32865567; DOI 10.1093/advances/nmaa101; https://pubmed.ncbi.nlm.nih.gov/32865567/
[42] Gawelczyk M, Chycki J, Maszczyk A, Zajac A. Effects of low-carbohydrate and ketogenic diets on anaerobic performance in competitive athletes: a systematic review and meta-analysis. Nutrients 2026.; PMID 42197050; DOI 10.3390/nu18101589; https://pubmed.ncbi.nlm.nih.gov/42197050/
[43] Warren GL, Park ND, Maresca RD, et al. Effect of caffeine ingestion on muscular strength and endurance: a meta-analysis. Med Sci Sports Exerc 2010.; PMID 20019636; DOI 10.1249/MSS.0b013e3181cabbd8; https://pubmed.ncbi.nlm.nih.gov/20019636/
[44] Maestu J, Eliakim A, Jurimae J, et al. Anabolic and catabolic hormones and energy balance of the male bodybuilders during the preparation for the competition. J Strength Cond Res 2010.; PMID 20300017; DOI 10.1519/JSC.0b013e3181cb6fd3; https://pubmed.ncbi.nlm.nih.gov/20300017/
[45] Pasiakos SM, Cao JJ, Margolis LM, et al. Effects of high-protein diets on fat-free mass and muscle protein synthesis following weight loss: a randomized controlled trial. FASEB J 2013.; PMID 23739654; DOI 10.1096/fj.13-230227; https://pubmed.ncbi.nlm.nih.gov/23739654/
[46] Bergstrom J, Hermansen L, Hultman E, Saltin B. Diet, muscle glycogen and physical performance. Acta Physiol Scand 1967;71:140-150. (numbers verified against the scanned paper: Table II, Fig. 2, abstract); PMID 5584523; DOI 10.1111/j.1748-1716.1967.tb03720.x; https://pubmed.ncbi.nlm.nih.gov/5584523/
[47] Hawley JA, Schabort EJ, Noakes TD, Dennis SC. Carbohydrate-loading and exercise performance. An update. Sports Med 1997.; PMID 9291549; DOI 10.2165/00007256-199724020-00001; https://pubmed.ncbi.nlm.nih.gov/9291549/
[48] Vandenbogaerde TJ, Hopkins WG. Effects of acute carbohydrate supplementation on endurance performance: a meta-analysis. Sports Med 2011.; PMID 21846165; DOI 10.2165/11590520-000000000-00000; https://pubmed.ncbi.nlm.nih.gov/21846165/
[49] Burke LM, Ross ML, Garvican-Lewis LA, et al. Low carbohydrate, high fat diet impairs exercise economy and negates the performance benefit from intensified training in elite race walkers. J Physiol 2017;595:2785-2807. (PMC5407976); PMID 28012184; DOI 10.1113/jp273230; https://pubmed.ncbi.nlm.nih.gov/28012184/
[50] Burke LM, Whitfield J, Heikura IA, et al. Adaptation to a low carbohydrate high fat diet is rapid but impairs endurance exercise metabolism and performance despite enhanced glycogen availability. J Physiol 2021;599:771-790. (PMC7891450); PMID 32697366; DOI 10.1113/jp280221; https://pubmed.ncbi.nlm.nih.gov/32697366/
[51] Burke LM. Ketogenic low-CHO, high-fat diet: the future of elite endurance sport? J Physiol 2021;599:819-843.; PMID 32358802; DOI 10.1113/jp278928; https://pubmed.ncbi.nlm.nih.gov/32358802/
[52] Volek JS, Freidenreich DJ, Saenz C, et al. Metabolic characteristics of keto-adapted ultra-endurance runners. Metabolism 2016.; PMID 26892521; DOI 10.1016/j.metabol.2015.10.028; https://pubmed.ncbi.nlm.nih.gov/26892521/
[53] Shaw DM, Merien F, Braakhuis A, et al. Effect of a ketogenic diet on submaximal exercise capacity and efficiency in runners. Med Sci Sports Exerc 2019.; PMID 31033901; DOI 10.1249/MSS.0000000000002008; https://pubmed.ncbi.nlm.nih.gov/31033901/
[54] Marquet LA, Brisswalter J, Louis J, et al. Enhanced endurance performance by periodization of carbohydrate intake: 'sleep low' strategy. Med Sci Sports Exerc 2016.; PMID 26741119; DOI 10.1249/MSS.0000000000000823; https://pubmed.ncbi.nlm.nih.gov/26741119/
[55] Cureton KJ, Sparling PB, Evans BW, et al. Effect of experimental alterations in excess weight on aerobic capacity and distance running performance. Med Sci Sports 1978;10:194-199.; PMID 723510; https://pubmed.ncbi.nlm.nih.gov/723510/
[56] Teunissen LP, Grabowski A, Kram R. Effects of independently altering body weight and body mass on the metabolic cost of running. J Exp Biol 2007.; PMID 18055630; DOI 10.1242/jeb.004481; https://pubmed.ncbi.nlm.nih.gov/18055630/
[57] Swain DP. The influence of body mass in endurance bicycling. Med Sci Sports Exerc 1994;26:58-63.; PMID 8133740; https://pubmed.ncbi.nlm.nih.gov/8133740/
[58] Burden RJ, Morton K, Richards T, et al. Is iron treatment beneficial in iron-deficient but non-anaemic (IDNA) endurance athletes? A systematic review and meta-analysis. Br J Sports Med 2015.; PMID 25361786; DOI 10.1136/bjsports-2014-093624; https://pubmed.ncbi.nlm.nih.gov/25361786/
[59] Goulet ED. Dehydration and endurance performance in competitive athletes. Nutr Rev 2012.; PMID 23121348; DOI 10.1111/j.1753-4887.2012.00530.x; https://pubmed.ncbi.nlm.nih.gov/23121348/
[60] Southward K, Rutherfurd-Markwick KJ, Ali A. The effect of acute caffeine ingestion on endurance performance: a systematic review and meta-analysis. Sports Med 2018.; PMID 29876876; DOI 10.1007/s40279-018-0939-8; https://pubmed.ncbi.nlm.nih.gov/29876876/
[61] Grgic J, Grgic I, Pickering C, et al. Wake up and smell the coffee: caffeine supplementation and exercise performance - an umbrella review of 21 published meta-analyses. Br J Sports Med 2020.; PMID 30926628; DOI 10.1136/bjsports-2018-100278; https://pubmed.ncbi.nlm.nih.gov/30926628/
[62] Zajac A, Poprzecki S, Maszczyk A, et al. The effects of a ketogenic diet on exercise metabolism and physical performance in off-road cyclists. Nutrients 2014.; PMID 24979615; DOI 10.3390/nu6072493; https://pubmed.ncbi.nlm.nih.gov/24979615/
[63] Benau EM, Orloff NC, Janke EA, et al. A systematic review of the effects of experimental fasting on cognition. Appetite 2014.; PMID 24583414; DOI 10.1016/j.appet.2014.02.014; https://pubmed.ncbi.nlm.nih.gov/24583414/
[64] Harder-Lauridsen NM, Rosenberg A, Benatti FB, et al. Ramadan model of intermittent fasting for 28 d had no major effect on body composition, glucose metabolism, or cognitive functions in healthy lean men. Nutrition 2017.; PMID 28359370; DOI 10.1016/j.nut.2016.12.015; https://pubmed.ncbi.nlm.nih.gov/28359370/
[65] Kretsch MJ, Green MW, Fong AK, et al. Cognitive effects of a long-term weight reducing diet. Int J Obes 1997.; PMID 9023595; DOI 10.1038/sj.ijo.0800353; https://pubmed.ncbi.nlm.nih.gov/9023595/
[66] Wing RR, Vazquez JA, Ryan CM. Cognitive effects of ketogenic weight-reducing diets. Int J Obes Relat Metab Disord 1995.; PMID 8589783; https://pubmed.ncbi.nlm.nih.gov/8589783/
[67] Halyburton AK, Brinkworth GD, Wilson CJ, et al. Low- and high-carbohydrate weight-loss diets have similar effects on mood but not cognitive performance. Am J Clin Nutr 2007.; PMID 17823420; DOI 10.1093/ajcn/86.3.580; https://pubmed.ncbi.nlm.nih.gov/17823420/
[68] Brinkworth GD, Buckley JD, Noakes M, et al. Long-term effects of a very low-carbohydrate diet and a low-fat diet on mood and cognitive function. Arch Intern Med 2009.; PMID 19901139; DOI 10.1001/archinternmed.2009.329; https://pubmed.ncbi.nlm.nih.gov/19901139/
[69] Bostock ECS, Kirkby KC, Taylor BV, Hawrelak JA. Consumer reports of 'keto flu' associated with the ketogenic diet. Front Nutr 2020.; PMID 32232045; DOI 10.3389/fnut.2020.00020; https://pubmed.ncbi.nlm.nih.gov/32232045/
[70] Skartun O, Smith CR, Laupsa-Borge J, Dankel SN. Symptoms during initiation of a ketogenic diet: a scoping review of occurrence rates, mechanisms and relief strategies. Front Nutr 2025. (PMC11978633); PMID 40206956; DOI 10.3389/fnut.2025.1538266; https://pubmed.ncbi.nlm.nih.gov/40206956/
[71] Martin CK, Bhapkar M, Pittas AG, et al. Effect of calorie restriction on mood, quality of life, sleep, and sexual function in healthy nonobese adults: the CALERIE 2 randomized clinical trial. JAMA Intern Med 2016.; PMID 27136347; DOI 10.1001/jamainternmed.2016.1189; https://pubmed.ncbi.nlm.nih.gov/27136347/
[72] Firth J, Marx W, Dash S, et al. The effects of dietary improvement on symptoms of depression and anxiety: a meta-analysis of randomized controlled trials. Psychosom Med 2019.; PMID 30720698; DOI 10.1097/PSY.0000000000000673; https://pubmed.ncbi.nlm.nih.gov/30720698/
[73] Jacka FN, O'Neil A, Opie R, et al. A randomised controlled trial of dietary improvement for adults with major depression (the 'SMILES' trial). BMC Med 2017.; PMID 28137247; DOI 10.1186/s12916-017-0791-y; https://pubmed.ncbi.nlm.nih.gov/28137247/
[74] Lassale C, Batty GD, Baghdadli A, et al. Healthy dietary indices and risk of depressive outcomes: a systematic review and meta-analysis of observational studies. Mol Psychiatry 2019.; PMID 30254236; DOI 10.1038/s41380-018-0237-8; https://pubmed.ncbi.nlm.nih.gov/30254236/
[75] Molero P, De Lorenzi F, Gedek A, et al. Diet quality and depression risk: a systematic review and meta-analysis of prospective studies. J Affect Disord 2025.; PMID 40158860; DOI 10.1016/j.jad.2025.03.162; https://pubmed.ncbi.nlm.nih.gov/40158860/
[76] Lieberman HR, Bathalon GP, Falco CM, et al. Severe decrements in cognition function and mood induced by sleep loss, heat, dehydration, and undernutrition during simulated combat. Biol Psychiatry 2005.; PMID 15705359; DOI 10.1016/j.biopsych.2004.11.014; https://pubmed.ncbi.nlm.nih.gov/15705359/
[77] Wittbrodt MT, Millard-Stafford M. Dehydration impairs cognitive performance: a meta-analysis. Med Sci Sports Exerc 2018.; PMID 29933347; DOI 10.1249/MSS.0000000000001682; https://pubmed.ncbi.nlm.nih.gov/29933347/
[78] Armstrong LE, Ganio MS, Casa DJ, et al. Mild dehydration affects mood in healthy young women. J Nutr 2012.; PMID 22190027; DOI 10.3945/jn.111.142000; https://pubmed.ncbi.nlm.nih.gov/22190027/
[79] Galioto R, Spitznagel MB. The effects of breakfast and breakfast composition on cognition in adults. Adv Nutr 2016.; PMID 27184286; DOI 10.3945/an.115.010231; https://pubmed.ncbi.nlm.nih.gov/27184286/
[80] McLellan TM, Caldwell JA, Lieberman HR. A review of caffeine's effects on cognitive, physical and occupational performance. Neurosci Biobehav Rev 2016.; PMID 27612937; DOI 10.1016/j.neubiorev.2016.09.001; https://pubmed.ncbi.nlm.nih.gov/27612937/
[81] Philippou E, Constantinou M. The influence of glycemic index on cognitive functioning: a systematic review of the evidence. Adv Nutr 2014.; PMID 24618754; DOI 10.3945/an.113.004960; https://pubmed.ncbi.nlm.nih.gov/24618754/
[82] Krikorian R, Shidler MD, Dangelo K, et al. Dietary ketosis enhances memory in mild cognitive impairment. Neurobiol Aging 2012.; PMID 21130529; DOI 10.1016/j.neurobiolaging.2010.10.006; https://pubmed.ncbi.nlm.nih.gov/21130529/
[83] Bonnechere B, Stephens EB, Boileau AC, et al. The effect of exogenous ketone bodies on cognition across health and disease: a systematic review and meta-analysis. Front Nutr 2026.; PMID 42063954; DOI 10.3389/fnut.2026.1802531; https://pubmed.ncbi.nlm.nih.gov/42063954/
[84] Gudden J, Arias Vasquez A, Bloemendaal M. The effects of intermittent fasting on brain and cognitive function. Nutrients 2021.; PMID 34579042; DOI 10.3390/nu13093166; https://pubmed.ncbi.nlm.nih.gov/34579042/
[85] Rohrig BJ, Pettitt RW, Pettitt CD, Kanzenbach TL. Psychophysiological tracking of a female physique competitor through competition preparation. Int J Exerc Sci 2017.; PMID 28344742; DOI 10.70252/SUFM1783; https://pubmed.ncbi.nlm.nih.gov/28344742/
[86] Halliday TM, Loenneke JP, Davy BM. Dietary intake, body composition, and menstrual cycle changes during competition preparation and recovery in a drug-free figure competitor: a case study. Nutrients 2016.; PMID 27879627; DOI 10.3390/nu8110740; https://pubmed.ncbi.nlm.nih.gov/27879627/
[87] Drew M, Vlahovich N, Hughes D, et al. Prevalence of illness, poor mental health and sleep quality and low energy availability prior to the 2016 Summer Olympic Games. Br J Sports Med 2018.; PMID 29056598; DOI 10.1136/bjsports-2017-098208; https://pubmed.ncbi.nlm.nih.gov/29056598/
[88] Nieman DC, Henson DA, Austin MD, Sha W. Upper respiratory tract infection is reduced in physically fit and active adults. Br J Sports Med 2011.; PMID 21041243; DOI 10.1136/bjsm.2010.077875; https://pubmed.ncbi.nlm.nih.gov/21041243/
[89] Campbell JP, Turner JE. Debunking the myth of exercise-induced immune suppression: redefining the impact of exercise on immunological health across the lifespan. Front Immunol 2018.; PMID 29713319; DOI 10.3389/fimmu.2018.00648; https://pubmed.ncbi.nlm.nih.gov/29713319/
[90] Simpson RJ, Campbell JP, Gleeson M, et al. Can exercise affect immune function to increase susceptibility to infection? Exerc Immunol Rev 2020.; PMID 32139352; https://pubmed.ncbi.nlm.nih.gov/32139352/
[91] Jordan S, Tung N, Casanova-Acebes M, et al. Dietary intake regulates the circulating inflammatory monocyte pool. Cell 2019.; PMID 31442403; DOI 10.1016/j.cell.2019.07.050; https://pubmed.ncbi.nlm.nih.gov/31442403/
[92] Spadaro O, Youm Y, Shchukina I, et al. Caloric restriction in humans reveals immunometabolic regulators of health span. Science 2022.; PMID 35143297; DOI 10.1126/science.abg7292; https://pubmed.ncbi.nlm.nih.gov/35143297/
[93] McKay AKA, Pyne DB, Peeling P, et al. The impact of chronic carbohydrate manipulation on mucosal immunity in elite endurance athletes. J Sports Sci 2019.; PMID 30207506; DOI 10.1080/02640414.2018.1521712; https://pubmed.ncbi.nlm.nih.gov/30207506/
[94] Christodoulides S, Dimidi E, Fragkos KC, et al. Systematic review with meta-analysis: effect of fibre supplementation on chronic idiopathic constipation in adults. Aliment Pharmacol Ther 2016.; PMID 27170558; DOI 10.1111/apt.13662; https://pubmed.ncbi.nlm.nih.gov/27170558/
[95] Grabitske HA, Slavin JL. Gastrointestinal effects of low-digestible carbohydrates. Crit Rev Food Sci Nutr 2009.; PMID 19234944; DOI 10.1080/10408390802067126; https://pubmed.ncbi.nlm.nih.gov/19234944/
[96] Brinkworth GD, Noakes M, Clifton PM, Buckley JD. Comparative effects of very low-carbohydrate, high-fat and high-carbohydrate, low-fat weight-loss diets on bowel habit and faecal short-chain fatty acids and bacterial populations. Br J Nutr 2009.; PMID 19224658; DOI 10.1017/S0007114508094658; https://pubmed.ncbi.nlm.nih.gov/19224658/
[97] Smith RN, Mann NJ, Braue A, et al. A low-glycemic-load diet improves symptoms in acne vulgaris patients: a randomized controlled trial. Am J Clin Nutr 2007.; PMID 17616769; DOI 10.1093/ajcn/86.1.107; https://pubmed.ncbi.nlm.nih.gov/17616769/
[98] Kwon HH, Yoon JY, Hong JS, et al. Clinical and histological effect of a low glycaemic load diet in treatment of acne vulgaris in Korean patients: a randomized, controlled trial. Acta Derm Venereol 2012.; PMID 22678562; DOI 10.2340/00015555-1346; https://pubmed.ncbi.nlm.nih.gov/22678562/
[99] Meixiong J, Ricco C, Vasavda C, Ho BK. Diet and acne: a systematic review. JAAD Int 2022.; PMID 35373155; DOI 10.1016/j.jdin.2022.02.012; https://pubmed.ncbi.nlm.nih.gov/35373155/
[100] Asghar F, Shamim N, Farooque U, et al. Telogen effluvium: a review of the literature. Cureus 2020. (PMC7320655); PMID 32607303; DOI 10.7759/cureus.8320; https://pubmed.ncbi.nlm.nih.gov/32607303/
[101] Guo EL, Katta R. Diet and hair loss: effects of nutrient deficiency and supplement use. Dermatol Pract Concept 2017.; PMID 28243487; DOI 10.5826/dpc.0701a01; https://pubmed.ncbi.nlm.nih.gov/28243487/
[102] Bridges AG, Jackson T. Hair and scalp effects of GLP-1 receptor agonists in practice. Clin Dermatol 2026 (review abstract only; primary incidence sources not verified).; PMID 42767469; DOI 10.1016/j.clindermatol.2026.09.017; https://pubmed.ncbi.nlm.nih.gov/42767469/
[103] Whitehead RD, Re D, Xiao D, et al. You are what you eat: within-subject increases in fruit and vegetable consumption confer beneficial skin-color changes. PLoS One 2012.; PMID 22412966; DOI 10.1371/journal.pone.0032988; https://pubmed.ncbi.nlm.nih.gov/22412966/
[104] Alfaris N, Wadden TA, Sarwer DB, et al. Effects of a 2-year behavioral weight loss intervention on sleep and mood in obese individuals treated in primary care practice. Obesity 2015.; PMID 25611944; DOI 10.1002/oby.20996; https://pubmed.ncbi.nlm.nih.gov/25611944/
[105] Afaghi A, O'Connor H, Chow CM. Acute effects of the very low carbohydrate diet on sleep indices. Nutr Neurosci 2008.; PMID 18681982; DOI 10.1179/147683008X301540; https://pubmed.ncbi.nlm.nih.gov/18681982/
[106] Afaghi A, O'Connor H, Chow CM. High-glycemic-index carbohydrate meals shorten sleep onset. Am J Clin Nutr 2007.; PMID 17284739; DOI 10.1093/ajcn/85.2.426; https://pubmed.ncbi.nlm.nih.gov/17284739/
[107] St-Onge MP, Roberts A, Shechter A, Choudhury AR. Fiber and saturated fat are associated with sleep arousals and slow wave sleep. J Clin Sleep Med 2016.; PMID 26156950; DOI 10.5664/jcsm.5384; https://pubmed.ncbi.nlm.nih.gov/26156950/
[108] Barnard J, Roberts S, Lastella M, et al. The impact of dietary factors on the sleep of athletically trained populations: a systematic review. Nutrients 2022.; PMID 36014779; DOI 10.3390/nu14163271; https://pubmed.ncbi.nlm.nih.gov/36014779/
[109] Esposito K, Giugliano F, Di Palo C, et al. Effect of lifestyle changes on erectile dysfunction in obese men: a randomized controlled trial. JAMA 2004;291:2978-2984.; PMID 15213209; DOI 10.1001/jama.291.24.2978; https://pubmed.ncbi.nlm.nih.gov/15213209/
[110] Corona G, Rastrelli G, Monami M, et al. Body weight loss reverts obesity-associated hypogonadotropic hypogonadism: a systematic review and meta-analysis. Eur J Endocrinol 2013.; PMID 23482592; DOI 10.1530/EJE-12-0955; https://pubmed.ncbi.nlm.nih.gov/23482592/
[111] Koehler K, Hoerner NR, Gibbs JC, et al. Low energy availability in exercising men is associated with reduced leptin and insulin but not with changes in other metabolic hormones. J Sports Sci 2016.; PMID 26852783; DOI 10.1080/02640414.2016.1142109; https://pubmed.ncbi.nlm.nih.gov/26852783/
[112] Soare A, Cangemi R, Omodei D, et al. Long-term calorie restriction, but not endurance exercise, lowers core body temperature in humans. Aging (Albany NY) 2011. (PMC3117452); PMID 21483032; DOI 10.18632/aging.100280; https://pubmed.ncbi.nlm.nih.gov/21483032/
[113] Fontana L, Klein S, Holloszy JO, Premachandra BN. Effect of long-term calorie restriction with adequate protein and micronutrients on thyroid hormones. J Clin Endocrinol Metab 2006.; PMID 16720655; DOI 10.1210/jc.2006-0328; https://pubmed.ncbi.nlm.nih.gov/16720655/
[114] Heilbronn LK, de Jonge L, Frisard MI, et al. Effect of 6-month calorie restriction on biomarkers of longevity, metabolic adaptation, and oxidative stress in overweight individuals: a randomized controlled trial. JAMA 2006;295:1539-1548.; PMID 16595757; DOI 10.1001/jama.295.13.1539; https://pubmed.ncbi.nlm.nih.gov/16595757/
[115] Redman LM, Smith SR, Burton JH, et al. Metabolic slowing and reduced oxidative damage with sustained caloric restriction support the rate of living and oxidative damage theories of aging. Cell Metab 2018.; PMID 29576535; DOI 10.1016/j.cmet.2018.02.019; https://pubmed.ncbi.nlm.nih.gov/29576535/
[116] Muller MJ, Enderle J, Pourhassan M, et al. Metabolic adaptation to caloric restriction and subsequent refeeding: the Minnesota Starvation Experiment revisited. Am J Clin Nutr 2015.; PMID 26399868; DOI 10.3945/ajcn.115.109173; https://pubmed.ncbi.nlm.nih.gov/26399868/
[117] Reimers AK, Knapp G, Reimers CD. Effects of exercise on the resting heart rate: a systematic review and meta-analysis of interventional studies. J Clin Med 2018. (PMC6306777); PMID 30513777; DOI 10.3390/jcm7120503; https://pubmed.ncbi.nlm.nih.gov/30513777/
[118] Sandercock GR, Bromley PD, Brodie DA. Effects of exercise on heart rate variability: inferences from meta-analysis. Med Sci Sports Exerc 2005.; PMID 15741842; DOI 10.1249/01.mss.0000155388.39002.9d; https://pubmed.ncbi.nlm.nih.gov/15741842/
[119] Karason K, Molgaard H, Wikstrand J, Sjostrom L. Heart rate variability in obesity and the effect of weight loss. Am J Cardiol 1999.; PMID 10215292; DOI 10.1016/s0002-9149(99)00066-1; https://pubmed.ncbi.nlm.nih.gov/10215292/
[120] Maunder E, Dulson DK, Shaw DM. Autonomic and perceptual responses to induction of a ketogenic diet in free-living endurance athletes: a randomized, crossover trial. Int J Sports Physiol Perform 2021.; PMID 33873154; DOI 10.1123/ijspp.2020-0814; https://pubmed.ncbi.nlm.nih.gov/33873154/
[121] Polito R, Valenzano A, Monda V, et al. Heart rate variability and sympathetic activity is modulated by very low-calorie ketogenic diet. Int J Environ Res Public Health 2022.; PMID 35206443; DOI 10.3390/ijerph19042253; https://pubmed.ncbi.nlm.nih.gov/35206443/
[122] Musa-Veloso K, Likhodii SS, Cunnane SC. Breath acetone is a reliable indicator of ketosis in adults consuming ketogenic meals. Am J Clin Nutr 2002;76:65-70.; PMID 12081817; DOI 10.1093/ajcn/76.1.65; https://pubmed.ncbi.nlm.nih.gov/12081817/
[123] Musa-Veloso K, Likhodii SS, Rarama E, et al. Breath acetone predicts plasma ketone bodies in children with epilepsy on a ketogenic diet. Nutrition 2006.; PMID 16183255; DOI 10.1016/j.nut.2005.04.008; https://pubmed.ncbi.nlm.nih.gov/16183255/
[124] Anderson JC. Measuring breath acetone for monitoring fat loss: review. Obesity 2015.; PMID 26524104; DOI 10.1002/oby.21242; https://pubmed.ncbi.nlm.nih.gov/26524104/
[125] Kundu SK, Bruzek JA, Nair R, Judilla AM. Breath acetone analyzer: diagnostic tool to monitor dietary fat loss. Clin Chem 1993.; PMID 8419065; https://pubmed.ncbi.nlm.nih.gov/8419065/
[126] Prabhakar A, Quach A, Zhang H, et al. Acetone as biomarker for ketosis buildup capability - a study in healthy individuals under combined high fat and starvation diets. Nutr J 2015.; PMID 25897953; DOI 10.1186/s12937-015-0028-x; https://pubmed.ncbi.nlm.nih.gov/25897953/
[127] Sun M, Chen Z, Gong Z, et al. Determination of breath acetone in 149 type 2 diabetic patients using a ringdown breath-acetone analyzer. Anal Bioanal Chem 2015.; PMID 25572689; DOI 10.1007/s00216-014-8401-8; https://pubmed.ncbi.nlm.nih.gov/25572689/
[128] Fujiwara Y, Machida A, Watanabe Y, et al. Association between dinner-to-bed time and gastro-esophageal reflux disease. Am J Gastroenterol 2005.; PMID 16393212; DOI 10.1111/j.1572-0241.2005.00354.x; https://pubmed.ncbi.nlm.nih.gov/16393212/
[129] Austin GL, Thiny MT, Westman EC, et al. A very low-carbohydrate diet improves gastroesophageal reflux and its symptoms. Dig Dis Sci 2006.; PMID 16871438; DOI 10.1007/s10620-005-9027-7; https://pubmed.ncbi.nlm.nih.gov/16871438/
[130] Dessein PH, Shipton EA, Stanwix AE, et al. Beneficial effects of weight loss associated with moderate calorie/carbohydrate restriction, and increased proportional intake of protein and unsaturated fat on serum urate and lipoprotein levels in gout: a pilot study. Ann Rheum Dis 2000.; PMID 10873964; DOI 10.1136/ard.59.7.539; https://pubmed.ncbi.nlm.nih.gov/10873964/
[131] Nielsen SM, Bartels EM, Henriksen M, et al. Weight loss for overweight and obese individuals with gout: a systematic review of longitudinal studies. Ann Rheum Dis 2017.; PMID 28866649; DOI 10.1136/annrheumdis-2017-211472; https://pubmed.ncbi.nlm.nih.gov/28866649/
[132] Gelfand RA, Sherwin RS. Nitrogen conservation in starvation revisited: protein sparing with intravenous fructose. Metabolism 1986.; PMID 3510363; DOI 10.1016/0026-0495(86)90093-4; https://pubmed.ncbi.nlm.nih.gov/3510363/
[133] Zurcher HU, Meier HR, Huber M, et al. [Acute kidney failure as a complication of fasting therapy]. Schweiz Med Wochenschr 1977.; PMID 897646; https://pubmed.ncbi.nlm.nih.gov/897646/
[134] Yang M, Bai W, Jiang B, et al. Effects of a ketogenic diet in women with PCOS with different uric acid concentrations: a prospective cohort study. Reprod Biomed Online 2022.; PMID 35732547; DOI 10.1016/j.rbmo.2022.03.023; https://pubmed.ncbi.nlm.nih.gov/35732547/
[135] Sampath A, Kossoff EH, Furth SL, et al. Kidney stones and the ketogenic diet: risk factors and prevention. J Child Neurol 2007.; PMID 17621514; DOI 10.1177/0883073807301926; https://pubmed.ncbi.nlm.nih.gov/17621514/
[136] Fink HA, Wilt TJ, Eidman KE, et al. Medical management to prevent recurrent nephrolithiasis in adults: a systematic review for an American College of Physicians clinical guideline. Ann Intern Med 2013.; PMID 23546565; DOI 10.7326/0003-4819-158-7-201304020-00005; https://pubmed.ncbi.nlm.nih.gov/23546565/
[137] Fink HA, Akornor JW, Garimella PS, et al. Diet, fluid, or supplements for secondary prevention of nephrolithiasis: a systematic review and meta-analysis of randomized trials. Eur Urol 2009.; PMID 19321253; DOI 10.1016/j.eururo.2009.03.031; https://pubmed.ncbi.nlm.nih.gov/19321253/
[138] Weinsier RL, Wilson LJ, Lee J. Medically safe rate of weight loss for the treatment of obesity: a guideline based on risk of gallstone formation. Am J Med 1995.; PMID 7847427; DOI 10.1016/S0002-9343(99)80394-5; https://pubmed.ncbi.nlm.nih.gov/7847427/
[139] Johansson K, Sundstrom J, Marcus C, et al. Risk of symptomatic gallstones and cholecystectomy after a very-low-calorie diet or low-calorie diet in a commercial weight loss program: 1-year matched cohort study. Int J Obes 2014.; PMID 23736359; DOI 10.1038/ijo.2013.83; https://pubmed.ncbi.nlm.nih.gov/23736359/
[140] Stokes CS, Gluud LL, Casper M, Lammert F. Ursodeoxycholic acid and diets higher in fat prevent gallbladder stones during weight loss: a meta-analysis of randomized controlled trials. Clin Gastroenterol Hepatol 2014.; PMID 24321208; DOI 10.1016/j.cgh.2013.11.031; https://pubmed.ncbi.nlm.nih.gov/24321208/
[141] Moynihan PJ, Kelly SA. Effect on caries of restricting sugars intake: systematic review to inform WHO guidelines. J Dent Res 2014.; PMID 24323509; DOI 10.1177/0022034513508954; https://pubmed.ncbi.nlm.nih.gov/24323509/
[142] Seidelmann SB, Claggett B, Cheng S, et al. Dietary carbohydrate intake and mortality: a prospective cohort study and meta-analysis. Lancet Public Health 2018.; PMID 30122560; DOI 10.1016/S2468-2667(18)30135-X; https://pubmed.ncbi.nlm.nih.gov/30122560/
[143] Dehghan M, Mente A, Zhang X, et al. Associations of fats and carbohydrate intake with cardiovascular disease and mortality in 18 countries from five continents (PURE): a prospective cohort study. Lancet 2017.; PMID 28864332; DOI 10.1016/S0140-6736(17)32252-3; https://pubmed.ncbi.nlm.nih.gov/28864332/
[144] Song M, Fung TT, Hu FB, et al. Association of animal and plant protein intake with all-cause and cause-specific mortality. JAMA Intern Med 2016.; PMID 27479196; DOI 10.1001/jamainternmed.2016.4182; https://pubmed.ncbi.nlm.nih.gov/27479196/
[145] Naghshi S, Sadeghi O, Willett WC, Esmaillzadeh A. Dietary intake of total, animal, and plant proteins and risk of all cause, cardiovascular, and cancer mortality: systematic review and dose-response meta-analysis of prospective cohort studies. BMJ 2020.; PMID 32699048; DOI 10.1136/bmj.m2412; https://pubmed.ncbi.nlm.nih.gov/32699048/
[146] Levine ME, Suarez JA, Brandhorst S, et al. Low protein intake is associated with a major reduction in IGF-1, cancer, and overall mortality in the 65 and younger but not older population. Cell Metab 2014.; PMID 24606898; DOI 10.1016/j.cmet.2014.02.006; https://pubmed.ncbi.nlm.nih.gov/24606898/
[147] Waziry R, Ryan CP, Corcoran DL, et al. Effect of long-term caloric restriction on DNA methylation measures of biological aging in healthy adults from the CALERIE trial. Nat Aging 2023.; PMID 37118425; DOI 10.1038/s43587-022-00357-y; https://pubmed.ncbi.nlm.nih.gov/37118425/
[148] Patton GC, Selzer R, Coffey C, et al. Onset of adolescent eating disorders: population based cohort study over 3 years. BMJ 1999;318:765-768.; PMID 10082698; DOI 10.1136/bmj.318.7186.765; https://pubmed.ncbi.nlm.nih.gov/10082698/
[149] Stice E, Gau JM, Rohde P, Shaw H. Risk factors that predict future onset of each DSM-5 eating disorder: predictive specificity in high-risk adolescent females. J Abnorm Psychol 2017.; PMID 27709979; DOI 10.1037/abn0000219; https://pubmed.ncbi.nlm.nih.gov/27709979/
[150] Stewart TM, Williamson DA, White MA. Rigid vs. flexible dieting: association with eating disorder symptoms in nonobese women. Appetite 2002.; PMID 11883916; DOI 10.1006/appe.2001.0445; https://pubmed.ncbi.nlm.nih.gov/11883916/
[151] Westenhoefer J, Engel D, Holst C, et al. Cognitive and weight-related correlates of flexible and rigid restrained eating behaviour. Eat Behav 2013.; PMID 23265405; DOI 10.1016/j.eatbeh.2012.10.015; https://pubmed.ncbi.nlm.nih.gov/23265405/
[152] Raymond NC, de Zwaan M, Mitchell JE, et al. Effect of a very low calorie diet on the diagnostic category of individuals with binge eating disorder. Int J Eat Disord 2002.; PMID 11835297; DOI 10.1002/eat.1110; https://pubmed.ncbi.nlm.nih.gov/11835297/
[153] Byrne NM, Sainsbury A, King NA, et al. Intermittent energy restriction improves weight loss efficiency in obese men: the MATADOR study. Int J Obes 2018.; PMID 28925405; DOI 10.1038/ijo.2017.206; https://pubmed.ncbi.nlm.nih.gov/28925405/
[154] Kalm LM, Semba RD. They starved so that others be better fed: remembering Ancel Keys and the Minnesota experiment. J Nutr 2005;135:1347-1352.; PMID 15930436; DOI 10.1093/jn/135.6.1347; https://pubmed.ncbi.nlm.nih.gov/15930436/
[155] Dulloo AG. Physiology of weight regain: lessons from the classic Minnesota Starvation Experiment on human body composition regulation. Obes Rev 2021.; PMID 33543573; DOI 10.1111/obr.13189; https://pubmed.ncbi.nlm.nih.gov/33543573/
[156] Keys A, Brozek J, Henschel A, Mickelsen O, Taylor HL. The Biology of Human Starvation. Univ. of Minnesota Press, 1950 (primary book NOT accessed). Numbers quoted via secondary summary: https://en.wikipedia.org/wiki/Minnesota_Starvation_Experiment (fetched 2026-09-30).
[157] Martin CK, Rosenbaum D, Han H, et al. Change in food cravings, food preferences, and appetite during a low-carbohydrate and low-fat diet. Obesity 2011.; PMID 21494226; DOI 10.1038/oby.2011.62; https://pubmed.ncbi.nlm.nih.gov/21494226/
[158] Bertino M, Beauchamp GK, Engelman K. Long-term reduction in dietary sodium alters the taste of salt. Am J Clin Nutr 1982.; PMID 7148734; DOI 10.1093/ajcn/36.6.1134; https://pubmed.ncbi.nlm.nih.gov/7148734/
[159] Wise PM, Nattress L, Flammer LJ, Beauchamp GK. Reduced dietary intake of simple sugars alters perceived sweet taste intensity but not perceived pleasantness. Am J Clin Nutr 2016.; PMID 26607941; DOI 10.3945/ajcn.115.112300; https://pubmed.ncbi.nlm.nih.gov/26607941/
[160] Lowery LM, Anderson DE, Scanlon KF, et al. International Society of Sports Nutrition position stand: coffee and sports performance. J Int Soc Sports Nutr 2023.; PMID 37498180; DOI 10.1080/15502783.2023.2237952; https://pubmed.ncbi.nlm.nih.gov/37498180/
[161] Adan A. Cognitive performance and dehydration. J Am Coll Nutr 2012.; PMID 22855911; https://pubmed.ncbi.nlm.nih.gov/22855911/
[162] Gawelczyk M, Kaszuba M, Zajac A, Maszczyk A. Effects of low-carbohydrate and ketogenic diets on aerobic performance in trained athletes: a systematic review and meta-analysis. Nutrients 2026.; PMID 41829910; DOI 10.3390/nu18050740; https://pubmed.ncbi.nlm.nih.gov/41829910/
[163] Dai ZH, Wan KW, Wong PS, et al. Additional effect of exercise to intermittent fasting on body composition and cardiometabolic health in adults with overweight/obesity: a systematic review and meta-analysis. Curr Obes Rep 2025.; PMID 40533648; DOI 10.1007/s13679-025-00645-9; https://pubmed.ncbi.nlm.nih.gov/40533648/
