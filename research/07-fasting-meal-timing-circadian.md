# 07 — Fasting, meal timing, eating windows and circadian effects

> Dossier owner: research agent 07. Status: v1.0 (2026-09-30).
> Cross-refs: 01 body-weight models, 02 energy expenditure/TEF, 03 protein/MPS, 04 glycogen/insulin,
> 05 fat oxidation/ketosis, 06 lipids/BP, 08 autophagy, 09 resistance training, 10 cardio/fasted exercise,
> 12 hormones/appetite, 13 transitions/5:2/ADF, 16 sleep/sex modifiers, 17 safety, 18 planner,
> 20 extended water fasting (new; goes deep on multi-day fasts — this dossier supplies the continuous
> 0 h -> 10+ d fasting-state backbone that 20 should plug into).

Citations are `[n]` -> section 11. Every number was checked against the cited abstract/full text unless
marked `UNVERIFIED`. `PROPOSED FIT` = equation fitted by this author to the listed data points.

---

## 1. Scope

This module decides **when** the body is in the fed, post-absorptive, gluconeogenic, ketotic and
prolonged-starvation states, hour by hour, from the meal log (clock time, kcal, macros) and sleep window,
and continuously from 0 h to >= 21 days of zero intake (no discontinuity at 72 h). It supplies
(i) a gut-absorption model, (ii) fasting clocks with memory for repeated fasts, (iii) reference
trajectories of fasting physiology (glucose, insulin, lipolysis, FFA, ketones, GH, IGF-1, cortisol,
noradrenaline, REE, N excretion, leptin, T3, testosterone), (iv) the **small** set of timing effects that
survive matching of energy and protein (clock-time glucose tolerance, TEF timing, appetite, meal
frequency, per-meal protein), and (v) the effects that operate only via intake/appetite (TRE, ADF,
breakfast skipping). Energy/macro bookkeeping, glycogen, ketone kinetics and MPS are owned by 01-05;
this module drives them with timing signals and provides their fasting validation targets.

**Headline for the engine:** at equal energy and protein, meal timing changes fat/lean mass by at most
~0-1 kg over months (grade A-B); its real levers are (a) spontaneous intake (TRE 4-8 h windows cut
intake 300-550 kcal/d when eating ad libitum), (b) hunger/adherence, (c) postprandial glycaemia
(+17% for an identical meal at 20:00 vs 08:00), (d) lean-tissue loss during long (>= 24 h) fasts,
and (e) the acute physiology of multi-day fasting.

---

## 2. State variables

| Name | Unit | Typical range | What it represents | Initial-value rule |
|---|---|---|---|---|
| `gutE` (+ `gutC`,`gutP`,`gutF`) | kcal (g) | 0-2500 | Energy (macros) in stomach awaiting emptying | 0 (start sim after an overnight fast) |
| `absFlux` | kcal/h | 0-300 | Energy leaving stomach -> absorbed (lag 0.5 h) | 0 |
| `FED` | bool | - | `absFlux >= 30 kcal/h` (absorptive state) | false |
| `tPA` | h | 0-500+ | Hours since the last FED hour (post-absorptive clock) | 7.5 (overnight) |
| `tau` | h | 0-500+ | Meal-equivalent fasting time = `tPA + 4.5` (literature "hours since last meal") | 12 |
| `zeta_i` | h | 0-500 | Per-variable fasting-memory clock ("excess fasting hours beyond 12 h") for slow adaptations i = {leptin, GH, IGF1, cortisol, NE, REE, T3, testo, Nspare} | 0 |
| `Lliv` | g glycogen | 5-120 | Liver glycogen (owned by 04; reduced form here) | 65 g after overnight fast [9,11] |
| `Sw` | 0-1 | 0-1 | Glucose->ketone "metabolic switch" index, `f(Lliv)` | 0.05 |
| `phi` | 0-1 | 0-1 | Fasting intensity of the current hour (1 = nothing absorbed) | 1 |
| `fastDays` | d | 0-40 | Continuous days with `phi_day >= 0.85` (extended-fast counter) | 0 |
| `Hshift` | mm VAS | -30..+30 | Timing-driven hunger offset handed to 12 | 0 |
| `leanFastLoss` | kg | 0-5 | Cumulative lean tissue lost via fasting protein oxidation (hand to 01/03) | 0 |
| `ecwLoss` | kg | 0-2 | Extracellular water lost by fasting natriuresis (reversible) | 0 |
| Daily summaries: `W` (eating window h), `midEat` (clock h), `nMeals`, `lastMealToSleep` (h), `fracEnergyBefore14` | h / count / % | | Derived each day for outputs and effect functions | from log |

---

## 3. Inputs that drive it

| Input | Unit | How it enters |
|---|---|---|
| Meal events (clock time, kcal, protein, net carb, fat, fibre g) | time, kcal, g | Added to `gutE`/macro pools; emptying drives `absFlux`, `FED`, resets `tPA`, partially rewinds `zeta_i` |
| Sleep window (bed, wake) | clock h | Circadian glucose-tolerance multiplier; sleep-overlap penalty for late meals; `lastMealToSleep` |
| Exercise sessions (time, kcal, intensity) | kcal | Via 04/10: faster liver-glycogen depletion -> earlier `Sw` (ketonaemia detectable ~17.5 h with exercise vs 21.1 h without [38]) |
| Intake mode | enum | `specified` (kcal fixed by user: NO timing-driven intake change) vs `adLib` (planner/ad-lib: apply TRE/ADF intake functions of section 4.6/4.9) |
| Habitual eating window `W0` | h | Baseline for TRE intake effect (median real-world window ~14.75 h [75]) |
| Body: sex, age, mass, FFM, BF% | | Scales glycogen (liver ~1.5 L), N excretion (per kg FFM), sex modifiers (4.14) |
| Electrolyte supplementation during fasts | mmol/d Na, K, Mg | Safety flags (section 9); ECW-loss modifier (UNVERIFIED magnitude) |
| Medication flags (insulin, sulfonylurea, SGLT2i, diuretics) | bool | Hard safety gates (17) |

---
## 4. Mechanisms & equations

### 4.1 Meal -> stomach -> absorption: how long is the "fed" (absorptive) state?

**Mechanism.** Gastric emptying is the rate-limiting step for nutrient appearance. Duodenal nutrient
receptors slow emptying so that energy delivery is roughly regulated per kcal: glucose solutions empty at
a near-constant ~2.1 kcal/min [4]; across 33 studies, emptying slows with nutritive density and fat,
protein and carbohydrate slow it equally per kcal (4 g fat ~ 9 g carbohydrate) [3]. Standard
scintigraphy norms for a 255-kcal low-fat egg meal: median retention 69% at 1 h, 24% at 2 h, 1.2% at 4 h
(95th percentiles 90/60/10%) [1,2]. Liver glycogen peaks ~5 h after a mixed meal [10] and, with meals
5 h apart, keeps rising until just before the next meal [9,11] -> the absorptive phase of a normal
600-800 kcal meal lasts ~4-5 h. Very large protein boluses prolong aminoacidaemia: 100 g protein produced
a >12 h anabolic response vs 25 g [5].

**Equations (PROPOSED FIT to [1] medians, constrained by [3,4]).** Per meal-energy pool, hourly or finer
(use dt <= 0.25 h internally):

```
lag = 0.5 h after meal start (solid/mixed meal); 0 h for liquids
dGutE/dt = -kGE * gutE / (gutE + KGE)            (after lag)
absFlux  = kGE * gutE / (gutE + KGE)             (kcal/h; appears in blood ~0.25-0.5 h later)
macro fractions of absFlux = macro fractions currently in gut (proportional emptying) [3]
protein absorption additionally capped at Pmax = 10 g/h (PROPOSED; reproduces >12 h for 100 g [5])
FED = absFlux >= 30 kcal/h   (PROPOSED threshold ~0.3 x hourly RMR)
```

| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| kGE | 270 | kcal/h (4.5 kcal/min) | 130-300 (Brener 2.1 kcal/min for glucose [4]) | fit to [1] |
| KGE | 150 | kcal | 100-250 | fit to [1] |
| lag | 0.5 | h | 0.25-0.75 (solids) | fit to [1] |
| FED threshold | 30 | kcal/h | 15-60 | PROPOSED |
| Pmax | 10 | g protein/h | 6-12 | PROPOSED from [5] |

Fit check (retention at 1/2/4 h for 255 kcal): model 69/24/0.9% vs observed 69/24/1.2% [1].

Model-derived duration of the absorptive state (time to 95% emptied), mixed meals:

| Meal energy | 100 kcal | 255 | 500 | 700 | 1000 | 1500 | 2000 kcal |
|---|---|---|---|---|---|---|---|
| t95 (h) | 2.5 | 3.1 | 3.9 | 4.6 | 5.7 | 7.4 | 9.2 |

Composition modifiers: liquids/clear fluids empty exponentially and faster [4]; per kcal, fat, protein and
carbohydrate slow emptying equally [3] -> no separate fat term needed at this resolution; very high
protein (> 60 g) prolongs amino-acid appearance via `Pmax` [5]; high viscous fibre slows emptying
(magnitude UNVERIFIED -> 15). One-meal-per-day (e.g. 2000+ kcal) keeps the body absorptive ~8-10 h,
which is why "OMAD" still gives only ~14-16 h/day post-absorptive, not 23 h.

**Time dynamics.** Onset 0.5 h; saturating (zero-order at large contents -> big meals prolong rather
than intensify absorption); no hysteresis.
**Moderators.** Gastroparesis/diabetes, GLP-1 agonists (slower; out of scope -> 17), exercise (acute
slowing, 10). Women empty solids somewhat slower (UNVERIFIED magnitude; not modelled).
**Evidence grade: B** — consensus scintigraphy norms and classic physiology; the energy-scaling to
large mixed meals is an extrapolation.

### 4.2 Fasting clocks: `tPA`, `tau`, and per-variable memory `zeta_i`

**Mechanism.** Most fasting physiology in the literature is indexed to "hours since the last meal"
(overnight = 10-14 h). Two things must be captured: (a) a bigger or later meal delays the fasting
cascade (handled by `tPA` starting only when absorption ends), and (b) slow adaptations (leptin, T3,
GH, N-sparing, REE) are not instantly reset by one small snack, and recover over hours-days after
refeeding, giving hysteresis for repeated fasts (ADF, 5:2, periodic 3-5 d fasts).

**Equations (PROPOSED).**
```
each hour:
  if FED:  tPA = 0
  else:    tPA += 1
  tau = FED ? 0 : tPA + 4.5          // 4.5 h = absorption of the reference 700-kcal meal (4.1)
  phi = clamp(1 - absFlux / 100, 0, 1)   // fasting intensity; small snacks give phi 0.3-0.7
  for each slow variable i:
     if (!FED and tau >= 12):  zeta_i += 1                        // accrue excess fasting time
     else if FED:              zeta_i *= exp(-(1-phi) * 1h / Toff_i)  // decays faster for bigger meals
     // (not FED and tau < 12): hold
  X_i = Xref_i(12 + zeta_i)        // reference trajectory from 4.4, evaluated on the memory clock
```

| Variable i | Toff_i (h) | Basis | Grade |
|---|---|---|---|
| Leptin | 8 | back to baseline 24 h after refeeding a 36-h fast [22] | B |
| GH (24-h secretion) | 6 | GH low in fed state, pulsatility augmented within day 1 of fasting [14,15] | C |
| Cortisol (24-h mean) | 12 | none direct | D |
| Noradrenaline | 12 | none direct | D |
| T3 | 36 | T3/rT3 return to control during 5 d refeeding [25] | C |
| IGF-1 | 48 | none direct | D |
| Testosterone (men) | 24 | none direct | D |
| REE adaptive component | 72 | coordinate with 02 (adaptive thermogenesis reversal) | D |
| N-sparing (Nspare) | 120 | prior protein depletion blunts later fasting N loss by 17% [35] -> adaptation carries over days | D |
| Glucose, insulin, FFA, glycerol, BHB | not memory variables: computed mechanistically by 04/05 from `Lliv`, `absFlux`; reset within hours of a carbohydrate meal | [27] | B |

**Fasting intensity for low-energy "fast days".** With 200-250 kcal/day of juice/broth (25-35 g
carbohydrate) ketonuria still appears in >95% by day 4 and blood ketones rise to ~4 mM by day 12 [37,38];
cutting carbohydrate from 56.5 to 15.6 g/d intensifies ketosis [38]. So small intakes do not reset the
fasting state; the `phi`-weighted decay above reproduces this qualitatively (a 100-kcal item rewinds
leptin's clock by ~10-15%, T3's by ~3%). For 5:2 days at ~500-650 kcal eaten as one meal, the model
yields ~19 h non-FED per day; no human data map fast-day energy to fasting-hormone depth (open question).

**Evidence grade: C** — structure is a modelling choice; anchor points (refeeding recovery of leptin,
T3, ketones) are human data but sparse.

### 4.3 Liver glycogen depletion, gluconeogenesis share and the metabolic switch

(Owned by 04/05; reduced form here so that the timeline is self-contained and so 04/05 have targets.)

**Data.** Liver glycogen by 13C-NMR: 396 +/- 29 mM 4 h after a 650-kcal meal -> 251 +/- 30 mM at 15 h,
near-linear for 22 h; net glycogenolysis 4.3 umol/kg/min (0-22 h), 1.7 (22-46 h), 0.3 (46-64 h);
after 64 h liver glycogen -83% and liver volume -23% [6,9]. Overnight-fasted values 207-274 mM, peak
~420 mM 4 h after dinner on a 3-meal day [9,10,11]. Liver volume ~1.47 L [8] -> 1 mM ~ 0.24 g glycogen
(396 mM ~ 94 g; 420 mM ~ 100 g; 251 mM ~ 60 g). Gluconeogenesis (GNG) share of glucose production:
~55% at 6-12 h after a 1000-kcal meal [8]; 47% at 14 h, 67% at 22 h, 93% at 42 h (2H2O) [7];
64% (0-22 h), 82% (22-36 h), 96% (36-64 h) (NMR) [6]. Glucose appearance 11.0 (12 h) -> 8.3
umol/kg/min (72 h) [12]; ~86 g/d at 5-6 weeks, half renal [32].

**Equations (PROPOSED FIT to [6,9]; 70-kg adult, scale Vmax with body mass).**
```
postabsorptive:  dLliv/dt = - Vgly * Lliv^3 / (Kgly^3 + Lliv^3)      (g/h)
fed: + hepatic deposition ~19-25% of absorbed carbohydrate [9,10] (owned by 04)
fGNG(tau) = 0.40 + 0.58 / (1 + exp(-(tau - 24)/7))                   (fraction of glucose production)
Ra_glucose(tau) = 7.9 + 3.1*exp(-max(0,tau-12)/25)                   (umol/kg/min, tau >= 12)
Sw = 1 / (1 + (Lliv / L50)^4)                                          (switch index, 0..1)
```

| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| Vgly | 3.5 (0.05 g/kg/h) | g/h | +/-25% | fit to [6,9] |
| Kgly | 40 | g | 30-50 | fit |
| L50 (switch) | 30 | g (~125 mM) | 20-40 | PROPOSED: places Sw=0.5 at tau ~32 h, matching BHB 0.3-0.4 mM at 24 h and 1.2-1.9 mM at 48 h [13] |
| fGNG params | 0.40/0.58/24 h/7 h | - | +/-0.1 | fit to [6,7,8] (error < 0.05 at all points) |

Fit output: Lliv = 69 g (12 h), 60 (15 h; obs 60), 40 (24 h), 26 (36 h), 20 (48 h), 15 (64 h; obs 16),
10 g (5 d). Net glycogenolysis 2.8 / 1.0 / 0.28 g/h in the three Rothman intervals (obs 3.3 / 1.3 / 0.23).

**Time dynamics / moderators.** Exercise depletes liver glycogen and advances the switch: ketonaemia
first detectable at 17.5 h with exercise vs 21.1 h without (water-only; cited in [38], primary source
not retrieved). The switch "typically occurs between 12 to 36 hours after cessation of food
consumption depending on the liver glycogen content at the beginning of the fast, and on ... exercise" [51].
Low-carbohydrate diets pre-deplete glycogen (05). **Evidence grade: A** for the glycogen/GNG timeline
(multiple isotope/NMR studies); **C** for the exact switch threshold.

### 4.4 Hour-by-hour and day-by-day physiology of fasting, 0 h -> 21 d (reference trajectories)

**Reference subject:** healthy non-obese adult (data mostly men, 20-45 y), last meal = ~650-800 kcal mixed
dinner at tau = 0, water-only thereafter, sedentary. Relative variables are normalised to the
overnight-fasted value at tau = 12 h (= 1.00). Values at tau >= 12 h come from the continuous
functions below (all are smooth across 72 h and extend to weeks); "Observed" columns give the anchoring
data. Values in the fed window (0-5 h) are owned by 04/05 (postprandial glucose/insulin/FFA kinetics).

#### 4.4.1 Table A — fuels and metabolites

