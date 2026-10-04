# Research Protocol — how to write an evidence dossier

You are one of ~16 parallel research agents. Your dossier will be merged into a single
**mechanistic simulation model** implemented in TypeScript. A software engineer who is not a
physiologist must be able to implement your section directly from your file. So: **numbers,
equations, time-constants and citations — not prose summaries.**

## Method
- Use web search and fetch real sources (PubMed, PMC full texts, journal pages, NIDDK, textbooks).
  Prefer, in order: validated mathematical models > meta-analyses / systematic reviews >
  metabolic-ward / tightly-controlled RCTs > free-living RCTs > cohort data > animal / in-vitro.
- **Never invent a citation or a number.** Every quantitative claim needs a source you actually
  located (author, year, journal, PMID or DOI, URL). If you could not verify a number, write
  `UNVERIFIED` next to it. If you rely on memory for a well-known figure, still look it up and confirm.
- When the literature is contested, present both sides and the best-supported quantitative estimate.
- Record effect sizes with uncertainty (CI / SD / range) and the population they came from
  (sex, age, training status, BMI) so we can model moderators.
- Do not organise by named diet. Organise by **input variable -> mechanism -> state variable -> outcome**.

## Required file structure (`research/NN-slug.md`)
1. **Scope** — 3-5 lines.
2. **State variables** — table: name, unit, typical range, what it represents, initial-value rule.
3. **Inputs that drive it** — table: input, unit, how it enters the mechanism.
4. **Mechanisms & equations** — one subsection per mechanism:
   - plain-language mechanism (2-5 lines)
   - the equation(s) or dose-response curve in implementable form (ODE, difference equation,
     piecewise function, saturating curve with parameters). If the literature gives no equation,
     propose one fitted to the cited data points and label it `PROPOSED FIT`, listing the data points.
   - parameter table: symbol, value, unit, uncertainty, source
   - time dynamics: onset lag, time-constant / half-life, saturation, hysteresis, reversal time
   - moderators: sex, age, body-fat level, training status, energy balance, etc.
   - **Evidence grade**: A (meta-analysis / validated model / multiple controlled human trials),
     B (few human RCTs or consistent human mechanistic data), C (limited / indirect human data),
     D (animal / in-vitro / expert opinion). Add one line on why.
5. **Interactions with other subsystems** — what this topic needs from / gives to other modules
   (energy balance, glycogen, ketosis, MPS, hormones, ...).
6. **Output metrics for the UI** — metrics a user could chart or choose as a planner goal: name,
   unit, direction-of-good, how to compute from state variables, evidence grade.
7. **Validation targets** — 3-8 published study results (conditions in, measured outcomes out) the
   engine should reproduce within tolerance. Be precise: subjects, intervention, duration, result.
8. **Myths / contested claims** — things popular belief gets wrong, with evidence.
9. **Safety bounds** relevant to this topic.
10. **Open questions / weakest assumptions.**
11. **References** — numbered, full citation + PMID/DOI + URL.

## Deliverable
- Write the dossier to the exact path given in your task. Be thorough: 600-1500 lines is normal.
- Do not modify any other file in the repository.
- Your final reply (to the orchestrator) must be <= 25 lines: the file path, the 8-12 most
  important quantitative findings, and the biggest uncertainties. Do not paste the dossier.

## Dossier index (who covers what — stay in your lane, cross-reference the others by number)
| # | File | Topic |
|---|------|-------|
| 01 | 01-computational-body-weight-models.md | Published mathematical models of body weight / composition / macronutrient flux (Hall, Thomas, Forbes, Alpert...) with exact equations |
| 02 | 02-energy-expenditure-adaptation.md | RMR equations, TEF per macronutrient, NEAT, adaptive thermogenesis, its timeline and reversal |
| 03 | 03-protein-mps-muscle-retention.md | Protein intake, MPS/MPB, per-meal dosing, protein quality, muscle retention in deficit |
| 04 | 04-carbohydrate-glycogen-insulin.md | Carbohydrate handling, glycogen stores and kinetics, glucose/insulin dynamics, DNL, fibre vs net carbs, sugars |
| 05 | 05-fat-oxidation-ketosis.md | Fat oxidation, ketogenesis kinetics, entry/exit/re-entry of ketosis, keto-adaptation |
| 06 | 06-lipids-cardiometabolic-biomarkers.md | Fat types and blood lipids (LDL/ApoB/HDL/TG), blood pressure, glycaemic markers, liver fat, inflammation |
| 07 | 07-fasting-meal-timing-circadian.md | Eating windows, meal frequency, fasting physiology hour-by-hour, circadian effects |
| 08 | 08-autophagy-longevity-pathways.md | Autophagy, mTOR/AMPK/sirtuins/IGF-1, CR and longevity markers, human evidence quality |
| 09 | 09-resistance-training-hypertrophy.md | Resistance-training dose-response, hypertrophy & strength rates, recomposition, detraining |
| 10 | 10-cardio-activity-expenditure.md | Walking/running/cycling/HIIT energy cost, EPOC, VO2max & mitochondrial adaptation, concurrent training, fasted exercise |
| 11 | 11-overfeeding-surplus-partitioning.md | Surplus: where extra energy goes by macronutrient, with/without training |
| 12 | 12-hormones-appetite-adherence.md | Leptin, ghrelin, thyroid, cortisol, sex hormones; hunger/satiety; diet breaks & refeeds |
| 13 | 13-diet-transitions-periodization.md | Switching between dietary patterns, PSMF, carb cycling, refeeds, 5:2/ADF, water/glycogen transients |
| 14 | 14-anthropometrics-fat-distribution.md | Estimating body composition from simple/visual inputs, regional fat, visceral fat, FFMI, avatar parameters |
| 15 | 15-micronutrients-fibre-hydration-substances.md | Fibre types, gut/SCFA, sodium/potassium/water, micronutrient adequacy, food processing, alcohol, caffeine, creatine |
| 16 | 16-sleep-stress-sex-age-modifiers.md | Sleep, stress, menstrual cycle, menopause, ageing, sex differences as model moderators |
| 17 | 17-safety-guardrails.md | Clinical safety limits, contraindicated populations, warnings the app must show |
| 18 | 18-planner-optimisation-algorithms.md | Algorithms for the in-browser multi-objective regime planner |
| 19 | 19-performance-cognition-bone-other-outcomes.md | Strength/endurance performance, cognition/mood/energy, bone, immune, skin and other outcomes |
| 20 | 20-extended-water-fasting.md | Water-only fasting (electrolytes allowed, zero energy, zero protein) at 24 h, 48 h, 72 h, 5-7 days and longer: full time course, body-composition accounting, refeeding, repeat-fast protocols, safety |
| 21 | 21-intervention-catalogue.md | Every other lever a person can pull (fasting variants, fasting-mimicking, protein pulsing, carb timing, sauna/cold, supplements, step targets...) rated for evidence and for which goals it serves |