| tau (h) | Phase | Glucose mM (model) | Insulin rel. | Liver glyc. g | GNG % of HGP | Lipolysis (glycerol Ra, umol/kg/min) | FFA mM | BHB mM | RER | Observed anchors [ref] |
|---|---|---|---|---|---|---|---|---|---|---|
| 0-0.5 | Ingestion | (04) | (04) | ~65 -> | - | suppressed | falling | ~0.1 | rising | lag 0.5 h [1] |
| 1-5 | Absorptive (FED) | peak then back to ~basal by 3-4 h (04) | 3-10x (04) | -> ~95-100 peak at 4-5 h | ~50% of residual HGP | suppressed | suppressed (04) | <0.1 | ~0.85-0.95 | glycogen peak 5 h [10]; 420 mM 4 h post-dinner [9] |
| 6-10 | Early post-absorptive | 4.9-5.0 | ~1.1 | 90 -> 75 | 55 | ~1.8-2.1 | 0.35-0.45 | 0.1 | 0.82 | GNG 55% at 5-12 h post-meal [8] |
| **12** | Overnight reference | 4.8-5.6 | **1.00** (40-65 pmol/L) | 69 | 49 | **2.1** | **0.45** | 0.1-0.14 | **0.80** | glucose 5.58, insulin 64.6 pmol/L, glycerol Ra 2.08 [12]; RER 0.80 [18] |
| 16 | 16:8 end of fast | 4.8 | 0.82 | 58 | 54 | 2.7 | 0.54 | 0.17 | 0.79 | - |
| 18 | 18:6 / eTRF end | 4.8 | 0.75 | 53 | 57 | 3.0 | 0.58 | 0.19 | 0.78 | eTRF (18 h) morning BHB 0.15 mM (+0.03 vs 12-h) [68] |
| 20 | 20:4 end | 4.8 | 0.70 | 48 | 61 | 3.2 | 0.62 | 0.22 | 0.78 | ketonaemia detectable ~21 h (17.5 h w/ exercise) [38] |
| 24 | OMAD / 1 day | 4.7 (obs 4.8-5.0) | 0.62 | 40 | 69 | 3.5 | 0.70 | 0.30 | 0.77 | BHB 0.33 (F) / 0.41 (M), FFA 0.71/0.56 [13]; GNG 67% at 22 h [7]; 60% of 12-72 h lipolysis rise done by 24 h, 70% of insulin fall [12] |
| 36 | ADF fast-day end | 4.5 | 0.50 | 26 | 89 | 4.05 | 0.89 | 0.9 | 0.76 | RER 0.76, RMR +6% [18]; leptin nadir in 36-h fast [22] |
| 48 | 2 days | 4.2 (obs M 4.05, F 4.4) | 0.47 | 20 | 96 | 4.3 | 1.04 | 1.8 (obs M 1.94, F 1.22) | 0.74 | [13]; glucose 4.9->3.5, BHB 0.2->1.8 at 52 h [21] |
| 72 | 3 days | 3.7 (obs 3.5-4.1) | 0.45 | 14 | 98 | 4.4 | 1.25 | 2.6 (interpolated; no direct 72-h mean retrieved -> UNVERIFIED) | 0.72 | glucose 4.14, insulin 30.1 pmol/L, glycerol Ra 4.36 [12]; RER 0.72 [18]; glycogen -83% at 64 h [6] |
| 96 | 4 days | 3.5 (obs 3.5) | 0.45 | 11 | 98 | 4.4 | 1.39 | 2.9 | ~0.72 | glucose 4.9->3.5 by day 4 [17] |
| 120 | 5 days | 3.5 (obs 3.2) | 0.45 | 10 | 98 | 4.4 | 1.47 | 3.2 | ~0.72 | glucose 3.2, FFA 1.55, AcAc 0.51 mM on day 5 [14] |
| 168 | 7 days | 3.5 | 0.45 | 8 | 98 | 4.4 | 1.55 | 3.6 | ~0.71 | - |
| 240 | 10 days | 3.5 (4.0 with 25-35 g/d CHO) | 0.45 (obs -59%) | 7 | 98 | 4.4 | 1.59 (obs x2.5) | 4.0 (obs ~4 at d12, modified fast) | ~0.71 | glucose 4.7->4.0, insulin -59%, NEFA x2.5 (200-250 kcal/d) [36]; ketonaemia ~4 mM at day 12 [38] |
| 336-504 | 2-3 weeks | 3.5 | 0.45 | - | 98 (kidney -> ~50% of GNG by 5-6 wk [32]) | 4.4 | 1.6 | 4.4-4.6 | ~0.70 | FFA and ketones plateau only after ~17 days [32]; GNG ~86 g/d at 5-6 wk [32] |

#### 4.4.2 Table B — hormones, energy expenditure, protein

| tau (h) | GH 24-h secretion (x) | IGF-1 rel | Cortisol 24-h mean rel | Noradrenaline rel | Leptin rel | T3 rel | Testosterone rel (men) | REE rel (total / adaptive-only) | HR | Urinary N g/d (70 kg man) | Observed anchors [ref] |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 12 | 1.0 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.000 / 1.000 | 62 bpm | = prior intake N (~11-13) | reference |
| 16 | 1.8 | 0.94 | 1.07 | 1.03 | 0.85 | 0.97 | 0.94 | 1.015 / 1.017 | - | 11 | leptin declines steadily from 12 h [22]; TT3/TT4 falls from 12-14 h [24] |
| 24 | 2.7 | 0.84 | 1.20 | 1.06 | 0.62 | 0.91 | 0.84 | 1.034 / 1.039 | - | 12 | GH rhythms enhanced on day 1 [14] |
| 36 | 3.5 | 0.73 | 1.34 | 1.14 | 0.41 | 0.84 | 0.75 | 1.043 / 1.053 | 68 bpm (obs) | 12 | RMR +6% (4.60->4.88 kJ/min), HR 62.5->68.0, NE/adrenaline unchanged [18] |
| 48 | 3.8 (obs x4.8 production, day 2) | 0.64 | 1.44 | 1.32 | 0.29 | 0.79 | 0.69 | 1.038 / 1.053 | - | 12 (peak d1-3; up to 14.5 in men) | GH production 78->371 ug/Lv/24 h, bursts 14->32/24 h [15]; N peaks day 1-3 [29] |
| 72 | 4.0 | 0.53 (obs total -50%, free -75%) | 1.57 (obs +62%) | 1.88 | 0.19 (obs 0.10-0.30) | 0.73 (obs -30%) | 0.63 (obs -40%) | 1.010 / 1.034 (obs +2.6% NS; +14% d3 in [17]; -8% in [19]) | 69 bpm (obs) | 12 | 72-h fast in lean men: leptin to ~10%, T3 -30%, TSH AUC -70%, testosterone -40%, LH -25%, IGF-1 >-50%, insulin >-70%, FFA +300%, cortisol 4.84->7.84 ug/dL [23]; NE and adrenaline up at 72 h [18]; leucine flux +31%, oxidation +46% at 3 d [19] |
| 96 | 4.0 | 0.47 | 1.63 | 2.14 (obs x2.17 d4) | 0.16 | 0.69 | 0.61 | 0.979 / 1.009 | - | 10.7 | NE 1716->3728 pmol/L d1->d4, REE 3.97->4.53 kJ/min d1->d3 [17] |
| 120 | 4.0 (obs integrated conc x3.1, pulses 5.8->9.9/24 h) | 0.44 (obs -41% d1->d5) | 1.67 (obs production x1.8; peak delayed to early afternoon) | 2.19 | 0.15 | 0.67 | 0.60 | 0.951 / 0.987 | - | 9.6 | GH [14]; cortisol [16] |
| 168 | 4.0 (UNVERIFIED beyond d5) | 0.41 | 1.69 | 2.2 (UNVERIFIED beyond d4) | 0.15 | 0.66 | 0.60 | 0.914 / 0.959 | - | 7.9 | - |
| 240 | 4.0 (UNVERIFIED) | 0.40 | 1.70 | 2.2 | 0.15 (obs leptin still low at 3-mo follow-up [36]) | 0.65 | 0.60 | 0.885 / 0.940 (obs BMR -12%, LST-adjusted still lower [36]) | - | 6.1 (obs: -41% by d5 then stable, modified fast [36]) | [36] |
| 336-504 | - | 0.40 | 1.70 | 2.2 | 0.15 | 0.65 (T3 low, rT3 high over 4 wk [25]) | 0.60 | 0.87 / 0.93 | - | 4.9 -> 3.9 | N 3.0 g/d in obese women in week 4 [29]; late aminogenic oxidation 7% of energy [33] |

#### 4.4.3 Continuous reference functions (PROPOSED FITS; tau in h; `p(x)=max(0,x)`)

```
Glucose_mM(tau)  = 3.5 + 1.4 / (1 + exp((tau - 48)/12))                    // men; women: see 4.14
InsulinRel(tau)  = 0.45 + 0.55 * exp(-p(tau - 12)/10)                       // 70% of 12-72 h fall by 24 h [12]
GlycerolRa(tau)  = 2.1 * (1 + 1.10 * (1 - exp(-p(tau - 12)/13)))            // umol/kg/min [12]
FFA_mM(tau)      = 0.45 + 1.15 * (1 - exp(-p(tau - 12)/50))                 // [13,14,36]
BHB_mM(tau)      = 0.10 + 2.2/(1 + exp(-(tau - 40)/7)) + 2.5*(1 - exp(-p(tau - 48)/168))   // [13,21,38,68]; 05 owns kinetics
fGNG(tau)        = 0.40 + 0.58/(1 + exp(-(tau - 24)/7))                     // [6,7,8]
GH_x(tau)        = 1 + 3.0 * (1 - exp(-p(tau - 12)/14))                     // [14,15]; range x3-5
IGF1Rel(tau)     = 1 - 0.60 * (1 - exp(-p(tau - 12)/40))                    // [14,23]
CortisolRel(tau) = 1 + 0.70 * (1 - exp(-p(tau - 12)/36))                    // [16,23]
NERel(tau)       = 1 + 1.2 / (1 + exp(-(tau - 60)/12))                      // [17,18]
LeptinRel(tau)   = 0.15 + 0.85 * exp(-p(tau - 12)/20)                       // [21,22,23]
T3Rel(tau)       = 1 - 0.35 * (1 - exp(-p(tau - 12)/40))                    // [23,24,25]
TestoRel(tau)    = 1 - 0.40 * (1 - exp(-p(tau - 12)/24))                    // men [23]; women: no LH/estradiol change in 3-d fast [49]
REERel(tau)      = 1 + 0.07*(p(tau-12)/36)*exp(1 - p(tau-12)/36) - A*(1 - exp(-p(tau-12)/150))
                   // A = 0.15 if engine does NOT separately recompute RMR from FFM loss; A = 0.08 (adaptive-only) if it does [18,19,17,36]
UrinaryN_gd(d)   = d<=1 ? min(priorIntakeN, 10 + 2d) : d<=3 ? Npk : Nlate + (Npk - Nlate)*exp(-(d-3)/6)
                   // d = tau/24; Npk = 0.20 g N/kg FFM/d (=12 g at 60 kg FFM; men up to 14.5 [29]); Nlate = 3.5 g/d [29,33];
                   // women x0.8 at equal weight (direction [29]; magnitude UNVERIFIED);
                   // modified fast with 25-60 g/d carbohydrate: x0.6 (reproduces [36]; PROPOSED)
```

Parameter provenance (all PROPOSED FITS; fitting points in the tables above):

| Function | Key parameters | Fitted to | Max error at anchors | Grade |
|---|---|---|---|---|
| Glucose | 3.5 floor, t50 48 h, s 12 h | [12,13,14,17,21,36] | +/-0.4 mM (inter-study spread 3.2-4.1 at 72-120 h) | A (direction), B (values) |
| Insulin | floor 0.45, tau 10 h | [12,21,36] | 70%-by-24h matched exactly | A |
| Lipolysis | x2.1 at 72 h, tau 13 h | [12] | < 2% | B (6 men) |
| BHB | logistic t50 40 h + slow 2.5 mM (1 wk) | [13,21,38,68] | 24 h 0.30 vs 0.33-0.41; 48 h 1.8 vs 1.2-1.9 | B (to 48 h), C (>72 h) |
| GH | x4 plateau, tau 14 h | [14,15] | production x4.8 (d2) vs conc x3.1 (d5) bracket the fit | B (men only) |
| Cortisol | +70%, tau 36 h | [16,23] | +57% at 72 h vs +62% obs | B (men) |
| NE | x2.2, t50 60 h | [17,18] | unchanged at 36 h, x2.14 at 96 h vs x2.17 obs | B |
| REE | +4-5% bump at 36-48 h, -12% at 10 d | [17,18,19,36] | studies disagree (+14% [17] vs -8% [19] at 3 d) | C |
| Leptin | floor 0.15, tau 20 h | [21,22,23] | 52 h: 0.27 vs 0.28-0.36 obs [21] | B |
| T3 | -35%, tau 40 h | [23,24,25] | 72 h -27% vs -30% | B |
| Testosterone | -40%, tau 24 h | [23] | exact at 72 h | C (n = 6-8 men) |
| Urinary N | peak d1-3, t-1/e 6 d, floor 3.5 | [29,30,33,36] | Laurens -41% by d5 reproduced with x0.6 modifier | B |

#### 4.4.4 Day-by-day summary (water-only, 70-kg reference man; continuous with Tables A/B)

Day d means tau = 24 d hours since the last meal. Model values from 4.4.3 (weight column from 4.5, 80-kg
man). Beyond day 5 the hormone rows (GH, NE, cortisol) are extrapolated plateaus (UNVERIFIED); glucose,
BHB, N and weight rows are anchored to [29,32,33,36,37,38] through day 10-21.

| Day (tau h) | Glucose mM | Insulin rel | FFA mM | BHB mM | GH x | IGF-1 rel | Cortisol rel | NE rel | Leptin rel | T3 rel | Testo rel (M) | REE rel total / adaptive | Urinary N g/d | Cum. weight loss kg |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 (24) | 4.73 | 0.62 | 0.70 | 0.30 | 2.7 | 0.84 | 1.20 | 1.06 | 0.62 | 0.91 | 0.84 | 1.034 / 1.039 | 12.0 | 1.3 |
| 2 (48) | 4.20 | 0.47 | 1.04 | 1.77 | 3.8 | 0.64 | 1.44 | 1.32 | 0.29 | 0.79 | 0.69 | 1.038 / 1.053 | 12.0 | 2.4 |
| 3 (72) | 3.67 | 0.45 | 1.25 | 2.61 | 4.0 | 0.53 | 1.57 | 1.88 | 0.19 | 0.73 | 0.63 | 1.010 / 1.034 | 12.0 | 3.3 |
| 4 (96) | 3.53 | 0.45 | 1.39 | 2.92 | 4.0 | 0.47 | 1.63 | 2.14 | 0.16 | 0.69 | 0.61 | 0.979 / 1.009 | 10.7 | 4.0 |
| 5 (120) | 3.50 | 0.45 | 1.47 | 3.17 | 4.0 | 0.44 | 1.67 | 2.19 | 0.15 | 0.67 | 0.60 | 0.951 / 0.987 | 9.6 | 4.7 |
| 6 (144) | 3.50 | 0.45 | 1.52 | 3.39 | 4.0 | 0.42 | 1.68 | 2.20 | 0.15 | 0.66 | 0.60 | 0.930 / 0.971 | 8.7 | 5.3 |
| 7 (168) | 3.50 | 0.45 | 1.55 | 3.58 | 4.0 | 0.41 | 1.69 | 2.20 | 0.15 | 0.66 | 0.60 | 0.914 / 0.959 | 7.9 | 5.8 |
| 8 (192) | 3.50 | 0.45 | 1.57 | 3.74 | 4.0 | 0.41 | 1.70 | 2.20 | 0.15 | 0.65 | 0.60 | 0.902 / 0.951 | 7.2 | 6.3 |
| 9 (216) | 3.50 | 0.45 | 1.58 | 3.88 | 4.0 | 0.40 | 1.70 | 2.20 | 0.15 | 0.65 | 0.60 | 0.892 / 0.944 | 6.6 | 6.8 |
| 10 (240) | 3.50 | 0.45 | 1.59 | 4.00 | 4.0 | 0.40 | 1.70 | 2.20 | 0.15 | 0.65 | 0.60 | 0.885 / 0.940 | 6.1 | 7.2 |
| 14 (336) | 3.50 | 0.45 | 1.60 | 4.35 | 4.0 | 0.40 | 1.70 | 2.20 | 0.15 | 0.65 | 0.60 | 0.868 / 0.929 | 4.9 | (01) |
| 21 (504) | 3.50 | 0.45 | 1.60 | 4.63 | 4.0 | 0.40 | 1.70 | 2.20 | 0.15 | 0.65 | 0.60 | 0.856 / 0.923 | 3.9 | (01) |

With 200-250 kcal/d and 25-60 g/d carbohydrate (Buchinger-type modified fast): glucose ~4.0-4.8 mM
[36,38], N x0.6 [36], ketones still ~4 mM by day 12 [38], weight loss ~20% smaller (4.5).

**Interpretation for the UI/planner.** Nothing "switches" at a single hour: glycogen falls
continuously; GNG is already ~50% of glucose output at 12 h; lipolysis accelerates most between 18
and 24 h [12]; BHB crosses 0.5 mM around 30 h and 1 mM around 36-40 h; REE does not fall in the
first 72 h (small rise), then falls ~5-12% by days 5-10; N loss peaks on days 1-3 and falls with a
~6-day time-constant (protein sparing) — the per-day lean cost of fasting is highest in the first 3
days, which is why repeated 1-3 day fasts are lean-expensive per kg lost (4.9, 4.10).

### 4.5 Body-mass and composition change during fasts of 1 -> 21 days (feeds 01, 03, 20)

**Mechanism.** Weight lost during a fast = glycogen + its water (days 1-3) + extracellular water from
fasting natriuresis (days 1-5; reversible) + lean tissue from protein oxidation (highest days 1-3) + fat
(steady ~0.2 kg/d). In a 10-day modified fast (200-250 kcal/d, 16 men, 26 kg/m2) weight fell 5.9 kg
(-7%): fat 2.3 kg (40%) and lean soft tissue 3.5 kg (60%), the latter = ECW 1.6 kg (44%), glycogen +
water 0.5 kg (14%) and metabolically active tissue 1.5 kg (42%; i.e. ~25% of weight loss); strength
maintained or improved with ~3 h/d walking; 3-MH rose until day 5 then fell [36]. In 1,422 Buchinger
fasters (58-65% women, mean ~55 y) weight fell 3.2 kg in 5.4 d and 8.6 kg in 20.1 d; men lost more
than women [37]. N loss per kg weight lost during extended fasts is ~20 g N/kg in non-obese vs ~10 g
N/kg when body fat >= 50 kg, and total body N falls bi-exponentially (fast component t1/2 a few days,
slow component many months) [30]. Obese and lean subjects lose similar absolute N, so lean people lose
proportionally more lean mass [29,30].

**Equations (PROPOSED; energy-balance accounting, hourly).**
```
EE_h        = [RMR0 * REERel(tau) + ActivityEE] / 24                    (kcal/h; REERel from 4.4.3)
protein_h   = UrinaryN(d) * 6.25 / 24                                    (g/h)  -> leanTissue_h = UrinaryN(d)/33/24 kg (33 g N per kg lean tissue [36])
glycogen_h  = dLliv (4.3) + muscle glycogen use (PROPOSED 30 g/d for days 0-3.5, ~0 after; UNVERIFIED)
water_glyc  = 3 g water per g glycogen (04 owns this constant)
fat_h       = max(0, EE_h - intake_h - 4.0*glycogen_h - 4.0*protein_h) / 9.4     (g/h)
ecwLoss(d)  = 1.6 kg * (1 - exp(-d/3))  scaled by body mass/80 kg        (PROPOSED fit to [36] end-point; natriuresis of
              fasting is well documented [41,42] but day-by-day volumes not retrieved -> time-constant UNVERIFIED)
Refeeding: ecwLoss and glycogen water return over ~3-7 days of carbohydrate refeeding (04, 13); lean tissue does not.
```

**Model output (80 kg man, RMR 1750 kcal/d, activity 650 kcal/d).** Modified-fast column is validated
against [36] (observed 10-d totals: 5.9 kg; fat 2.3; lean active 1.5; glyc+water 0.5; ECW 1.6).

| Day | Water-only: cum. weight loss kg | fat | lean tissue | glycogen + water | ECW | Modified fast 250 kcal, N x0.6: cum. kg | fat | lean tissue |
|---|---|---|---|---|---|---|---|---|
| 1 | 1.3 | 0.20 | 0.36 | 0.30 | 0.45 | 1.15 | 0.18 | 0.21 |
| 2 | 2.4 | 0.41 | 0.72 | 0.46 | 0.78 | 2.05 | 0.38 | 0.43 |
| 3 | 3.3 | 0.62 | 1.08 | 0.59 | 1.01 | 2.83 | 0.58 | 0.65 |
| 5 | 4.7 | 1.06 | 1.69 | 0.63 | 1.30 | 3.93 | 0.99 | 1.02 |
| 7 | 5.8 | 1.50 | 2.20 | 0.66 | 1.44 | 4.81 | 1.39 | 1.32 |
| 10 | 7.2 | 2.15 | 2.80 | 0.70 | 1.54 | 5.90 (obs 5.9) | 1.98 (obs 2.3) | 1.68 (obs 1.5) |

Women: scale lean loss by 0.8 at equal body mass (direction from [29]; magnitude UNVERIFIED) and use
their lower RMR -> ~20-30% lower daily loss (consistent with smaller losses in women in [37]).
Obese: N floor and peak are similar in absolute terms [29], so fat fraction of loss is larger [30].

**Evidence grade: B** for totals and partition at 10 d (one well-characterised trial + large cohort +
classic N data); **C** for the day-by-day split (proposed accounting).

### 4.6 Time-restricted eating (TRE): what changes, and why

#### 4.6.1 Spontaneous energy-intake reduction vs eating-window length (ad-libitum mode only)

Data (intake change vs control or baseline, ad libitum within the window):

| Window (clock) | Study | Population | Duration | Delta intake | Weight | Notes |
|---|---|---|---|---|---|---|
| 4 h (15-19) | Cienfuegos 2020 [57] | n=16, 88-95% F, BMI 36-37 | 8 wk | -528 +/- 102 kcal/d (-30%); control -105 | -3.2% | FM -2.8 kg, lean -0.8 kg |
| 6 h (13-19) | Cienfuegos 2020 [57] | n=19 | 8 wk | -566 +/- 142 kcal/d (-29%) | -3.2% | FM -1.4 kg, lean -1.5 kg (more lean loss than 4-h group) |
| 4 h, 4 d/wk | Tinsley 2017 [62] | young men + RT | 8 wk | ~-650 kcal on TRF days | n.s. comp. | RT gains preserved |
| 8 h (10-18) | Gabel 2018 [58] | n=23 obese vs historical | 12 wk | -341 +/- 53 kcal/d | -2.6% | SBP -7 mmHg |
| 8 h (12-20) | Lin 2023 [71] | n=90 obese, racially diverse | 12 mo | -425 (SD 531) kcal/d; CR arm -405 | -4.61 kg vs control | TRE = CR (0.81 kg, CI -3.07 to 4.69) |
| 8 h (12-20) | Lowe 2020 TREAT [55] | n=116, BMI 27-43 | 12 wk | no difference in estimated intake | -0.94 vs -0.68 kg (diff -0.26, CI -1.30 to 0.78) | ~65% of weight lost was lean (in-person subset) |
| 8 h (8-16) eTRF | Jones 2020 [69] | 16 lean men | 2 wk | ~-400 kcal/d | -1.04 kg | |
| ~10 h self-selected | Wilkinson 2020 [74] | 19 MetS, window 15.1 -> 10.8 h | 12 wk | -8.6% (1991 -> 1792 kcal/d) | -3.3 kg (-3%) | single arm |
| 8 h (7.5 h achieved) | Tinsley 2019 [63] | RT women | 8 wk | no difference (protein 1.6 g/kg matched) | - | FFM +2-3% all groups |

**Equation (PROPOSED FIT; apply only in `adLib` mode and only if W < habitual W0):**
```
dEI_frac(W) = (W >= W0) ? 0 : -Dmax / (1 + exp((W - W50)/s))      // W0 = user's habitual window (default 14 h)
Dmax = 0.31, W50 = 9.0 h, s = 1.5 h
=> W = 12 h: -4%;  10.8 h: -7%;  10 h: -10%;  8 h: -20%;  6 h: -28%;  4 h: -30%
Between-person SD of the response ~ +/-15 percentage points (Lowe [55]: no intake difference at 8 h; Lin [71]: -425 kcal/d, SD 531).
Persistence: no attenuation detected to 12 months in [71]; time-course of onset ~1-2 weeks (UNVERIFIED).
```
**Grade B-** (several RCTs, but self-reported intake and heterogeneous controls; one null large trial).

#### 4.6.2 TRE at matched energy — is there any calorie-independent benefit?

| Outcome | Best estimate at matched energy | Key evidence | Grade |
|---|---|---|---|
| Weight / fat loss | **~0** (TRE + CR vs CR: -1.8 kg, CI -4.0 to 0.4 at 12 mo, NS [56]; eTRE 10 h + DCR vs DCR: -6.2 vs -5.1 kg NS [72]; TRF + 25% deficit vs deficit: no FM/FFM difference [64]; TRE vs CR equal [71]); only eTRE (7-15) + ER vs >=12 h + ER: -2.3 kg (CI -3.7 to -0.9) but fat -1.4 kg NS, "equivalent to 214 kcal/d" of extra restriction [65] | [56,64,65,71,72] | A |
| 24-h energy expenditure | **~0** (eTRF 8-14 vs 8-20, 4 d, chamber: +10 +/- 16 kcal/d [67]) | [67] | B |
| Fat oxidation | 24-h npRQ -0.021 +/- 0.010 (more fat oxidised) with eTRF [67]; RER 0.83 -> 0.81 with 16:8 [59] — a timing shift in substrate use, not extra fat loss | [59,67] | B |
| Lean mass (no RT, no protein control) | risk of higher lean fraction: TREAT in-person ALMI -0.16 kg/m2 vs control (CI -0.27 to -0.05), lean ~65% of weight lost [55]; lean -3.0% vs fat -4% [73]; 6-h TRF lean -1.5 kg [57] | [55,57,73] | B |
| Lean mass with RT + adequate protein | **~0** (FFM +2-3% in all groups, 1.6 g/kg/d [63]; FFM maintained [59,60,64]; meta RT populations FFM +0.27 kg, CI -0.80 to 1.34 [83]; TRE+exercise FFM n.s. [82]) | [59,60,63,64,82,83] | A- |
| Insulin sensitivity | eTRF isocaloric (8 prediabetic men, 5 wk crossover, 6-h window ending 15:00): mean insulin -26 +/- 9 mU/L, insulinogenic index +14 U/mg [66]; eTRF vs weight-matched CR: whole-body insulin sensitivity and muscle glucose/BCAA uptake up [69]; 9-h TRF improved glucose iAUC regardless of early/late clock [70]; NMA eTRE vs late TRE fasting insulin -3.32 uIU/mL (not energy-matched) [77] | [66,69,70,77] | C |
| Blood pressure | eTRF isocaloric: SBP -11 +/- 4, DBP -10 +/- 4 mmHg [66] (n=8); eTRE + ER DBP -4 mmHg (CI -8 to 0) [65]; TREAT no BP effect [55]; meta TRE vs usual SBP -3.07 (CI -5.76 to -0.37) (not energy-matched) [76] | [55,65,66,76] | C |
| Glycaemia (CGM) | eTRF 4 d: mean 24-h glucose -4 +/- 1 mg/dL, excursions -12 +/- 3 mg/dL [68] | [68] | B |
| Oxidative stress | 8-isoprostane -11 +/- 5 pg/mL (-14%) isocaloric [66]; -34 to -37% with weight loss [57] | [57,66] | C |
| Lipids | morning fasting TG +57 mg/dL after longer pre-test fast in eTRF [66] (measurement artefact of fast length); TRE vs whole-day fasting small LDL increase [78] | [66,78] | C |
| Hormones (men, lean, RT) | testosterone -21% (21.3 -> 16.9 nmol/L), IGF-1 -13%, T3 -11% at 8 wk, strength and FFM unchanged [59]; free T and IGF-1 down in cyclists [60] | [59,60,50] | B |
| Appetite | eTRF: evening desire to eat -22 +/- 7 mm, capacity -23 +/- 6 mm, fullness +31 +/- 6 mm [66]; ghrelin -32 +/- 10 pg/mL, hunger "more even-keeled" [67] | [66,67] | B |

Synthesis: meta-analyses conclude that TRE's benefits are "primarily due to energy deficit, followed by
alignment with eating time of day" [81]; intermittent fasting is not better than regular dietary advice
at 6-12 months (percentage weight difference -0.33, CI -0.92 to 0.26) [85]; TRE ~ CER for weight
[78,79]. **Engine rule:** at user-specified kcal and protein, TRE modifies only (i) appetite/hunger
(4.7-4.8), (ii) postprandial glucose via clock position (4.7), (iii) small isocaloric
insulin-sensitivity/BP effects if the window ends early (<= 15:00): SBP -3 mmHg, DBP -3 mmHg, fasting
insulin -10% (PROPOSED shrinkage of [65,66,69,77] toward null; grade C), and (iv) lean-mass risk when
daily fasts exceed ~18 h without RT or with protein < 1.2-1.6 g/kg (handled mechanistically by 03 via
per-meal protein and by the fasting N-excretion in 4.4).

### 4.7 Clock position of eating: early vs late (circadian effects)

#### 4.7.1 Glucose tolerance by clock time (real at matched meals)

**Data.** Identical meals: postprandial glucose 17% higher at 20:00 than 08:00 attributable to the
circadian system (independent of the behavioural cycle), with 27% lower early-phase insulin; circadian
misalignment (12-h inverted behaviour) adds +6% [87]. Identical meals at 07:00/13:00/19:00: glucose
excursion lowest at breakfast; beta-cell responsivity and disposition index highest at breakfast;
hepatic insulin extraction lowest at breakfast [93]. Same meal 08:00 vs 20:00: evening glucose and
insulin responses larger and delayed [89]. Dinner at 22:00 vs 18:00 (sleep 23:00-07:00): 4-h glucose
AUC +18% (522 vs 443 mg/dL.h), peak 150 vs 127 mg/dL, mean 20-h glucose 105.8 vs 99.8 mg/dL, dietary
fatty-acid oxidation 74.5% vs 84.5% of the tracer dose, cortisol higher, no change in sleep
architecture; effects larger in habitually earlier sleepers (+6.8% glucose intolerance per hour
earlier bedtime) [100]. Review of circadian glucose regulation [94].

**Equation (PROPOSED FIT to [87,100]).** Multiplier on the postprandial glucose excursion computed by 04:
```
mClock(t)  = 1 + 0.0142 * clamp(t - 8, 0, 14)        // t = meal clock hour (0-24, shift-adjusted to habitual wake+1h = 8)
                                                     // 08:00 -> 1.00, 13:00 -> 1.07, 20:00 -> 1.17, 22:00 -> 1.20
mSleep     = 1 + 0.15 * overlapFrac                   // overlapFrac = fraction of the 4-h post-meal window overlapping the sleep period
mMisalign  = 1.06 if eating during biological night of a shift worker (07/16), else 1
glucoseExcursionMult = mClock * mSleep * mMisalign
check: 22:00 dinner, sleep 23:00 (overlap 3/4): 1.20*1.11 = 1.33 vs 18:00 dinner 1.14 -> ratio 1.17 (obs +18% [100])
```
Also: dietary fat oxidation of a late meal x0.88 (84.5 -> 74.5%) [100] (hand to 05; grade C).
**Grade: A** (direction; >= 4 controlled lab studies), **B** (magnitude).

#### 4.7.2 Fasting-induced ("physiological") insulin resistance of the next meal

A 24-h fast reduced next-morning insulin sensitivity from 5.7 to 2.6 x10^-4 /min per mU/L (-54%) and the
acute insulin response by 22%, with overnight FFA AUC x2.8; lowering FFA with acipimox raised the
disposition index 31% [26]. After a 72-h vs 13-h fast, glucose and insulin excursions to a normal meal
were larger, carbohydrate oxidation lower and fat oxidation higher (12-h carbohydrate balance +24 vs -57
g) [27]. One meal/day (eaten 16-20 h) raised morning fasting glucose and impaired morning OGTT with a
delayed insulin response, reversible [115].
```
SIrel_nextMeal(tau) = 1 - 0.60 * (1 - exp(-p(tau - 12)/6))     // 24 h -> 0.48 (obs 0.46 [26]); plateau -60%
recovers with Toff = 12 h after the first carbohydrate meal (PROPOSED; D)
```
Use: multiplies insulin sensitivity in 04 for the first meal(s) after a long fast. Explains why OGTTs
after long overnight fasts look "worse" in TRE arms and why morning TG rises (+57 mg/dL [66]) — a
measurement-timing artefact the UI must not report as harm. **Grade B** (direction), **C** (shape).

#### 4.7.3 Thermic effect of food (TEF/DIT) by clock time

Early DIT (up to 114 min) was 44% lower after an 8 PM than an 8 AM identical meal, 50% lower in the
biological evening, independent of behaviour; misalignment had no effect [88]. Morning DIT > afternoon
> night (3 h post-meal) [90]. Same meal at 08:00 vs 20:00: post-meal RMR 1916 vs 1756 kcal/d, i.e. a
morning excess of 90.5 kcal/d (CI 40.4-140.6) in the RMR rate measured 2-3 h after the meal [89].
Richter 2020 reported 2.5x higher DIT after breakfast than dinner [91]; a published critique notes
the pre-dinner baseline was measured only 4.5 h after lunch (DIT lasts >= 6 h), post-meal measurement
lasted only 3.5 h (4-h DIT underestimates 6-h DIT by 10-20%), DIT after the low-calorie dinner was
negative ("physiologically implausible"), and the absolute difference was only ~55 vs ~30 kcal [92].
Energy expenditure is displaced, not lost: 2 vs 6 meals gave equal 24-h EE (9.96 vs 10.00 MJ) but higher
night-time EE after the late large meal [107]. **Whole-day** measurements show no net effect:
morning- vs evening-loaded isoenergetic diets for 4 weeks: TDEE (doubly labelled water) 2871 vs 2846
kcal/d (p = 0.18), RMR 1675 vs 1690 kcal/d [96]; eTRF vs control 24-h EE +10 +/- 16 kcal/d [67].
```
TEF_total(meal) = TEF from 02 (unchanged by clock time)
TEF_shape: evening/night meals -> same area, peak x0.6 and duration x1.4 (PROPOSED; only redistributes hourly EE)
optional net penalty (sensitivity analysis only): -0.10 * TEF of meals eaten after 18:00 (<= ~10 kcal/d)
```
**Grade B** that acute DIT is lower in the evening; **A-/B** that 24-h/TDEE is unchanged (DLW + chamber).

#### 4.7.4 Late eating, hunger and energy expenditure

Meals delayed by 4 h 10 min (last meal 2.5 h vs 6.7 h before bed) under strict control of intake, sleep,
activity and light (n = 16, BMI 28.7): hunger OR 2.02, strong desire to eat OR 1.73, desire for starchy
foods OR 2.24; waketime leptin -16%, 24-h ghrelin:leptin +12%; waketime EE -59.4 +/- 13.9 kcal/d
(-5.0%); 24-h core temperature -0.19 degC; no change in carbohydrate/fat oxidation; adipose gene
expression shifted toward lipid synthesis [95]. Contrast: no TDEE difference by DLW for evening- vs
morning-loaded intake over 4 weeks [96].
```
lateness L_h = max(0, 4 - lastMealToSleep_h)                 // hours by which the last meal is closer than 4 h to bedtime
Hshift += 7 mm * (L_h / 4)   (VAS 0-100; PROPOSED: maps OR ~2 for a 4-h delay to ~+7 mm mean hunger; D->C)
EE_late = 0 default; sensitivity band [-60, 0] kcal/d for a 4-h delay [95,96]   (grade C)
```

#### 4.7.5 Morning- vs evening-loaded energy at equal intake

| Study | Design | Result |
|---|---|---|
| Jakubowicz 2013 [97] | 12 wk, overweight/obese women with MetS (BMI 32.4), ~1400 kcal: 700/500/200 vs 200/500/700 | -8.7 +/- 1.4 vs -3.6 +/- 1.5 kg (p < 0.0001) [98]; TG -33.6% vs +14.6%; lower hunger, glucose, insulin with big breakfast; free-living, self-reported adherence |
| Ruddick-Collins 2022 [96] | 30 adults (BMI 32.5), 2 x 4 wk crossover, all food provided at 1.0 x RMR, 45/35/20 vs 20/35/45 | weight -3.33 vs -3.38 kg (p = 0.85); TDEE, RMR, activity no difference; breakfast TEF 147 vs 98 kcal; hunger, desire to eat lower with morning loading; CGM higher 20:00-24:00 on evening loading |
| Garaulet 2013 [99] | observational, 420 adults, 20-wk programme | late lunch (after 15:00): -7.7 vs -9.9 kg; similar reported intake (1388 vs 1426 kcal/d) |
| Young 2023 meta [104] | 9 RCTs, energy-reduced diets | earlier distribution -1.23 kg (CI -2.40 to -0.06) |
| Liu HY 2024 meta [80] | RCTs >= 12 wk | earlier calorie distribution -1.75 kg (CI -2.37 to -1.13); TRE -1.37 kg; lower meal frequency -1.85 kg (not energy-matched) |
| Chen 2026 NMA [77] | 41 TRE RCTs | eTRE vs late TRE: -1.15 kg (CI -1.86 to -0.45), fasting insulin -3.32 uIU/mL; high certainty (intake not matched) |

**Interpretation / engine rule.** The weight benefit of earlier eating appears in free-living trials
(~1-1.5 kg over ~3 months) but not when intake is controlled and TDEE is measured by DLW -> it acts
through appetite/adherence. In `adLib` mode: `dEI_frac = -0.05 * clamp((fracEnergyBefore14 - 0.4)/0.3, -1, 1)`
(PROPOSED; ~ -100 to -125 kcal/d for moving 30% of energy earlier, matching -1.2 to -1.75 kg over ~12 wk
[80,104]; grade C). In `specified` mode: 0 kcal effect,
but hunger shift `Hshift = -5 mm` for >= 45% of energy before 14:00 (direction [96,97]; magnitude D).

#### 4.7.6 Breakfast skipping (morning fast)

Lean adults, 6 wk, >= 700 kcal breakfast before 11:00 vs 0 kcal until 12:00: RMR stable within 11 kcal/d;
energy intake +539 kcal/d (CI 157-920) with breakfast; physical-activity thermogenesis +442 kcal/d (CI
34-851); no difference in body mass; afternoon/evening glycaemic variability higher when fasting (CV +3.9%)
[101]. Obese adults: morning PAT +188 kcal/d (CI 40-335), 24-h PAT +272 (CI -254 to 798), EI +338 (CI
-313 to 988), RMR within 8 kcal/d, insulinaemic OGTT response better with breakfast (p = 0.05) [102].
Meta of 13 RCTs: breakfast adds +260 kcal/d (CI 79-441) and +0.44 kg (CI 0.07-0.82) [103]. Obese women
in a chamber: a morning fast did not change 24-h energy balance [107].
```
adLib: skip breakfast -> dEI = -260 kcal/d (SD ~ 300)   [103]  (grade B)
activity: lean users, optional dNEAT = -0.5 * dEI (PROPOSED from [101]; grade C); obese: 0 (24-h PAT n.s. [102])
RMR: 0 (grade A-)
```

### 4.8 Meal frequency (1 -> 17 eating occasions/day) at equal energy

| Outcome | Finding | Evidence | Grade |
|---|---|---|---|
| 24-h EE / TEF | **No effect.** 2 vs 6 meals 9.96 vs 10.00 MJ/d (p = 0.88) [107]; 3 vs 2 meals no effect on 24-h EE, DIT, sleeping MR [109]; 3 vs 6 meals 8.7 vs 8.6 MJ/d [111]; 3 vs 14 meals TEE 12.3 vs 12.1 MJ/d (p = 0.12), RMR incl. DIT 8.5 vs 8.0 MJ/d (p = 0.006) [110]; whole-body calorimetry and DLW find no difference between nibbling and gorging [108] | [107-111] | A |
| Fat oxidation | 3 vs 6: 24-h fat oxidation 82 vs 80 g/d, RQ 0.85 both [111]; 3 vs 14: no difference [110]; 3 vs 2: 24-h fat oxidation higher with 3 [109] | [109-111] | B (null) |
| Protein oxidation | higher with 3 large vs 14 small meals [110] | [110] | C |
| Body composition, hypocaloric | 3 vs 6 occasions, -2931 kJ/d, 8 wk: no difference in weight, FM, lean, appetite, PYY, ghrelin [112]; meta of 15 studies: apparent benefit of more meals on FM/FFM disappeared after removing a single study [106]; "with the exception of a single study, there is no evidence that weight loss on hypoenergetic regimens is altered by meal frequency" [108] | [106,108,112] | A (null) |
| Body composition, eucaloric 1 vs 3 meals | 1 meal/day (17:00-21:00), 8 wk crossover, 15 normal-weight adults: FM -2.1 kg, weight -1.4 kg, FFM n.s.; hunger higher; SBP 116.1 vs 109.5 mmHg, DBP 69.8 vs 66.0; TC 216.5 vs 191.0, LDL 136.2 vs 113.3, HDL 61.9 vs 56.7 mg/dL; morning cortisol 7.2 vs 14.1 ug/dL; intake 2364 vs 2429 kcal/d [114]; 1 meal/day (17-19 h), 11 d, 11 lean: weight -1.4 vs -0.5 kg, FM -0.7 vs -0.1 kg, exercise fat oxidation up, performance unchanged [116] | [114,116] | C (small, likely residual energy deficit + water) |
| Hunger / appetite | 1 vs 3 meals: hunger, desire to eat, prospective consumption higher [114]; 2 vs 3: 3 meals raised 24-h satiety [109]; 3 vs 6: hunger AUC ~14% and desire-to-eat AUC ~14% higher with 6 [111]; 3 vs 6 (energy restriction, normal/high protein): no difference [113]; 3 vs 14: 3 meals increased satiety, reduced hunger [110] | [109-111,113,114] | B-: minimum hunger at ~3 meals |
| Glycaemia | fewer, larger meals: larger glucose/insulin excursions but lower 24-h glucose AUC (3 vs 14) [110]; 1 meal/day: higher fasting glucose, impaired morning OGTT [115]; 17 snacks vs 3 meals (2 wk, 7 men): mean insulin -27.9%, 24-h C-peptide -20.2%, glucose unchanged [117] | [110,115,117] | B |
| Lipids | 17 snacks vs 3 meals: TC -8.5%, LDL -13.5%, apoB -15.1% [117]; 1 vs 3 meals: LDL +23 mg/dL [114] | [114,117] | C |
| Muscle protein synthesis (acute) | 80 g whey over 12 h post-RT: 4 x 20 g gave 31-48% greater MPS than 8 x 10 g or 2 x 40 g [118]; 24-h MPS +25% with even (30/30/33 g) vs skewed (11/16/63 g) protein [119]; but whole-body net protein balance depends on protein quantity, not pattern, in older adults [120]; pulse (80% at noon) > spread pattern for N balance in elderly women [121]; 100 g single dose -> larger, >12 h anabolic response than 25 g [5] | [5,118-121] | B (acute) |
| Lean mass / hypertrophy (chronic) | protein timing effect vanishes when total protein is matched; total intake is the strongest predictor [122]; ~7.5 h vs ~13 h feeding with 1.6 g/kg/d: equal FFM accretion and hypertrophy [63] | [63,122] | B |

**Equations (PROPOSED).**
```
TEF/EE: no meal-count term (use 02's TEF proportional to energy & macros).
Hunger offset (VAS mm, to 12):  Hshift_meals(n) = +8*(n==1) + 3*(n==2) + 0*(n==3) + 3*(n in 4..6) + 6*(n>=7)
                                 (direction from [109-111,114]; magnitudes PROPOSED, grade C/D)
Glycaemic variability index (UI only): GVI = sum over meals of carb_g * glucoseExcursionMult -> fewer, larger, later carb meals raise peaks
Per-meal protein: handled by 03's per-meal MPS saturation; engine should NOT add an extra meal-count
penalty to chronic lean mass when protein >= 1.6 g/kg/d and RT present [63,122].
```

### 4.9 Alternate-day fasting (ADF), 5:2 and periodic fasting vs continuous restriction (CER)

(13 owns scheduling/transitions; this is the fasting-physiology view.)

| Study | Protocol | Result |
|---|---|---|
| Heilbronn 2005 [128] | 16 non-obese (8M/8F), 36-h zero-energy fasts alternate days, 22 d | weight -2.5 +/- 0.5%, FM -4 +/- 1%; hunger rose on fast days and did not habituate; RMR, RQ unchanged at day 21; at end of 36-h fast RQ fell (>= 15 g/d extra fat oxidation); fasting insulin -57% |
| Heilbronn 2005 [129] | same cohort, meal test after 36-h fast | glucose response slightly impaired in women (p < 0.01); men unchanged glucose, lower insulin response |
| Templeman 2021 [124] | lean adults, 3 wk: 0:150 (24-h fast then 150%) vs 75:75 CER vs 0:200 (fasting without deficit) | body mass -1.60 vs -1.91 kg (p = 0.46); fat -0.74 +/- 1.32 vs -1.75 +/- 0.79 kg (p = 0.01); 0:200: -0.52 kg mass, -0.12 kg fat; no fasting-specific effect on postprandial metabolism, gut hormones or adipose genes |
| Catenacci 2016 [125] | obese, zero-kcal ADF vs CR -400 kcal/d, 8 wk + 24 wk follow-up | ADF deficit 376 kcal/d larger; weight -8.2 vs -7.1 kg n.s.; no body-comp difference at 8 wk; lean/fat changes more favourable in ADF at 24-wk follow-up |
| Trepanowski 2017 [123] | obese (86 F/14 M), ADF 25%/125% vs CR 75%, 12 mo | weight -6.8% vs -6.8% (6 mo), -6.0 vs -5.3% (12 mo); dropout 38% vs 29%; ADF ate more than prescribed on fast days and less on feast days; LDL +11.5 mg/dL (CI 1.9-21.1) vs CR at 12 mo |
| Harvie 2011 [126] | 107 premenopausal overweight women, 2 d/wk ~2710 kJ vs CER ~6276 kJ/d, 6 mo | weight -6.4 vs -5.6 kg (p = 0.4); fasting insulin -1.2 uU/mL and HOMA -1.2 more with IER |
| Harvie 2013 [127] | 115 women, IECR (2 d/wk < 40 g CHO) vs 25% DER, 3 mo | body fat -3.7 vs -2.0 kg; HOMA-IR reduction greater with IECR |
| Stekovic 2019 [130] | healthy non-obese, strict ADF (36-h fasts) 4 wk | spontaneous 37% calorie reduction; trunk fat down; BHB up even on non-fasting days; LDL, sICAM-1 and T3 lower |
| Johnstone 2002 [135] | 24 lean adults, 36-h fast (~12 MJ deficit) | next-day ad-lib intake 12.2 vs 10.2 MJ (+2.0 MJ, ~17% of deficit compensated) |
| Beaulieu 2021 [134] | 46 women, ADF 25% vs CER 75% to >= 5% WL | final WL 4.7 kg both; feed-day intake not above baseline; fast-day hunger +15 mm (CI 10-21) vs feed days; light PA -18 min/d on fast days |
| Meta: Cioffi 2018 [132] | 11 RCTs, 8-24 wk | IER vs CER weight -0.61 kg (CI -1.70 to 0.47); fasting insulin -0.89 uU/mL (CI -1.56 to -0.22) |
| Meta: Alhamdan 2016 [133] | ADF vs VLCD (matched) | ADF: weight -4.30, FM -4.06, FFM -0.72 kg (FFM ~17% of loss); VLCD: -6.28, -4.22, -2.24 kg (~36%) |
| Review: Varady 2011 [131] | intermittent vs daily CR, 3-12 wk | similar weight (4-8% vs 5-8%) and FM loss; less FFM lost with intermittent CR |
| NMA: Semnani-Azad 2025 [78] | 99 RCTs, 6582 adults | ADF vs CER -1.29 kg (CI -1.99 to -0.59, moderate certainty, mostly < 24 wk); ADF vs TRE -1.69 kg; ADF vs whole-day fasting -1.05 kg; no differences >= 24 wk |
| Meta: Elortegui Pascual 2023 [79] | 24 RCTs | IF vs CER +0.26 kg (CI -0.31 to 0.84); ranking ADF > CER > TRE |
| Meta: Siles-Guerrero 2024 [84] | 10 RCTs, obese | fasting strategies vs CCR: weight -0.94 kg, FM -1.08 kg short term; lean mass similar; fasting insulin -7.46 pmol/L |

**Physiology-based rules for the engine.**
1. Weight/fat change = energy balance (01) driven by the day-by-day intake pattern; do **not** add a
   fasting bonus. ADF's small NMA advantage (-1.29 kg) is consistent with a larger achieved deficit
   (e.g. +376 kcal/d in [125]). Grade A.
2. Lean/fat partition: the fasting module's N-excretion (4.4) automatically charges extra protein
   oxidation during each >= 24 h fast (days 1-2 of a fast are the most protein-expensive), and 03 credits
   anabolic refeeding. Expected emergent result: in **lean** people, alternate 24-h fasts lose ~50% of
   weight as non-fat (Templeman: fat 46% of loss vs 92% with CER [124]); in **obese** people, partition ~
   same as CER or better [125,131,133]. Calibrate `Npk` so both are reproduced (section 7, targets 7 and 9). Grade B/C.
   Caveat: part of the DXA "lean" loss on a fast-day protocol is glycogen + water, sensitive to the day
   of measurement.
3. Appetite: fast-day hunger +15 mm vs feed days [134], not habituating over 3 weeks [128]; next-day
   compensation after a 36-h fast +17-20% of maintenance [135]; in 12-month ADF, prescribed fast-day
   intake overshoots and feast-day intake undershoots [123] -> in `adLib` mode apply
   `feedDayEI = maint * (1 + 0.15)` after a >= 24 h fast (PROPOSED; range 0-0.2) and fast-day
   adherence slippage (25% prescribed -> ~35% achieved; UNVERIFIED magnitude, direction [123]).
4. Glycaemia/insulin: small extra fall in fasting insulin with IER (-0.9 to -1.2 uU/mL [126,132]);
   women: possible slight impairment of meal glucose tolerance after 3 wk ADF [129] (4.14).
5. Lipids: ADF LDL +11.5 mg/dL vs CR at 12 months [123] (hand to 06 as grade C); ADF lowered TC, TG,
   non-HDL vs TRE in NMA [78].
6. Adherence/dropout: ADF 38% vs CR 29% at 12 months [123] (planner cost term, 18).

### 4.10 Extended fasting (2 -> 21+ days): energy expenditure, electrolytes, refeeding (hand-off to 20)

The continuous trajectories of 4.4-4.5 already cover 0-21 d. Additional quantitative facts:

- **REE.** +6% at 36 h, back to +2.6% (n.s.) at 72 h (29 adults) [18]; +14% day 1 -> day 3 with
  noradrenaline x2.2 by day 4 (11 lean) [17]; -8% after 3 d (6 men) [19]; -12% at day 10 of a
  200-250 kcal fast, still lower after adjustment for lean soft tissue [36]. In 21-d fasts of obese
  subjects, resting energy requirement per unit mass stayed constant while fat and FFM fell in
  parallel [33]. Model: `REERel` (4.4.3), adaptive component 02. Grade C (conflicting short-term data).
- **Fuel mix late in starvation.** Aminogenic oxidation ~7% of energy; minimal amino-acid and fat
  oxidation 0.27 and 1.53 g per kg body weight per day (0.52 and 2.98 g per kg FFM) [33]; urinary N
  from 14.5 g/d (men, early) to 3.0 g/d (obese women, week 4); protein supplies ~15% (normal men,
  6-d fast) to 5% (obese women, 4th week) of energy [29]. Brain switches predominantly to
  beta-hydroxybutyrate/acetoacetate after 5-6 wk [31]; glucose production ~86 g/d at 5-6 wk, liver and
  kidney ~half each [32]; FFA/ketones plateau only after ~17 d [32].
- **Blood pressure & labs (Buchinger modified fast, n = 1422, 4-21 d)** [37]: SBP 131.6 -> 120.7 mmHg,
  DBP 83.7 -> 77.9 mmHg; uric acid 338 -> 495 umol/L (+46%); urea 4.7 -> 3.1 mmol/L; Na 140.1 -> 138.7
  mmol/L (six cases of mild hyponatraemia, lowest 127 mmol/L); K unchanged (4.4); glucose to the
  low-normal range; ketones up; 93.2% reported no hunger; most frequent mild symptom sleep disturbance
  14.9%; adverse events < 1% (arrhythmia 0.21%, hyponatraemia 0.21%, hypoglycaemia 0.14%,
  hospitalisation 0.14%, one gout attack in a known gout patient). Higher ketonuria in men, younger,
  heavier subjects, and associated with larger uric-acid rise [38].
- **Muscle function.** 10-d modified fast + ~3 h/d walking: strength maintained (non-weight-bearing) or
  +33% (weight-bearing), 3-MH peaked day 5, LST still -2.3 to -3.2% at 3 months [36]. 72-h fast:
  muscle net phenylalanine release up, mTOR phosphorylation ~-50%, LC3B-II +30% [20]; leucine flux +31%,
  oxidation +46% at 3 d [19].
- **Electrolytes & water.** Fasting natriuresis (renin/aldosterone/glucagon-linked) [41,42] drives the
  early ECW loss (~1.6 kg by day 10 [36]); serum Mg falls in 1-week modified fasts [39]; prolonged
  (60-day) therapeutic starvation in 18 obese patients was "in general ... safe" but with "significant
  associated hazards, particularly a breakdown in electrolyte homoeostasis" [40].
- **Refeeding.** NICE CG32 high-risk criteria: one of BMI < 16, unintentional loss > 15% in 3-6 mo,
  little/no intake > 10 days, low K/PO4/Mg before feeding; or two of BMI < 18.5, loss > 10%, little/no
  intake > 5 days, alcohol/drug history (insulin, chemotherapy, antacids, diuretics). High-risk refeeding
  starts at <= 10 kcal/kg/d (5 kcal/kg/d if BMI < 14 or negligible intake > 15 d), rising to full needs
  over 4-7 days, with thiamine 200-300 mg/d and B-vitamins for the first 10 days [43]; ASPEN consensus
  [44]. After a 72-h fast a normal meal causes larger glucose/insulin excursions and a positive 12-h
  carbohydrate balance (glycogen refill) [27]; leptin recovers within ~24 h [22]; T3/rT3 within ~5 d [25].
- **Hunger during fasts.** Ghrelin keeps pulsing at habitual meal times during a 24-h fast (~8 pulses/24 h,
  overall slight decline) [28], so hunger is entrained to the usual meal clock; on alternate-day 36-h fasts
  hunger rose on fast days and did not habituate over 22 days [128]; fast-day hunger +15 mm vs feed days
  [134]; in supervised 4-21-day modified fasts 93.2% reported no hunger, mild symptoms clustering in the
  first days [37]. PROPOSED hunger offset for 12: `Hfast(tau) = +15 mm * (x*exp(1-x))`, `x = p(tau-12)/18`
  (peaks ~30 h, ~+5 mm by day 3, ~0 by day 5) plus a meal-clock oscillation of the usual amplitude
  (grade C).
- **Classic starvation physiology** (fuel hierarchy, ketone-driven protein sparing, brain ketone use) is
  reviewed in [34]; quantitative anchors used here are the primary data [29-33].
- **Composition of weight loss by day** — table in 4.5; dossier 20 should adopt `UrinaryN(d)`,
  `ecwLoss(d)`, `REERel(tau)` and the Laurens/Buchinger targets (section 7, targets 7-8) to stay consistent.

Grade: **B** for 5-10-day modified fasting (large cohort + mechanistic trial), **C** for water-only > 7 d
in non-obese people (mostly historical, obese cohorts).

### 4.11 Fasted vs fed exercise; training inside vs outside the eating window (brief; 03, 09, 10 own)

- Aerobic exercise after an overnight fast oxidises more fat during the session: +3.08 g per session
  (CI 0.79-5.38) vs fed; fed state has higher glucose (+0.78 mmol/L) and insulin (+104.5 pmol/L) [137].
- No body-composition advantage: 4 wk of 1 h fasted vs fed cardio 3x/wk in hypocaloric women gave equal
  weight and fat loss [136]. Grade B. -> Engine: session fat oxidation shift only (05/10); no chronic
  fat-mass term.
- Resistance training with TRE: equal FFM gains/maintenance with 8-h windows when protein matched
  (1.6 g/kg/d) [63], with isocaloric 16:8 (training inside the window) [59], and with a 25% deficit +
  1.8 g/kg/d protein [64]; meta in RT populations FFM +0.27 kg (CI -0.80 to 1.34), FM -1.25 kg (CI -1.95 to
  -0.54) [83]; 12 months TRE + RT: lower body mass, FM, IGF-1 and testosterone vs normal diet, with
  spontaneous intake reduction [61]. Protein timing around the session does not matter once total
  protein is matched [122]. Grade B.
- Engine rule: training "outside" the window only matters through 03's per-meal MPS response: the
  exercise-sensitised MPS window lasts >= 24 h (03), so any protein-containing meal within the same
  window counts; no extra penalty unless the session is followed by >= ~16 h without protein
  (PROPOSED flag; grade D).

### 4.12 "Metabolic switching" (glucose -> ketone): what is substantiated in humans

| Claim [51-54] | Human evidence | Verdict |
|---|---|---|
| The switch (glycogen depleted, FFA/ketones up) occurs "typically beyond 12 hours" / "between 12 to 36 hours" after the last meal [51] | GNG 64-67% by 22 h [6,7]; lipolysis rise mostly 18-24 h [12]; BHB 0.15 mM at 18 h [68], ~0.3-0.4 mM at 24 h, 1.2-1.9 mM at 48 h [13]; ketonaemia detectable ~21 h (17.5 h with exercise) [38] | **Substantiated** as a graded transition centred ~24-36 h; exercise/low-carb diets advance it (A) |
| 16:8 or 18:6 TRE flips the switch daily | BHB only 0.15 mM after eTRF's 18-h fast [68] | **Mostly not**: daily TRE produces a mild, not a ketotic, state (B) |
| Switching yields benefits independent of weight loss | 0:200 alternate-day fasting without deficit: no fat loss, no change in postprandial metabolism, gut hormones or adipose genes [124]; TRE benefits "primarily due to energy deficit" [81]; IF ~ CER in NMA [78]; isolated positives: eTRF insulin/BP (n=8) [66], eTRF muscle insulin sensitivity [69] | **Weak/unsubstantiated** beyond the deficit (C) — the planner must not award health points for "switch hours" per se |
| Ketones preserve muscle once the switch occurs | N excretion falls with a ~6-d time-constant as ketosis deepens [29,36]; but early fasting days are protein-expensive (N peak d1-3) [29] | Protein sparing is real **only after several days**; short repeated fasts repeatedly incur the expensive phase (B) |
| Brain/cognition benefits of switching | animal data and reviews [52,53]; humans: well-being up, hunger absent in 93% on long modified fasts (uncontrolled) [37] | D/C (08, 19 own) |

### 4.13 Sleep interactions (brief; 16 owns sleep)

- Late dinner (22:00, 1 h before bed) vs 18:00: no change in total sleep time, efficiency, latency or
  stages by polysomnography; nocturnal glucose intolerance and higher cortisol [100].
- Cross-sectional: nocturnal energy/fat intake correlated with worse sleep latency/efficiency, mainly in
  women [105] (C).
- Meta-analysis of 18 IF RCTs (15 TRE): no overall effect of IF on sleep vs ad-lib eating [86]; eTRE no
  sleep difference at 14 wk [65]; 10-h TRE: "feeling rested" on 88% vs 70% of days (single arm) [74].
- Extended fasting: sleep disturbance the most frequent mild symptom (14.9%), mainly first days [37];
  1-week modified fast: fewer arousals and periodic leg movements, better subjective sleep (n = 13,
  uncontrolled) [39].
- Engine: `sleepQualityDelta = 0` for meal timing (default), flag "large meal < 2 h before bed" only as a
  glycaemia/GI-comfort note; extended fast days 1-3: `sleepQualityDelta = -small` (PROPOSED, D).

### 4.14 Sex differences

| Aspect | Finding | Model modifier | Grade |
|---|---|---|---|
| Basal lipolysis / FFA | women higher basal glycerol Ra (2.1 vs 1.5 umol/kg/min at 14 h) but smaller relative rise by 22 h (+40% vs +80%) [48]; postabsorptive FFA higher in women, rising faster in men early [13]; women's FFA and ketones rose faster over 72 h (insulin-matched) [45] | women: GlycerolRa x1.3 at 12 h, amplitude x0.6 through 24 h; FFA +0.1 mM | B |
| Glucose during fasting | women lower glucose after 38 h (with higher FFA) [47] and fall further over 72 h [45]; opposite at 48 h in one study (4.4 vs 4.05 mM) [13]; in 72-h fasts (60 women, 20 men of normal weight + 16 obese), glucose < 55 mg/dL (3.05 mM) never occurred in the obese of either sex, implying such values do occur in normal-weight fasters [46] | women: glucose floor 3.2 mM (vs 3.5), hypoglycaemia flag earlier (section 9) | B/C |
| Ketones | 48 h BHB F 1.22 vs M 1.94 mM [13] vs faster rise in women [45]; long fasts: higher ketonuria in men [38] | no default sex term (conflicting); uncertainty +/-40% | C |
| Protein loss | at equal weight men lose more N [29] | women Npk x0.8 (magnitude UNVERIFIED) | C |
| Weight loss in long fasts | men lose more weight and waist [37] | via RMR/FFM | B |
| Glucose tolerance with ADF | women slightly impaired meal glucose response after 22 d ADF; men lower insulin response [129] | women on ADF: meal glucose x1.05 (PROPOSED) | C |
| Reproductive axis | 3-d mid-follicular fast: fewer LH pulses on day 3, but normal follicle development, ovulation and cycle length (n = 10) [49]; IF lowers androgens/FAI and raises SHBG in premenopausal women with obesity, esp. eating before 16:00; no change in estrogen, gonadotropins, prolactin [50]; men: 72-h fast testosterone -40%, LH -25% [23]; TRE in lean active men testosterone -21% [59] | women: no cycle disruption modelled for <= 3-d fasts; flag for repeated long fasts/low energy availability (16, 17) | C |
| GH, cortisol, NE responses | data almost entirely in men [14-17,23]; both sexes similar pattern in [18] | apply same curves (UNVERIFIED for women) | C |

### 4.15 Deliverable (a): implementable fed/fasted state machine (hourly, 0 h -> weeks, repeat-safe)

```ts
// ---- constants (see 4.1-4.4) ----
const kGE = 270, KGE = 150, LAG = 0.5, FED_THR = 30, TAU_REF_ABS = 4.5;
type Phase = 'ABSORPTIVE' | 'POSTABSORPTIVE' | 'GLUCONEOGENIC' | 'KETOTIC' | 'PROLONGED';

function stepHour(s: State, mealsThisHour: Meal[], ctx: Ctx): State {
  // 1) gut: add meals, empty with saturating kinetics (sub-steps of 0.25 h)
  for (const m of mealsThisHour) s.gut.push({kcal: m.kcal, macros: m.macros, tStart: ctx.t, lag: m.liquid ? 0 : LAG});
  let absorbed = 0;
  for (let k = 0; k < 4; k++) {
    const E = s.gut.reduce((a, g) => a + (ctx.t + k*0.25 >= g.tStart + g.lag ? g.kcal : 0), 0);
    const r = E > 0 ? kGE * E / (E + KGE) * 0.25 : 0;               // kcal per 0.25 h
    absorbed += drainProportionally(s.gut, r, {proteinCapPerQuarter: 2.5});   // Pmax 10 g/h
  }
  s.absFlux = absorbed;                                              // kcal/h -> to 01/03/04/05 as macro fluxes
  s.FED = s.absFlux >= FED_THR;

  // 2) clocks
  s.tPA = s.FED ? 0 : s.tPA + 1;
  s.tau = s.FED ? 0 : s.tPA + TAU_REF_ABS;
  const phi = clamp(1 - s.absFlux / 100, 0, 1);
  for (const v of SLOW_VARS) {                                       // leptin, GH, IGF1, cortisol, NE, T3, testo, REEad, Nspare
    if (!s.FED && s.tau >= 12) s.zeta[v] += 1;
    else if (s.FED) s.zeta[v] *= Math.exp(-(1 - phi) / TOFF[v]);    // TOFF table in 4.2
  }

  // 3) glycogen & switch (04/05 own the full versions; this is the reduced form)
  if (!s.FED) s.Lliv -= VGLY(ctx.bodyMass) * s.Lliv**3 / (40**3 + s.Lliv**3) + ctx.exerciseHepaticDraw;
  s.Sw = 1 / (1 + (s.Lliv / 30) ** 4);

  // 4) reference physiology on the memory clocks (4.4.3); glucose/insulin/BHB come from 04/05 when available
  s.hormones = {
    GH: GH_x(12 + s.zeta.GH), IGF1: IGF1Rel(12 + s.zeta.IGF1), cortisol: CortisolRel(12 + s.zeta.cortisol),
    NE: NERel(12 + s.zeta.NE), leptin: LeptinRel(12 + s.zeta.leptin), T3: T3Rel(12 + s.zeta.T3),
    testo: ctx.sex === 'M' ? TestoRel(12 + s.zeta.testo) : 1,
  };
  s.REEmult = REERel(12 + s.zeta.REEad, ctx.engineRecomputesRMRfromFFM ? 0.08 : 0.15);
  const fastDay = (12 + s.zeta.Nspare) / 24;
  s.proteinOxFast_gph = s.FED ? 0 : UrinaryN(fastDay, ctx) * 6.25 / 24;   // only when no protein is being absorbed
  s.phase = s.FED ? 'ABSORPTIVE' : s.tau < 18 ? 'POSTABSORPTIVE' : s.Sw < 0.5 ? 'GLUCONEOGENIC'
          : (12 + s.zeta.Nspare) < 96 ? 'KETOTIC' : 'PROLONGED';

  // 5) timing modifiers for other modules
  s.glucoseExcursionMult = mClock(ctx.clockHour) * mSleep(ctx) * (ctx.shiftWorkNight ? 1.06 : 1);
  s.SInextMeal = s.FED ? s.SInextMeal : 1 - 0.60 * (1 - Math.exp(-Math.max(0, s.tau - 12) / 6));
  s.Hshift = hungerOffsets(ctx.daySummary);                          // 4.7.4, 4.7.5, 4.8, 4.9
  return s;
}
// Daily: if intakeMode === 'adLib' apply dEI_frac(W) (4.6.1), breakfast-skip (4.7.6), early-loading (4.7.5),
// ADF feed-day compensation (4.9) BEFORE the energy balance of 01. In 'specified' mode apply none of them.
```
Continuity: every function of `tau`/`zeta` is smooth and defined to weeks; refeeding decays each memory
clock with its own `Toff`, so a second fast started 24 h after a 72-h fast re-enters the deep state faster
for slow variables (leptin partially, T3, N-sparing) — the hysteresis 20 needs for repeated fasts.
Alternative continuous "fasting-depth" scalar for UI: `depth = 1 - exp(-max(0, tau - 12)/24)` (0 at
overnight, 0.39 at 24 h, 0.86 at 60 h, 0.99 at 5 d) — display-only; mechanisms use `Lliv`, `Sw`, `zeta_i`.

### 4.16 Deliverable (b): which timing effects are real at matched energy and protein?

**A. Real at matched energy/protein (implement as direct physiological effects).**

| # | Timing variable | Effect (effect size) | Engine hook | Grade |
|---|---|---|---|---|
| A1 | Clock time of a meal | postprandial glucose x1.17 at 20:00 vs 08:00; early-phase insulin -27% [87]; x1.33 for a meal 1 h before sleep vs x1.14 at 18:00 [100] | `glucoseExcursionMult` -> 04, 06 (glycaemic markers) | A (direction) / B (size) |
| A2 | Long preceding fast (>= 20 h) | next-meal insulin sensitivity -54%, AIR -22% after 24 h [26]; bigger excursions after 72 h [27] | `SInextMeal` -> 04 | B |
| A3 | Clock time of TEF | acute DIT 44% lower in evening [88]; +90 kcal/d-rate morning excess 2-3 h post-meal [89] **but 24-h EE/TDEE unchanged** (+25 kcal/d n.s. [96]; +10 +/- 16 [67]) | redistribute hourly TEF only; net 0 | B / A- (null net) |
| A4 | Late eating (meals 4 h later) | hunger OR ~2, waketime EE -59 kcal/d, core temp -0.19 degC [95]; no TDEE effect with evening loading [96] | `Hshift` +7 mm; EE 0 (band -60..0) | B (hunger) / C (EE) |
| A5 | Morning-loaded vs evening-loaded | lower hunger/desire to eat; weight identical under controlled feeding (-3.33 vs -3.38 kg) [96] | `Hshift` -5 mm | B |
| A6 | Early TRE (window ends <= 15:00), isocaloric | insulin sensitivity up, SBP -11/DBP -10 mmHg (n = 8) [66]; muscle insulin sensitivity up vs weight-matched CR [69]; evening desire to eat -22 mm [66]; ghrelin -32 pg/mL, npRQ -0.021 [67]; mean glucose -4 mg/dL [68] | SBP -3, DBP -3 mmHg, fasting insulin -10% (shrunk); `Hshift` -5 mm evening | C |
| A7 | Meal count 1 vs 3 (isocaloric) | hunger up; SBP +6.6, DBP +3.8 mmHg; LDL +23 mg/dL; morning OGTT impaired [114,115] | 06 lipid/BP deltas (C), `Hshift` +8 mm | C |
| A8 | Meal count 3 vs 6-17 | no EE/fat-ox effect [107-111]; hunger higher with 6 or 14 [110,111]; 17 snacks: LDL -13.5%, insulin -27.9% (2 wk, n = 7) [117] | `Hshift`; small lipid term (C) | A (EE null) / B-C |
| A9 | Protein distribution | acute MPS: 4 x 20 g > 8 x 10 g or 2 x 40 g by 31-48% [118]; even > skewed 24-h MPS +25% [119]; chronic lean mass: no timing effect when total protein matched [122], equal FFM gains with 7.5-h vs 13-h windows [63] | 03 per-meal MPS saturation only; no chronic penalty if >= 1.6 g/kg/d + RT | B |
| A10 | Fasts >= 24 h (ADF, 36-72 h) | extra protein oxidation (N 10-14.5 g/d on fast days [29]); lean adults: fat only 46% of loss with 0:150 ADF vs 92% with CER [124]; obese: partition similar or better [125,131,133] | `UrinaryN`, `proteinOxFast` -> 03/01 | B (lean) / B (obese null) |
| A11 | Multi-day fasting (3-10 d) | GH x3-5, IGF-1 -40-60%, cortisol +60-70%, NE x2, leptin -80-90%, T3 -30%, testosterone -40% (men), REE +4% then -10%, BP -11/-6 mmHg, uric acid +46% [14-18,23,36,37] | 4.4 reference functions | B |
| A12 | Fasted aerobic exercise | +3.1 g fat oxidised per session [137]; no chronic body-composition effect [136] | 05/10 session substrate only | B |

**B. Effects that operate only (or almost only) via energy intake / appetite / adherence** — apply only
in `adLib` mode or as hunger/adherence outputs; never as a metabolic bonus at fixed kcal.

| # | Timing variable | Effect size on intake/weight | Evidence | Grade |
|---|---|---|---|---|
| B1 | TRE window length | intake -4% (12 h), -7% (10.8 h), -20% (8 h), -28% (6 h), -30% (4 h) (4.6.1); weight -3.2% in 8 wk (4-6 h) [57], -2.6% (8 h, 12 wk) [58]; 12-mo TRE vs control -4.61 kg, = CR [71]; TRE vs control meta -1.37 kg [80], -0.90 kg [76] | [55,57,58,71,74,76,80] | B- |
| B2 | TRE vs CR (matched) | weight difference ~0 (-1.8 kg, CI -4.0 to 0.4 [56]; 0.81 kg n.s. [71]; n.s. [64,72]) | [56,64,71,72] | A |
| B3 | Early vs late window / earlier distribution | -1.2 to -1.75 kg over ~3 mo in free-living trials [77,80,104]; Jakubowicz -8.7 vs -3.6 kg [97,98] not reproduced with provided food [96] | [77,80,96,97,104] | B (via appetite) |
| B4 | Breakfast skipping | intake -260 kcal/d (CI 79-441), weight -0.44 kg vs eating breakfast [103]; lean: activity -442 kcal/d [101] | [101-103] | B |
| B5 | ADF / 5:2 | weight = CER at matched deficit; ADF -1.29 kg vs CER in short trials (bigger achieved deficit) [78]; feed-day compensation 0-20% [123,134,135]; dropout 38% vs 29% [123] | [78,79,123,132,134,135] | A (equivalence) |
| B6 | Meal frequency | no weight/body-composition effect under matched energy [106,108,112]; lower meal frequency -1.85 kg in free-living meta (not matched) [80] | [80,106,108,112] | A (null at matched) |

---

## 5. Interactions with other subsystems

| Module | This module needs from it | This module gives to it |
|---|---|---|
| 01 body-weight models | energy balance, FM/FFM partition engine | `absFlux` by macro and hour; `proteinOxFast`; `ecwLoss`; `REEmult`; intake modifiers (adLib mode) |
| 02 energy expenditure | RMR from body composition, TEF per macro, adaptive thermogenesis state | TEF hourly shape by clock time (net 0); fasting REE bump/decline (`REERel`, adaptive-only A = 0.08 when 02 recomputes RMR from FFM) |
| 03 protein/MPS | per-meal MPS response, post-exercise sensitivity window | protein absorption timing (Pmax 10 g/h), hours without protein, fasting N excretion `UrinaryN(d)`, `Nspare` memory |
| 04 glycogen/insulin | full liver/muscle glycogen and glucose-insulin model | `mClock`, `mSleep`, `SInextMeal`, `FED`, `tau`; fasting glucose/insulin/GNG reference curves as validation targets |
| 05 fat oxidation/ketosis | ketogenesis kinetics, keto-adaptation, exit/re-entry | `Sw`, `tau`, lipolysis reference (`GlycerolRa`), BHB reference curve 0-21 d, late-meal fat-oxidation factor 0.88 |
| 06 lipids/BP/biomarkers | biomarker models | isocaloric timing deltas (A6-A8), fasting BP drop and uric-acid rise (4.10), measurement-timing artefact flags (morning TG/OGTT after long fasts) |
| 08 autophagy | autophagy signal model | `tau`, `Sw`, `zeta` clocks, insulin-rel curve, mTOR proxy (fasting 72 h: mTOR phosphorylation ~-50%, LC3B-II +30% [20]; eTRF LC3A mRNA +22% [68]) |
| 09/10 training | session timing & energy | fed/fasted status at session time; post-session hours to next protein |
| 12 hormones/appetite | hunger/satiety model, leptin/ghrelin | `Hshift` terms; fasting leptin/T3/testosterone/cortisol/GH trajectories |
| 13 transitions / 5:2 / ADF | day-level schedules | fast-day physiology, feed-day compensation, dropout priors |
| 16 sleep/sex/age | sleep window, chronotype, sex, menstrual status | sex modifiers (4.14); late-meal sleep-overlap term |
| 17/20 safety & extended fasting | contraindications, supervision rules | 0-21 d continuous state, electrolyte/refeeding flags, hypoglycaemia risk by sex |
| 18 planner | objective priorities | intake-mode functions; adherence priors; "timing effects are small at fixed kcal" constraints |

## 6. Output metrics for the UI

| Metric | Unit | Direction of good | Computation | Grade |
|---|---|---|---|---|
| Fed / fasted state (phase band) | category per hour | context | `phase` (4.15) | B |
| Hours post-absorptive per day | h/d | goal-dependent | count of non-FED hours | B |
| Meal-equivalent fasting time (current) | h | context | `tau` | B |
| Longest fast of the day / week | h | context | max run of non-FED hours + 4.5 | B |
| Fasting depth (display) | 0-1 | context | `1 - exp(-max(0,tau-12)/24)` | C |
| Liver glycogen (reduced form) | g, % of max | context | `Lliv` (04 authoritative) | A |
| Metabolic-switch index | 0-1 | context (no health credit per se) | `Sw` | B/C |
| Eating window | h | goal-dependent | first to last meal start | A |
| Eating-window midpoint & fraction of energy before 14:00 | clock h, % | earlier = lower glycaemia & hunger | from log | B |
| Last meal to sleep | h | >= 3 h lower | from log + sleep | B |
| Postprandial glucose index | relative | lower | sum over meals of excursion x `glucoseExcursionMult` (04) | A/B |
| GH / IGF-1 / cortisol / leptin / T3 / testosterone indices (fasting-driven) | x baseline | context | 4.4.3 on memory clocks | B/C |
| Fasting protein oxidation / lean tissue lost to fasting | g/d, kg | lower | `UrinaryN*6.25`, `/33` | B |
| Reversible water loss (ECW + glycogen water) | kg | context (explains scale drops/regain) | `ecwLoss` + 04 glycogen water | B/C |
| Hunger shift from timing | mm VAS | lower | `Hshift` | C |
| Refeeding-risk flag | bool | false | NICE criteria (section 9) | A (guideline) |
| Hypoglycaemia-risk flag during fasts | bool | false | predicted glucose < 3.0 mM or women > 48 h | C |

## 7. Validation targets (deliverable c)

The engine (this module + 01-05) should reproduce, within the stated tolerance:

1. **Liver glycogen & GNG (Rothman 1991 [6]; Roden 2001 [9]).** Healthy adults, 650-kcal meal then
   68-h fast: liver glycogen 396 mM (~94 g) at 4 h -> 251 mM (~60 g) at 15 h; -83% by 64 h; GNG share
   64% (0-22 h), 82% (22-36 h), 96% (36-64 h). Tolerance: glycogen +/-15%, GNG share +/-8 points.
2. **Short-term fasting kinetics (Klein 1993 [12]).** 6 men, 12 -> 72 h: glycerol Ra 2.08 -> 4.36 and
   palmitate Ra 1.63 -> 3.26 umol/kg/min (60% of rise by 24 h); glucose 5.58 -> 4.14 mM; glucose Ra
   11.0 -> 8.3 umol/kg/min; insulin 64.6 -> 30.1 pmol/L (70% of fall by 24 h). Tolerance +/-15%.
3. **Ketones by sex (Browning 2012 [13]).** 9 F / 9 M, 48-h fast: BHB 0.33/0.41 mM at 24 h, 1.22/1.94 mM
   at 48 h; glucose 4.4/4.05 mM at 48 h; FFA 0.94/0.71 mM at 48 h. Tolerance: BHB +/-40%, glucose
   +/-0.4 mM. Plus eTRF: BHB 0.15 mM after an 18-h fast [68] (tolerance +/-0.1 mM).
4. **GH and 5-day fast (Hartman 1992 [15]; Ho 1988 [14]).** Day-2 GH production x4.8 (78 -> 371
   ug/Lv/24 h); day 5: integrated GH x3.1, pulses 5.8 -> 9.9/24 h, IGF-1 -41% (day 1 -> 5), glucose
   4.9 -> 3.2 mM, FFA 0.43 -> 1.55 mM. Tolerance: GH x3-5; others +/-20%.
5. **72-h fast endocrine panel (Chan 2003 [23]).** Lean men: leptin to ~10% of fed, T3 -30%, testosterone
   -40%, IGF-1 > -50%, insulin > -70%, FFA +300%, 24-h cortisol 4.84 -> 7.84 ug/dL. Tolerance +/-15
   points.
6. **REE in early starvation (Webber 1994 [18]; Zauner 2000 [17]).** RMR +6% at 36 h, +2.6% (n.s.) at
   72 h; RER 0.80 -> 0.76 -> 0.72 at 12/36/72 h; HR 62.5 -> 68.0 -> 69.2 bpm; NE unchanged at 36 h, up at
   72 h, x2.2 by day 4. Tolerance: REE within +/-5%, RER +/-0.02.
7. **10-day modified fast (Laurens 2021 [36]).** 16 men, BMI 26.2, 200-250 kcal/d, ~3 h/d walking:
   weight -5.9 kg (-7%), FM -2.3 kg, LST -3.5 kg (ECW -1.6, glycogen+water -0.5, active tissue -1.5),
   BMR -12%, glucose 4.7 -> 4.0 mM, insulin -59%, urinary N -41% by day 5 then stable. Tolerance:
   weight +/-0.8 kg, FM +/-0.6 kg. (Current model: 5.9 / 2.0 / 1.7 / 0.7 / 1.5 kg.)
8. **Buchinger cohort (Wilhelmi de Toledo 2019 [37]).** 5.4-d fast: -3.2 kg; 20.1-d fast: -8.6 kg;
   SBP 131.6 -> 120.7, DBP 83.7 -> 77.9 mmHg; uric acid 338 -> 495 umol/L; ketonaemia ~4 mM by day 12
   [38]. Tolerance: weight +/-1 kg (mixed-sex, mean age ~55 y).
9. **ADF vs CER in lean adults (Templeman 2021 [124]).** 3 wk: 0:150 body mass -1.60 kg, fat -0.74 kg;
   75:75 body mass -1.91 kg, fat -1.75 kg; 0:200 body mass -0.52 kg, fat -0.12 kg. Tolerance: fat
   +/-0.4 kg; ordering must be reproduced.
10. **TRE at matched intake (Liu 2022 [56]; Lin 2023 [71]).** 12 mo: TRE+CR -8.0 kg vs CR -6.3 kg
    (difference n.s., CI -4.0 to 0.4) — engine at identical kcal must give |difference| < 1 kg.
11. **TRE ad libitum (Cienfuegos 2020 [57]).** 8 wk, 4-h or 6-h window, obese: intake -528/-566 kcal/d,
    weight -3.2%. Tolerance: weight +/-1.2 percentage points (adLib mode).
12. **Meal timing at equal intake (Ruddick-Collins 2022 [96]).** 4 wk each, intake 1.0 x RMR: weight
    -3.33 (morning-loaded) vs -3.38 kg (evening-loaded); TDEE 2871 vs 2846 kcal/d. Engine: |weight
    difference| < 0.3 kg, lower hunger with morning loading.
13. **Late dinner (Gu 2020 [100]).** 22:00 vs 18:00 dinner, sleep 23:00: 4-h glucose AUC +18%, dietary
    FA oxidation 74.5 vs 84.5%. Tolerance +/-6 points.
14. **Breakfast (Betts 2014 [101]).** Lean, 6 wk: RMR difference < 11 kcal/d; body mass unchanged; in
    adLib mode, breakfast +539 kcal/d intake offset by +442 kcal/d activity.
15. **Meal frequency (Taylor & Garrow 2001 [107]; Ohkawara 2013 [111]).** 2 vs 6 meals: 24-h EE 9.96 vs
    10.00 MJ; 3 vs 6: 8.7 vs 8.6 MJ/d, fat oxidation 82 vs 80 g/d. Engine: |24-h EE difference| < 1%.
16. **One meal/day (Stote 2007 [114]).** 8 wk isocaloric 1 vs 3 meals: FM -2.1 kg, SBP +6.6 mmHg, LDL
    +23 mg/dL, hunger higher. Grade C target (reproduce direction; FM within +/-1.5 kg).
17. **Post-fast insulin resistance (Salgin 2009 [26]).** 24-h fast: next-morning SI -54%, AIR -22%.
    Tolerance +/-15 points.
18. **Next-day compensation (Johnstone 2002 [135]).** 36-h fast (~12 MJ deficit): next-day ad-lib
    intake +2.0 MJ vs after maintenance (adLib mode, tolerance +/-1 MJ).

## 8. Myths / contested claims

| Claim | Evidence | Verdict |
|---|---|---|
| "Eat 5-6 small meals to stoke your metabolism." | 24-h EE identical from 1-2 up to 14 meals/day [107-111]; body composition unaffected once one outlier trial is removed [106] | False |
| "Skipping breakfast slows metabolism / causes weight gain." | RMR within 11 kcal/d [101]; breakfast adds ~260 kcal/d and +0.44 kg [103] | False (breakfast is weight-neutral to slightly positive) |
| "16:8 burns more fat at the same calories." | TRE + CR = CR at 12 mo [56,71]; no FM/FFM difference with matched deficit [64]; 24-h EE unchanged [67] | False (it works by cutting intake) |
| "Fasting puts you in 'starvation mode' within a day." | REE rises ~4-6% at 36-72 h [17,18]; declines only after several days (-12% by day 10) [36] | False for < 3 d |
| "16-18 h fasts put you in ketosis/flip the metabolic switch." | BHB 0.15 mM at 18 h [68]; 0.3-0.4 mM at 24 h [13] | Mostly false |
| "Fasting preserves muscle because GH rises 5-fold." | GH up x3-5 [14,15] yet N loss peaks days 1-3 [29]; 60% of 10-d fast weight loss is lean soft tissue (25% metabolically active tissue) [36]; lean adults lose more lean with ADF than CER [124]; TREAT: ~65% of weight lost was lean [55] | False as stated; protein sparing only after several days |
| "Eating late makes you fat regardless of calories." | Late eating: hunger x2, waketime EE -59 kcal/d [95]; but TDEE (DLW) and weight equal with evening loading at fixed intake [96] | Mostly false at fixed kcal; true via appetite/glycaemia |
| "Big breakfast = 2.5x more weight loss" [97] | Not reproduced under provided-food crossover [96] | Contested -> appetite/adherence effect |
| "Twice as much DIT after breakfast" [91] | Baseline and duration artefacts; absolute ~25 kcal difference [92]; TDEE unchanged [96] | Overstated |
| "You must eat protein every 3 h or lose muscle." | Equal FFM gains in 7.5-h vs 13-h windows at 1.6 g/kg [63]; timing irrelevant when total protein matched [122] | False (acute MPS differences exist [118,119]) |
| "The metabolic switch itself is what makes IF healthy." | Fasting without deficit (0:200) gave no metabolic benefit [124]; TRE benefits mainly from deficit [81] | Unsubstantiated in humans |
| "Women should not fast at all" / "fasting is identical for both sexes" | 3-d fast did not disrupt ovulation or cycle length [49]; women's glucose falls more and ADF may impair their glucose tolerance [45,47,129] | Both overstated; sex-specific modifiers (4.14) |

## 9. Safety bounds (coordinate with 17 and 20)

- **Refeeding risk (hard rule, NICE CG32 [43]).** Planner must never prescribe >= 10 consecutive days of
  "little or no intake", nor >= 5 days in anyone with BMI < 18.5, recent weight loss > 10%, alcohol
  misuse, or insulin/diuretic/antacid/chemotherapy use. Simulator: warn and, when simulating refeeding
  after such fasts, flag the NICE high-risk protocol (start <= 10 kcal/kg/d, thiamine).
- **Water-only fasts.** PROPOSED planner ceiling 72 h without medical supervision (17 decides); beyond
  that the simulator warns: electrolyte homeostasis failure in prolonged therapeutic starvation [40],
  hyponatraemia (lowest 127 mmol/L) and arrhythmia (0.2% each) even under clinic supervision with
  200-250 kcal/d [37].
- **Hypoglycaemia.** Flag when predicted glucose < 3.0 mM, for women fasting > 48 h (lower glucose
  [45,47]; normal-weight fasters can fall < 3.05 mM [46]), and absolutely for insulin/sulfonylurea users
  (17). Eating-window changes in these users require medical supervision.
- **Gout / kidney stones.** Uric acid rises ~46% during 5-20-d fasts [37]; flag gout history; higher
  rise with deeper ketosis [38].
- **Orthostatic hypotension / dizziness.** BP falls ~11/6 mmHg [37]; natriuresis [41,42]; early TRF side
  effects: dizziness, nausea, headache in weeks 1-2 of 4-6 h TRF [57]. Flag for antihypertensive/diuretic
  users.
- **Lean-mass protection.** Planner must not combine repeated >= 24-h fasts with protein < 1.2 g/kg on
  feed days or no resistance training when "retain muscle" is a goal (Templeman lean adults [124];
  TREAT [55]); prefer TRE 8-10 h + RT + >= 1.6 g/kg (A-evidence null for FFM [63,83]).
- **Populations excluded from fasting prescriptions** (17 owns list): pregnancy/lactation, eating
  disorder history, BMI < 18.5, type 1 diabetes, adolescents, frail older adults, SGLT2-inhibitor
  users (ketoacidosis risk mentioned in [38]).
- **Reproductive axis.** Repeated long fasts in lean, active women -> low-energy-availability warning
  (16/17); LH pulsatility falls within 3 d [49].

## 10. Open questions / weakest assumptions

1. **Female data** for GH, cortisol, NE, REE and N excretion during fasting are sparse; curves are
   male-derived (4.14). Sex differences in ketone rise are contradictory [13,45].
2. **Beyond 5 days** GH, NE and cortisol trajectories are extrapolated (UNVERIFIED); 72-h BHB mean is
   interpolated (no direct healthy-cohort mean retrieved).
3. **REE during days 1-4** — studies disagree (+14% [17] vs -8% [19]); the model takes a middle path.
4. **Refeeding recovery constants** (`Toff`) for IGF-1, cortisol, NE, testosterone, REE and N-sparing are
   proposals (grade D); these govern ADF/5:2/periodic-fast hysteresis and deserve priority data mining.
5. **Partial-intake fast days** (500-650 kcal on 5:2; 25% ADF): mapping from fast-day energy/carbohydrate
   to fasting-hormone depth is unknown; handled only through `phi`.
6. **Lean-mass cost of daily 16-20 h fasts** in older adults and without RT (TREAT [55] vs RT trials
   [63,83]) — heterogeneity likely driven by protein intake, which few TRE trials controlled.
7. **Is the eTRE isocaloric BP/insulin effect real?** It rests on n = 8 [66] and n = 16 [69]; larger
   trials found weaker or weight-mediated effects [55,65]. Shrunk to -3/-3 mmHg (grade C).
8. **Late-eating EE penalty**: -59 kcal/d waketime [95] vs DLW null [96]; default 0.
9. **Gastric emptying of very large or high-fat meals** is extrapolated from moderate test meals [1,3].
10. **ECW kinetics** during fasting (time-constant 3 d) is a proposal fitted to a single 10-d end-point [36].
11. **Muscle glycogen use during rest fasting** (30 g/d for 3 d) is UNVERIFIED; 04 should replace it.
12. Water-only fasting > 7 d in normal-weight people: modern controlled data are lacking (most data are
    obese cohorts from the 1960s-70s or supplemented Buchinger fasts) -> 20.

## 11. References

1. Tougas G, et al. Assessment of gastric emptying using a low fat meal: establishment of international control values. Am J Gastroenterol. 2000;95:1456-62. PMID 10894578. doi:10.1111/j.1572-0241.2000.02076.x. https://pubmed.ncbi.nlm.nih.gov/10894578/
2. Abell TL, et al. Consensus recommendations for gastric emptying scintigraphy (ANMS/SNM). Am J Gastroenterol. 2008;103:753-63. PMID 18028513. doi:10.1111/j.1572-0241.2007.01636.x. https://pubmed.ncbi.nlm.nih.gov/18028513/
3. Hunt JN, Stubbs DF. The volume and energy content of meals as determinants of gastric emptying. J Physiol. 1975;245:209-25. PMID 1127608. doi:10.1113/jphysiol.1975.sp010841. https://pubmed.ncbi.nlm.nih.gov/1127608/
4. Brener W, Hendrix TR, McHugh PR. Regulation of the gastric emptying of glucose. Gastroenterology. 1983;85:76-82. PMID 6852464. https://pubmed.ncbi.nlm.nih.gov/6852464/
5. Trommelen J, et al. The anabolic response to protein ingestion during recovery from exercise has no upper limit in magnitude and duration in vivo in humans. Cell Rep Med. 2023;4:101324. PMID 38118410. doi:10.1016/j.xcrm.2023.101324. https://pubmed.ncbi.nlm.nih.gov/38118410/
6. Rothman DL, Magnusson I, Katz LD, Shulman RG, Shulman GI. Quantitation of hepatic glycogenolysis and gluconeogenesis in fasting humans with 13C NMR. Science. 1991;254:573-6. PMID 1948033. doi:10.1126/science.1948033. https://pubmed.ncbi.nlm.nih.gov/1948033/
7. Landau BR, et al. Contributions of gluconeogenesis to glucose production in the fasted state. J Clin Invest. 1996;98:378-85. PMID 8755648. doi:10.1172/JCI118803. https://pubmed.ncbi.nlm.nih.gov/8755648/
8. Petersen KF, Price T, Cline GW, Rothman DL, Shulman GI. Contribution of net hepatic glycogenolysis to glucose production during the early postprandial period. Am J Physiol. 1996;270:E186-91. PMID 8772491. doi:10.1152/ajpendo.1996.270.1.E186. https://pubmed.ncbi.nlm.nih.gov/8772491/
9. Roden M, Petersen KF, Shulman GI. Nuclear magnetic resonance studies of hepatic glucose metabolism in humans. Recent Prog Horm Res. 2001;56:219-37. PMID 11237214. doi:10.1210/rp.56.1.219. https://pubmed.ncbi.nlm.nih.gov/11237214/
10. Taylor R, et al. Direct assessment of liver glycogen storage by 13C NMR spectroscopy and regulation of glucose homeostasis after a mixed meal in normal subjects. J Clin Invest. 1996;97:126-32. PMID 8550823. doi:10.1172/JCI118379. https://pubmed.ncbi.nlm.nih.gov/8550823/
11. Hwang JH, et al. Impaired net hepatic glycogen synthesis in insulin-dependent diabetic subjects during mixed meal ingestion: a 13C NMR spectroscopy study. J Clin Invest. 1995;95:783-7. PMID 7860761. doi:10.1172/JCI117727. https://pubmed.ncbi.nlm.nih.gov/7860761/
12. Klein S, Sakurai Y, Romijn JA, Carroll RM. Progressive alterations in lipid and glucose metabolism during short-term fasting in young adult men. Am J Physiol. 1993;265:E801-6. PMID 8238506. doi:10.1152/ajpendo.1993.265.5.E801. https://pubmed.ncbi.nlm.nih.gov/8238506/
13. Browning JD, Baxter J, Satapati S, Burgess SC. The effect of short-term fasting on liver and skeletal muscle lipid, glucose, and energy metabolism in healthy women and men. J Lipid Res. 2012;53:577-86. PMID 22140269. doi:10.1194/jlr.P020867. https://pubmed.ncbi.nlm.nih.gov/22140269/
14. Ho KY, et al. Fasting enhances growth hormone secretion and amplifies the complex rhythms of growth hormone secretion in man. J Clin Invest. 1988;81:968-75. PMID 3127426. doi:10.1172/JCI113450. https://pubmed.ncbi.nlm.nih.gov/3127426/
15. Hartman ML, et al. Augmented growth hormone (GH) secretory burst frequency and amplitude mediate enhanced GH secretion during a two-day fast in normal men. J Clin Endocrinol Metab. 1992;74:757-65. PMID 1548337. doi:10.1210/jcem.74.4.1548337. https://pubmed.ncbi.nlm.nih.gov/1548337/
16. Bergendahl M, et al. Fasting as a metabolic stress paradigm selectively amplifies cortisol secretory burst mass and delays the time of maximal nyctohemeral cortisol concentrations in healthy men. J Clin Endocrinol Metab. 1996;81:692-9. PMID 8636290. doi:10.1210/jcem.81.2.8636290. https://pubmed.ncbi.nlm.nih.gov/8636290/
17. Zauner C, et al. Resting energy expenditure in short-term starvation is increased as a result of an increase in serum norepinephrine. Am J Clin Nutr. 2000;71:1511-5. PMID 10837292. doi:10.1093/ajcn/71.6.1511. https://pubmed.ncbi.nlm.nih.gov/10837292/
18. Webber J, Macdonald IA. The cardiovascular, metabolic and hormonal changes accompanying acute starvation in men and women. Br J Nutr. 1994;71:437-47. PMID 8172872. doi:10.1079/bjn19940150. https://pubmed.ncbi.nlm.nih.gov/8172872/
19. Nair KS, Woolf PD, Welle SL, Matthews DE. Leucine, glucose, and energy metabolism after 3 days of fasting in healthy human subjects. Am J Clin Nutr. 1987;46:557-62. PMID 3661473. doi:10.1093/ajcn/46.4.557. https://pubmed.ncbi.nlm.nih.gov/3661473/
20. Vendelbo MH, et al. Fasting increases human skeletal muscle net phenylalanine release and this is associated with decreased mTOR signaling. PLoS One. 2014;9:e102031. PMID 25020061. doi:10.1371/journal.pone.0102031. https://pubmed.ncbi.nlm.nih.gov/25020061/
21. Boden G, Chen X, Mozzoli M, Ryan I. Effect of fasting on serum leptin in normal human subjects. J Clin Endocrinol Metab. 1996;81:3419-23. PMID 8784108. doi:10.1210/jcem.81.9.8784108. https://pubmed.ncbi.nlm.nih.gov/8784108/
22. Kolaczynski JW, et al. Responses of leptin to short-term fasting and refeeding in humans: a link with ketogenesis but not ketones themselves. Diabetes. 1996;45:1511-5. PMID 8866554. doi:10.2337/diab.45.11.1511. https://pubmed.ncbi.nlm.nih.gov/8866554/
23. Chan JL, Heist K, DePaoli AM, Veldhuis JD, Mantzoros CS. The role of falling leptin levels in the neuroendocrine and metabolic adaptation to short-term starvation in healthy men. J Clin Invest. 2003;111:1409-21. PMID 12727933. doi:10.1172/JCI17490. https://pubmed.ncbi.nlm.nih.gov/12727933/
24. Spencer CA, et al. Dynamics of serum thyrotropin and thyroid hormone changes in fasting. J Clin Endocrinol Metab. 1983;56:883-8. PMID 6403568. doi:10.1210/jcem-56-5-883. https://pubmed.ncbi.nlm.nih.gov/6403568/
25. Vagenakis AG, et al. Diversion of peripheral thyroxine metabolism from activating to inactivating pathways during complete fasting. J Clin Endocrinol Metab. 1975;41:191-4. PMID 1150863. doi:10.1210/jcem-41-1-191. https://pubmed.ncbi.nlm.nih.gov/1150863/
26. Salgin B, et al. Effects of prolonged fasting and sustained lipolysis on insulin secretion and insulin sensitivity in normal subjects. Am J Physiol Endocrinol Metab. 2009;296:E454-61. PMID 19106250. doi:10.1152/ajpendo.90613.2008. https://pubmed.ncbi.nlm.nih.gov/19106250/
27. Horton TJ, Hill JO. Prolonged fasting significantly changes nutrient oxidation and glucose tolerance after a normal mixed meal. J Appl Physiol. 2001;90:155-63. PMID 11133906. doi:10.1152/jappl.2001.90.1.155. https://pubmed.ncbi.nlm.nih.gov/11133906/
28. Natalucci G, et al. Spontaneous 24-h ghrelin secretion pattern in fasting subjects: maintenance of a meal-related pattern. Eur J Endocrinol. 2005;152:845-50. PMID 15941923. doi:10.1530/eje.1.01919. https://pubmed.ncbi.nlm.nih.gov/15941923/
29. Göschke H, Stahl M, Thölen H. Nitrogen loss in normal and obese subjects during total fast. Klin Wochenschr. 1975;53:605-10. PMID 1177405. doi:10.1007/BF01469679. https://pubmed.ncbi.nlm.nih.gov/1177405/
30. Forbes GB, Drenick EJ. Loss of body nitrogen on fasting. Am J Clin Nutr. 1979;32:1570-4. PMID 463798. doi:10.1093/ajcn/32.8.1570. https://pubmed.ncbi.nlm.nih.gov/463798/
31. Owen OE, et al. Brain metabolism during fasting. J Clin Invest. 1967;46:1589-95. PMID 6061736. doi:10.1172/JCI105650. https://pubmed.ncbi.nlm.nih.gov/6061736/
32. Owen OE, Felig P, Morgan AP, Wahren J, Cahill GF Jr. Liver and kidney metabolism during prolonged starvation. J Clin Invest. 1969;48:574-83. PMID 5773093. doi:10.1172/JCI106016. https://pubmed.ncbi.nlm.nih.gov/5773093/
33. Owen OE, et al. Protein, fat, and carbohydrate requirements during starvation: anaplerosis and cataplerosis. Am J Clin Nutr. 1998;68:12-34. PMID 9665093. doi:10.1093/ajcn/68.1.12. https://pubmed.ncbi.nlm.nih.gov/9665093/
34. Cahill GF Jr. Fuel metabolism in starvation. Annu Rev Nutr. 2006;26:1-22. PMID 16848698. doi:10.1146/annurev.nutr.26.061505.111258. https://pubmed.ncbi.nlm.nih.gov/16848698/
35. Larivière F, et al. Prolonged fasting as conditioned by prior protein depletion: effect on urinary nitrogen excretion and whole-body protein turnover. Metabolism. 1990;39:1270-7. PMID 2246967. doi:10.1016/0026-0495(90)90183-d. https://pubmed.ncbi.nlm.nih.gov/2246967/
36. Laurens C, et al. Is muscle and protein loss relevant in long-term fasting in healthy men? A prospective trial on physiological adaptations. J Cachexia Sarcopenia Muscle. 2021;12:1690-1703. PMID 34668663. doi:10.1002/jcsm.12766. https://pubmed.ncbi.nlm.nih.gov/34668663/
37. Wilhelmi de Toledo F, Grundler F, Bergouignan A, Drinda S, Michalsen A. Safety, health improvement and well-being during a 4 to 21-day fasting period in an observational study including 1422 subjects. PLoS One. 2019;14:e0209353. PMID 30601864. doi:10.1371/journal.pone.0209353. https://pubmed.ncbi.nlm.nih.gov/30601864/
38. Grundler F, Mesnage R, Ruppert PMM, Kouretas D, Wilhelmi de Toledo F. Long-term fasting-induced ketosis in 1610 subjects: metabolic regulation and safety. Nutrients. 2024;16:1849. PMID 38931204. doi:10.3390/nu16121849. https://pubmed.ncbi.nlm.nih.gov/38931204/
39. Michalsen A, et al. Effects of short-term modified fasting on sleep patterns and daytime vigilance in non-obese subjects: results of a pilot study. Ann Nutr Metab. 2003;47:194-200. PMID 12748412. doi:10.1159/000070485. https://pubmed.ncbi.nlm.nih.gov/12748412/
40. Runcie J, Thomson TJ. Prolonged starvation — a dangerous procedure? BMJ. 1970;3:432-5. PMID 5454322. doi:10.1136/bmj.3.5720.432. https://pubmed.ncbi.nlm.nih.gov/5454322/
41. Boulter PR, Hoffman RS, Arky RA. Pattern of sodium excretion accompanying starvation. Metabolism. 1973;22:675-83. PMID 4704714. doi:10.1016/0026-0495(73)90239-4. https://pubmed.ncbi.nlm.nih.gov/4704714/
42. Spark RF, et al. Renin, aldosterone and glucagon in the natriuresis of fasting. N Engl J Med. 1975;292:1335-40. PMID 165411. doi:10.1056/NEJM197506192922506. https://pubmed.ncbi.nlm.nih.gov/165411/
43. National Institute for Health and Care Excellence. Nutrition support for adults: oral nutrition support, enteral tube feeding and parenteral nutrition (CG32), recommendations 1.4.6-1.4.8. 2006 (updated 2017). https://www.nice.org.uk/guidance/cg32/chapter/Recommendations
44. da Silva JSV, et al. ASPEN consensus recommendations for refeeding syndrome. Nutr Clin Pract. 2020;35:178-195. PMID 32115791. doi:10.1002/ncp.10474. https://pubmed.ncbi.nlm.nih.gov/32115791/
45. Merimee TJ, Misbin RI, Pulkkinen AJ. Sex variations in free fatty acids and ketones during fasting: evidence for a role of glucagon. J Clin Endocrinol Metab. 1978;46:414-9. PMID 752030. doi:10.1210/jcem-46-3-414. https://pubmed.ncbi.nlm.nih.gov/752030/
46. Merimee TJ, Tyson JE. Hypoglycemia in man: pathologic and physiologic variants. Diabetes. 1977;26:161-5. PMID 190073. doi:10.2337/diab.26.3.161. https://pubmed.ncbi.nlm.nih.gov/190073/
47. Soeters MR, et al. Gender-related differences in the metabolic response to fasting. J Clin Endocrinol Metab. 2007;92:3646-52. PMID 17566089. doi:10.1210/jc.2007-0552. https://pubmed.ncbi.nlm.nih.gov/17566089/
48. Mittendorfer B, Horowitz JF, Klein S. Gender differences in lipid and glucose kinetics during short-term fasting. Am J Physiol Endocrinol Metab. 2001;281:E1333-9. PMID 11701450. doi:10.1152/ajpendo.2001.281.6.E1333. https://pubmed.ncbi.nlm.nih.gov/11701450/
49. Olson BR, et al. Short-term fasting affects luteinizing hormone secretory dynamics but not reproductive function in normal-weight sedentary women. J Clin Endocrinol Metab. 1995;80:1187-93. PMID 7714088. doi:10.1210/jcem.80.4.7714088. https://pubmed.ncbi.nlm.nih.gov/7714088/
50. Cienfuegos S, et al. Effect of intermittent fasting on reproductive hormone levels in females and males: a review of human trials. Nutrients. 2022;14:2343. PMID 35684143. doi:10.3390/nu14112343. https://pubmed.ncbi.nlm.nih.gov/35684143/
51. Anton SD, et al. Flipping the metabolic switch: understanding and applying the health benefits of fasting. Obesity. 2018;26:254-268. PMID 29086496. doi:10.1002/oby.22065. https://pubmed.ncbi.nlm.nih.gov/29086496/
52. de Cabo R, Mattson MP. Effects of intermittent fasting on health, aging, and disease. N Engl J Med. 2019;381:2541-2551. PMID 31881139. doi:10.1056/NEJMra1905136. https://pubmed.ncbi.nlm.nih.gov/31881139/
53. Mattson MP, et al. Intermittent metabolic switching, neuroplasticity and brain health. Nat Rev Neurosci. 2018;19:63-80. PMID 29321682. doi:10.1038/nrn.2017.156. https://pubmed.ncbi.nlm.nih.gov/29321682/
54. Longo VD, Mattson MP. Fasting: molecular mechanisms and clinical applications. Cell Metab. 2014;19:181-92. PMID 24440038. doi:10.1016/j.cmet.2013.12.008. https://pubmed.ncbi.nlm.nih.gov/24440038/
55. Lowe DA, et al. Effects of time-restricted eating on weight loss and other metabolic parameters in women and men with overweight and obesity: the TREAT randomized clinical trial. JAMA Intern Med. 2020;180:1491-1499. PMID 32986097. doi:10.1001/jamainternmed.2020.4153. https://pubmed.ncbi.nlm.nih.gov/32986097/
56. Liu D, et al. Calorie restriction with or without time-restricted eating in weight loss. N Engl J Med. 2022;386:1495-1504. PMID 35443107. doi:10.1056/NEJMoa2114833. https://pubmed.ncbi.nlm.nih.gov/35443107/
57. Cienfuegos S, et al. Effects of 4- and 6-h time-restricted feeding on weight and cardiometabolic health: a randomized controlled trial in adults with obesity. Cell Metab. 2020;32:366-378.e3. PMID 32673591. doi:10.1016/j.cmet.2020.06.018. https://pubmed.ncbi.nlm.nih.gov/32673591/
58. Gabel K, et al. Effects of 8-hour time restricted feeding on body weight and metabolic disease risk factors in obese adults: a pilot study. Nutr Healthy Aging. 2018;4:345-353. PMID 29951594. doi:10.3233/NHA-170036. https://pubmed.ncbi.nlm.nih.gov/29951594/
59. Moro T, et al. Effects of eight weeks of time-restricted feeding (16/8) on basal metabolism, maximal strength, body composition, inflammation, and cardiovascular risk factors in resistance-trained males. J Transl Med. 2016;14:290. PMID 27737674. doi:10.1186/s12967-016-1044-0. https://pubmed.ncbi.nlm.nih.gov/27737674/
60. Moro T, et al. Time-restricted eating effects on performance, immune function, and body composition in elite cyclists: a randomized controlled trial. J Int Soc Sports Nutr. 2020;17:65. PMID 33308259. doi:10.1186/s12970-020-00396-z. https://pubmed.ncbi.nlm.nih.gov/33308259/
61. Moro T, et al. Twelve months of time-restricted eating and resistance training improves inflammatory markers and cardiometabolic risk factors. Med Sci Sports Exerc. 2021;53:2577-2585. PMID 34649266. doi:10.1249/MSS.0000000000002738. https://pubmed.ncbi.nlm.nih.gov/34649266/
62. Tinsley GM, et al. Time-restricted feeding in young men performing resistance training: a randomized controlled trial. Eur J Sport Sci. 2017;17:200-207. PMID 27550719. doi:10.1080/17461391.2016.1223173. https://pubmed.ncbi.nlm.nih.gov/27550719/
63. Tinsley GM, et al. Time-restricted feeding plus resistance training in active females: a randomized trial. Am J Clin Nutr. 2019;110:628-640. PMID 31268131. doi:10.1093/ajcn/nqz126. https://pubmed.ncbi.nlm.nih.gov/31268131/
64. Stratton MT, et al. Four weeks of time-restricted feeding combined with resistance training does not differentially influence measures of body composition, muscle performance, resting energy expenditure, and blood biomarkers. Nutrients. 2020;12:1126. PMID 32316561. doi:10.3390/nu12041126. https://pubmed.ncbi.nlm.nih.gov/32316561/
65. Jamshed H, et al. Effectiveness of early time-restricted eating for weight loss, fat loss, and cardiometabolic health in adults with obesity: a randomized clinical trial. JAMA Intern Med. 2022;182:953-962. PMID 35939311. doi:10.1001/jamainternmed.2022.3050. https://pubmed.ncbi.nlm.nih.gov/35939311/
66. Sutton EF, et al. Early time-restricted feeding improves insulin sensitivity, blood pressure, and oxidative stress even without weight loss in men with prediabetes. Cell Metab. 2018;27:1212-1221.e3. PMID 29754952. doi:10.1016/j.cmet.2018.04.010. https://pubmed.ncbi.nlm.nih.gov/29754952/
67. Ravussin E, Beyl RA, Poggiogalle E, Hsia DS, Peterson CM. Early time-restricted feeding reduces appetite and increases fat oxidation but does not affect energy expenditure in humans. Obesity. 2019;27:1244-1254. PMID 31339000. doi:10.1002/oby.22518. https://pubmed.ncbi.nlm.nih.gov/31339000/
68. Jamshed H, et al. Early time-restricted feeding improves 24-hour glucose levels and affects markers of the circadian clock, aging, and autophagy in humans. Nutrients. 2019;11:1234. PMID 31151228. doi:10.3390/nu11061234. https://pubmed.ncbi.nlm.nih.gov/31151228/
69. Jones R, et al. Two weeks of early time-restricted feeding (eTRF) improves skeletal muscle insulin and anabolic sensitivity in healthy men. Am J Clin Nutr. 2020;112:1015-1028. PMID 32729615. doi:10.1093/ajcn/nqaa192. https://pubmed.ncbi.nlm.nih.gov/32729615/
70. Hutchison AT, et al. Time-restricted feeding improves glucose tolerance in men at risk for type 2 diabetes: a randomized crossover trial. Obesity. 2019;27:724-732. PMID 31002478. doi:10.1002/oby.22449. https://pubmed.ncbi.nlm.nih.gov/31002478/
71. Lin S, et al. Time-restricted eating without calorie counting for weight loss in a racially diverse population: a randomized controlled trial. Ann Intern Med. 2023;176:885-895. PMID 37364268. doi:10.7326/M23-0052. https://pubmed.ncbi.nlm.nih.gov/37364268/
72. Thomas EA, et al. Early time-restricted eating compared with daily caloric restriction: a randomized trial in adults with obesity. Obesity. 2022;30:1027-1038. PMID 35470974. doi:10.1002/oby.23420. https://pubmed.ncbi.nlm.nih.gov/35470974/
73. Chow LS, et al. Time-restricted eating effects on body composition and metabolic measures in humans who are overweight: a feasibility study. Obesity. 2020;28:860-869. PMID 32270927. doi:10.1002/oby.22756. https://pubmed.ncbi.nlm.nih.gov/32270927/
74. Wilkinson MJ, et al. Ten-hour time-restricted eating reduces weight, blood pressure, and atherogenic lipids in patients with metabolic syndrome. Cell Metab. 2020;31:92-104.e5. PMID 31813824. doi:10.1016/j.cmet.2019.11.004. https://pubmed.ncbi.nlm.nih.gov/31813824/
75. Gill S, Panda S. A smartphone app reveals erratic diurnal eating patterns in humans that can be modulated for health benefits. Cell Metab. 2015;22:789-98. PMID 26411343. doi:10.1016/j.cmet.2015.09.005. https://pubmed.ncbi.nlm.nih.gov/26411343/
76. Moon S, et al. Beneficial effects of time-restricted eating on metabolic diseases: a systemic review and meta-analysis. Nutrients. 2020;12:1267. PMID 32365676. doi:10.3390/nu12051267. https://pubmed.ncbi.nlm.nih.gov/32365676/
77. Chen YE, Tsai HL, Tu YK, Chen LW. Effects of timing and eating duration of time restricted eating on metabolic outcomes: systematic review and network meta-analysis. BMJ Med. 2026;5:e001071. PMID 41586347. doi:10.1136/bmjmed-2024-001071. https://pubmed.ncbi.nlm.nih.gov/41586347/
78. Semnani-Azad Z, et al. Intermittent fasting strategies and their effects on body weight and other cardiometabolic risk factors: systematic review and network meta-analysis of randomised clinical trials. BMJ. 2025;389:e082007. PMID 40533200. doi:10.1136/bmj-2024-082007. https://pubmed.ncbi.nlm.nih.gov/40533200/
79. Elortegui Pascual P, et al. A meta-analysis comparing the effectiveness of alternate day fasting, the 5:2 diet, and time-restricted eating for weight loss. Obesity. 2023;31 Suppl 1:9-21. PMID 36349432. doi:10.1002/oby.23568. https://pubmed.ncbi.nlm.nih.gov/36349432/
80. Liu HY, Eso AA, Cook N, O'Neill HM, Albarqouni L. Meal timing and anthropometric and metabolic outcomes: a systematic review and meta-analysis. JAMA Netw Open. 2024;7:e2442163. PMID 39485353. doi:10.1001/jamanetworkopen.2024.42163. https://pubmed.ncbi.nlm.nih.gov/39485353/
81. Chang Y, Du T, Zhuang X, Ma G. Time-restricted eating improves health because of energy deficit and circadian rhythm: a systematic review and meta-analysis. iScience. 2024;27:109000. PMID 38357669. doi:10.1016/j.isci.2024.109000. https://pubmed.ncbi.nlm.nih.gov/38357669/
82. Hays HM, et al. Effects of time-restricted eating with exercise on body composition in adults: a systematic review and meta-analysis. Int J Obes. 2025;49:755-765. PMID 39794384. doi:10.1038/s41366-024-01704-2. https://pubmed.ncbi.nlm.nih.gov/39794384/
83. Ali AM, et al. Time-restricted eating shows a modest reduction in fat mass in resistance-trained individuals: a systematic review and meta-analysis. Nutr Res. 2026;147:1-15. PMID 41687432. doi:10.1016/j.nutres.2026.01.001. https://pubmed.ncbi.nlm.nih.gov/41687432/
84. Siles-Guerrero V, et al. Is fasting superior to continuous caloric restriction for weight loss and metabolic outcomes in obese adults? A systematic review and meta-analysis of randomized clinical trials. Nutrients. 2024;16:3533. PMID 39458528. doi:10.3390/nu16203533. https://pubmed.ncbi.nlm.nih.gov/39458528/
85. Garegnani LI, et al. Intermittent fasting for adults with overweight or obesity. Cochrane Database Syst Rev. 2026;2:CD015610. PMID 41692034. doi:10.1002/14651858.CD015610.pub2. https://pubmed.ncbi.nlm.nih.gov/41692034/
86. Yong YN, McCubbin AJ, O'Driscoll DM, St-Onge MP, Bonham MP. The effects of intermittent fasting on sleep quality and cardiometabolic health outcomes in adults with overweight/obesity status: a systematic review and meta-analysis of randomized controlled trials. Sleep Med Rev. 2025;84:102193. PMID 41202521. doi:10.1016/j.smrv.2025.102193. https://pubmed.ncbi.nlm.nih.gov/41202521/
87. Morris CJ, et al. Endogenous circadian system and circadian misalignment impact glucose tolerance via separate mechanisms in humans. Proc Natl Acad Sci USA. 2015;112:E2225-34. PMID 25870289. doi:10.1073/pnas.1418955112. https://pubmed.ncbi.nlm.nih.gov/25870289/
88. Morris CJ, et al. The human circadian system has a dominating role in causing the morning/evening difference in diet-induced thermogenesis. Obesity. 2015;23:2053-8. PMID 26414564. doi:10.1002/oby.21189. https://pubmed.ncbi.nlm.nih.gov/26414564/
89. Bo S, et al. Is the timing of caloric intake associated with variation in diet-induced thermogenesis and in the metabolic pattern? A randomized cross-over study. Int J Obes. 2015;39:1689-95. PMID 26219416. doi:10.1038/ijo.2015.138. https://pubmed.ncbi.nlm.nih.gov/26219416/
90. Romon M, et al. Circadian variation of diet-induced thermogenesis. Am J Clin Nutr. 1993;57:476-80. PMID 8460600. doi:10.1093/ajcn/57.4.476. https://pubmed.ncbi.nlm.nih.gov/8460600/
91. Richter J, et al. Twice as high diet-induced thermogenesis after breakfast vs dinner on high-calorie as well as low-calorie meals. J Clin Endocrinol Metab. 2020;105:dgz311. PMID 32073608. doi:10.1210/clinem/dgz311. https://pubmed.ncbi.nlm.nih.gov/32073608/
92. Melanson EL, Chen KY. Letter to the Editor: "Twice as high diet-induced thermogenesis after breakfast vs dinner on high-calorie as well as low-calorie meals". J Clin Endocrinol Metab. 2020;105(7):e2673. doi:10.1210/clinem/dgaa208. https://academic.oup.com/jcem/article/105/7/e2673/5821101 (authors' replies: PMIDs 32300790, 32374826, 32485741)
93. Saad A, et al. Diurnal pattern to insulin secretion and insulin action in healthy individuals. Diabetes. 2012;61:2691-700. PMID 22751690. doi:10.2337/db11-1478. https://pubmed.ncbi.nlm.nih.gov/22751690/
94. Van Cauter E, Polonsky KS, Scheen AJ. Roles of circadian rhythmicity and sleep in human glucose regulation. Endocr Rev. 1997;18:716-38. PMID 9331550. doi:10.1210/edrv.18.5.0317. https://pubmed.ncbi.nlm.nih.gov/9331550/
95. Vujović N, et al. Late isocaloric eating increases hunger, decreases energy expenditure, and modifies metabolic pathways in adults with overweight and obesity. Cell Metab. 2022;34:1486-1498.e7. PMID 36198293. doi:10.1016/j.cmet.2022.09.007. https://pubmed.ncbi.nlm.nih.gov/36198293/
96. Ruddick-Collins LC, et al. Timing of daily calorie loading affects appetite and hunger responses without changes in energy metabolism in healthy subjects with obesity. Cell Metab. 2022;34:1472-1485.e6. PMID 36087576. doi:10.1016/j.cmet.2022.08.001. https://pubmed.ncbi.nlm.nih.gov/36087576/
97. Jakubowicz D, Barnea M, Wainstein J, Froy O. High caloric intake at breakfast vs. dinner differentially influences weight loss of overweight and obese women. Obesity. 2013;21:2504-12. PMID 23512957. doi:10.1002/oby.20460. https://pubmed.ncbi.nlm.nih.gov/23512957/
98. Shaw E, Leung GKW, Jong J, Coates AM, et al. The impact of time of day on energy expenditure: implications for long-term energy balance. Nutrients. 2019;11(10):2383. PMID 31590425. doi:10.3390/nu11102383. https://pubmed.ncbi.nlm.nih.gov/31590425/ (source of Jakubowicz -8.7 +/- 1.4 vs -3.6 +/- 1.5 kg)
99. Garaulet M, et al. Timing of food intake predicts weight loss effectiveness. Int J Obes. 2013;37:604-11. PMID 23357955. doi:10.1038/ijo.2012.229. https://pubmed.ncbi.nlm.nih.gov/23357955/
100. Gu C, et al. Metabolic effects of late dinner in healthy volunteers — a randomized crossover clinical trial. J Clin Endocrinol Metab. 2020;105:2789-802. PMID 32525525. doi:10.1210/clinem/dgaa354. https://pubmed.ncbi.nlm.nih.gov/32525525/
101. Betts JA, et al. The causal role of breakfast in energy balance and health: a randomized controlled trial in lean adults. Am J Clin Nutr. 2014;100:539-47. PMID 24898233. doi:10.3945/ajcn.114.083402. https://pubmed.ncbi.nlm.nih.gov/24898233/
102. Chowdhury EA, et al. The causal role of breakfast in energy balance and health: a randomized controlled trial in obese adults. Am J Clin Nutr. 2016;103:747-56. PMID 26864365. doi:10.3945/ajcn.115.122044. https://pubmed.ncbi.nlm.nih.gov/26864365/
103. Sievert K, et al. Effect of breakfast on weight and energy intake: systematic review and meta-analysis of randomised controlled trials. BMJ. 2019;364:l42. PMID 30700403. doi:10.1136/bmj.l42. https://pubmed.ncbi.nlm.nih.gov/30700403/
104. Young IE, Poobalan A, Steinbeck K, O'Connor HT, Parker HM. Distribution of energy intake across the day and weight loss: a systematic review and meta-analysis. Obes Rev. 2023;24:e13537. PMID 36530130. doi:10.1111/obr.13537. https://pubmed.ncbi.nlm.nih.gov/36530130/
105. Crispim CA, et al. Relationship between food intake and sleep pattern in healthy individuals. J Clin Sleep Med. 2011;7:659-64. PMID 22171206. doi:10.5664/jcsm.1476. https://pubmed.ncbi.nlm.nih.gov/22171206/
106. Schoenfeld BJ, Aragon AA, Krieger JW. Effects of meal frequency on weight loss and body composition: a meta-analysis. Nutr Rev. 2015;73:69-82. PMID 26024494. doi:10.1093/nutrit/nuu017. https://pubmed.ncbi.nlm.nih.gov/26024494/
107. Taylor MA, Garrow JS. Compared with nibbling, neither gorging nor a morning fast affect short-term energy balance in obese patients in a chamber calorimeter. Int J Obes Relat Metab Disord. 2001;25:519-28. PMID 11319656. doi:10.1038/sj.ijo.0801572. https://pubmed.ncbi.nlm.nih.gov/11319656/
108. Bellisle F, McDevitt R, Prentice AM. Meal frequency and energy balance. Br J Nutr. 1997;77 Suppl 1:S57-70. PMID 9155494. doi:10.1079/bjn19970104. https://pubmed.ncbi.nlm.nih.gov/9155494/
109. Smeets AJ, Westerterp-Plantenga MS. Acute effects on metabolism and appetite profile of one meal difference in the lower range of meal frequency. Br J Nutr. 2008;99:1316-21. PMID 18053311. doi:10.1017/S0007114507877646. https://pubmed.ncbi.nlm.nih.gov/18053311/
110. Munsters MJ, Saris WH. Effects of meal frequency on metabolic profiles and substrate partitioning in lean healthy males. PLoS One. 2012;7:e38632. PMID 22719910. doi:10.1371/journal.pone.0038632. https://pubmed.ncbi.nlm.nih.gov/22719910/
111. Ohkawara K, Cornier MA, Kohrt WM, Melanson EL. Effects of increased meal frequency on fat oxidation and perceived hunger. Obesity. 2013;21:336-43. PMID 23404961. doi:10.1002/oby.20032. https://pubmed.ncbi.nlm.nih.gov/23404961/
112. Cameron JD, Cyr MJ, Doucet E. Increased meal frequency does not promote greater weight loss in subjects who were prescribed an 8-week equi-energetic energy-restricted diet. Br J Nutr. 2010;103:1098-101. PMID 19943985. doi:10.1017/S0007114509992984. https://pubmed.ncbi.nlm.nih.gov/19943985/
113. Leidy HJ, et al. The effects of consuming frequent, higher protein meals on appetite and satiety during weight loss in overweight/obese men. Obesity. 2011;19:818-24. PMID 20847729. doi:10.1038/oby.2010.203. https://pubmed.ncbi.nlm.nih.gov/20847729/
114. Stote KS, et al. A controlled trial of reduced meal frequency without caloric restriction in healthy, normal-weight, middle-aged adults. Am J Clin Nutr. 2007;85:981-8. PMID 17413096. doi:10.1093/ajcn/85.4.981. https://pubmed.ncbi.nlm.nih.gov/17413096/
115. Carlson O, et al. Impact of reduced meal frequency without caloric restriction on glucose regulation in healthy, normal-weight middle-aged men and women. Metabolism. 2007;56:1729-34. PMID 17998028. doi:10.1016/j.metabol.2007.07.018. https://pubmed.ncbi.nlm.nih.gov/17998028/
116. Meessen ECE, et al. Differential effects of one meal per day in the evening on metabolic health and physical performance in lean individuals. Front Physiol. 2022;12:771944. PMID 35087416. doi:10.3389/fphys.2021.771944. https://pubmed.ncbi.nlm.nih.gov/35087416/
117. Jenkins DJ, et al. Nibbling versus gorging: metabolic advantages of increased meal frequency. N Engl J Med. 1989;321:929-34. PMID 2674713. doi:10.1056/NEJM198910053211403. https://pubmed.ncbi.nlm.nih.gov/2674713/
118. Areta JL, et al. Timing and distribution of protein ingestion during prolonged recovery from resistance exercise alters myofibrillar protein synthesis. J Physiol. 2013;591:2319-31. PMID 23459753. doi:10.1113/jphysiol.2012.244897. https://pubmed.ncbi.nlm.nih.gov/23459753/
119. Mamerow MM, et al. Dietary protein distribution positively influences 24-h muscle protein synthesis in healthy adults. J Nutr. 2014;144:876-80. PMID 24477298. doi:10.3945/jn.113.185280. https://pubmed.ncbi.nlm.nih.gov/24477298/
120. Kim IY, et al. Quantity of dietary protein intake, but not pattern of intake, affects net protein balance primarily through differences in protein synthesis in older adults. Am J Physiol Endocrinol Metab. 2015;308:E21-8. PMID 25352437. doi:10.1152/ajpendo.00382.2014. https://pubmed.ncbi.nlm.nih.gov/25352437/
121. Arnal MA, et al. Protein pulse feeding improves protein retention in elderly women. Am J Clin Nutr. 1999;69:1202-8. PMID 10357740. doi:10.1093/ajcn/69.6.1202. https://pubmed.ncbi.nlm.nih.gov/10357740/
122. Schoenfeld BJ, Aragon AA, Krieger JW. The effect of protein timing on muscle strength and hypertrophy: a meta-analysis. J Int Soc Sports Nutr. 2013;10:53. PMID 24299050. doi:10.1186/1550-2783-10-53. https://pubmed.ncbi.nlm.nih.gov/24299050/
123. Trepanowski JF, et al. Effect of alternate-day fasting on weight loss, weight maintenance, and cardioprotection among metabolically healthy obese adults: a randomized clinical trial. JAMA Intern Med. 2017;177:930-938. PMID 28459931. doi:10.1001/jamainternmed.2017.0936. https://pubmed.ncbi.nlm.nih.gov/28459931/
124. Templeman I, et al. A randomized controlled trial to isolate the effects of fasting and energy restriction on weight loss and metabolic health in lean adults. Sci Transl Med. 2021;13:eabd8034. PMID 34135111. doi:10.1126/scitranslmed.abd8034. https://pubmed.ncbi.nlm.nih.gov/34135111/
125. Catenacci VA, et al. A randomized pilot study comparing zero-calorie alternate-day fasting to daily caloric restriction in adults with obesity. Obesity. 2016;24:1874-83. PMID 27569118. doi:10.1002/oby.21581. https://pubmed.ncbi.nlm.nih.gov/27569118/
126. Harvie MN, et al. The effects of intermittent or continuous energy restriction on weight loss and metabolic disease risk markers: a randomized trial in young overweight women. Int J Obes. 2011;35:714-27. PMID 20921964. doi:10.1038/ijo.2010.171. https://pubmed.ncbi.nlm.nih.gov/20921964/
127. Harvie M, et al. The effect of intermittent energy and carbohydrate restriction v. daily energy restriction on weight loss and metabolic disease risk markers in overweight women. Br J Nutr. 2013;110:1534-47. PMID 23591120. doi:10.1017/S0007114513000792. https://pubmed.ncbi.nlm.nih.gov/23591120/
128. Heilbronn LK, Smith SR, Martin CK, Anton SD, Ravussin E. Alternate-day fasting in nonobese subjects: effects on body weight, body composition, and energy metabolism. Am J Clin Nutr. 2005;81:69-73. PMID 15640462. doi:10.1093/ajcn/81.1.69. https://pubmed.ncbi.nlm.nih.gov/15640462/
129. Heilbronn LK, et al. Glucose tolerance and skeletal muscle gene expression in response to alternate day fasting. Obes Res. 2005;13:574-81. PMID 15833943. doi:10.1038/oby.2005.61. https://pubmed.ncbi.nlm.nih.gov/15833943/
130. Stekovic S, et al. Alternate day fasting improves physiological and molecular markers of aging in healthy, non-obese humans. Cell Metab. 2019;30:462-476.e6. PMID 31471173. doi:10.1016/j.cmet.2019.07.016. https://pubmed.ncbi.nlm.nih.gov/31471173/
131. Varady KA. Intermittent versus daily calorie restriction: which diet regimen is more effective for weight loss? Obes Rev. 2011;12:e593-601. PMID 21410865. doi:10.1111/j.1467-789X.2011.00873.x. https://pubmed.ncbi.nlm.nih.gov/21410865/
132. Cioffi I, et al. Intermittent versus continuous energy restriction on weight loss and cardiometabolic outcomes: a systematic review and meta-analysis of randomized controlled trials. J Transl Med. 2018;16:371. PMID 30583725. doi:10.1186/s12967-018-1748-4. https://pubmed.ncbi.nlm.nih.gov/30583725/
133. Alhamdan BA, et al. Alternate-day versus daily energy restriction diets: which is more effective for weight loss? A systematic review and meta-analysis. Obes Sci Pract. 2016;2:293-302. PMID 27708846. doi:10.1002/osp4.52. https://pubmed.ncbi.nlm.nih.gov/27708846/
134. Beaulieu K, et al. An exploratory investigation of the impact of 'fast' and 'feed' days during intermittent energy restriction on free-living energy balance behaviours and subjective states in women with overweight/obesity. Eur J Clin Nutr. 2021;75:430-437. PMID 32873926. doi:10.1038/s41430-020-00740-1. https://pubmed.ncbi.nlm.nih.gov/32873926/
135. Johnstone AM, et al. Effect of an acute fast on energy compensation and feeding behaviour in lean men and women. Int J Obes Relat Metab Disord. 2002;26:1623-8. PMID 12461679. doi:10.1038/sj.ijo.0802151. https://pubmed.ncbi.nlm.nih.gov/12461679/
136. Schoenfeld BJ, Aragon AA, Wilborn CD, Krieger JW, Sonmez GT. Body composition changes associated with fasted versus non-fasted aerobic exercise. J Int Soc Sports Nutr. 2014;11:54. PMID 25429252. doi:10.1186/s12970-014-0054-7. https://pubmed.ncbi.nlm.nih.gov/25429252/
137. Vieira AF, et al. Effects of aerobic exercise performed in fasted v. fed state on fat and carbohydrate metabolism in adults: a systematic review and meta-analysis. Br J Nutr. 2016;116:1153-1164. PMID 27609363. doi:10.1017/S0007114516003160. https://pubmed.ncbi.nlm.nih.gov/27609363/
