# Integration and calibration backlog (collected from module hand-backs)

## A. Energy pathway, fasting, ketones, water (blockers first)
1. **Ketone runaway in long fasts.** 05's muscle-glycogen boost to FFA (k_mgF 3, grade D) combined with 20's fasting
   muscle-glycogen decline (k_Mf) triples FFA: lean BHB ≈ 3.3 mM at 72 h and ≈ 18-28 mM at 21 d (fails O-6). Gate the
   boost to exercise-driven depletion (or drop it in fasts), then retune kP / G50 against 05 V1-V6 and 20's BHB_ref
   (24 h ≈ 0.5 mM accepted). Preview without the boost: kP 0.012 misses BHB_ref by up to 28 %; the 5 g liver floor holds
   insulin at 0.60 instead of 0.45. `ketones/testing/harness.ts: coupledFastProxy` reproduces it. Fuel should read `fasting.kMf`.
2. **Steady state.** Full engine fails MAN steady state (scale +0.32 kg / 30 d), O-12 (lean 0.45 kg) and the t = 0 weight
   check. Energy's own drift is 0.006 kg fat / 30 d; composition re-anchors slow states at end of burn-in; water has no
   tissue offset, so composition must give t = 0 tissue mass = entered weight. FM fell 0.47 kg over 90 d at 100 % in a
   composition-only run (TEE ≠ TDEE0).
3. **Performance.** Signal bus in V8 dictionary mode (core). Ketones 1.4-1.9 ms per 180 d (budget 0.5; raise to 1.5 or
   use typed arrays). Core bench 27-31 ms vs 25 ms bound with partial modules. Target: ≤ 10 ms nominal desktop.
4. **Fasting water and weight at 24/48 h:** −0.98 / −2.19 vs −1.6 / −2.7 kg (13's E_cna + last meal still absorbing);
   water's `fastZeroCarb = 1` switch fixes the table — decide and align; repletion starts ≈ 1 d late (rolling sums);
   V2 fat 3 d after refeed −1.23 vs −1.85 ± 0.5; V9 ADF-vs-daily fat gap needs composition's real partition.
5. **Energy known misses:** V3 (−59 vs −30…+100; caused by GNG cost 0), V4 CALERIE (−92 vs ≤ −100), V6 Biggest Loser
   (−223; −5 % RMR cap), V8 Leibel, V10 Mikkelsen (+161 vs 80-120; k_P). Decide per item: retune within range or record
   in KNOWN_MISSES.
6. **Intake:** 479 g meal glucose peak 9.5 vs 6.6 mmol/L (dossier limitation); compileSchedule counts MCT at 9 kcal/g
   (intake uses 8.3); caffeine half-life declared in both intake and moderators (single owner: intake reads
   `moderators.caffeineTHalfH` × OC multiplier); confirm `fedState`/`absFluxKcalH` exclude a ketone drink's own energy.
7. **Composition:** lean dieters — 03's loss partition is leaner than 11's regain partition, so fat overshoots even
   without the memory term; EB7 lag keeps ≈ 7 regain days in the deficit regime (reviewer's m20 blend); Bray 5 % arm
   miss (+64 %); 10 V22 (exercise reduces VAT without weight loss) has no owner.
8. **Water:** 15 V7 joint scenario miss (h_Na 0.3-0.4 would fix); `cycleDay` 1-based.

## B. Muscle, hormones, appetite, safety, others
9. **Muscle protein factor:** the R-RT swap to 03's per-kg-FFM `f_Pgain` makes Morton ratio (1.07 vs 1.27), Peterson
   (1.61 vs 1.1 kg), Villareal RT arm and Sardeli miss, because older/obese people at 1.0-1.1 g/kg BW have
   q ≈ 1.5-1.7 g/kg FFM. Options: reference-FFM normalisation, or accept and record. Murphy zero-crossing ≈ 600 kcal/d
   (no crossing at 2.2 g/kg up to −1000 kcal/d) — M13.
10. **Safety defaults:** W-M11 and W-M13 fire on the schedule defaults (8 g fibre/1000 kcal, 3 g sodium) — fix the
    defaults or thresholds so an unremarkable default scenario shows no warnings; a 72 h fast trips W-E04 danger via the
    7-day mean intake; always-on info rules W-U01/03/04/05; EA warnings gated on exercise (`safety.eaNeedsExercise`);
    de-duplicate `safetyFlag` between composition (fat floor) and safety; W-M19 pre-fast leg missing; W-F08 uses a proxy.
11. **Hormones/appetite:** IGF-1 obesity modifier not implemented (no form in 08) and Hartman "unchanged at 56 h" not
    met (0.70); leptin Chan 72 h fast −52 vs ≈ −90; T3 Spaulding miss under the 50 g knee; appetite Λ_lean weak for
    lean users; SatDef asymmetry makes ADF look easier than CR; IGF-1 rises 10-15 % above baseline when protein exceeds
    habitual — confirm intended; spec §1.11 still lists ghrelin/SPI/GH display states that were cut; luteal D term
    must be added to spec §1.12.
12. **Activity/moderators:** interim RPE map x = 0.25 + 0.075·RPE (unverified, needs a source or a flag);
    ruled hRef 7.0 weakens sleep effects slightly (V5 just under band); `epocRt` default 0 (post-RT REE is the slow
    EPOC); interval MEM weights not implemented (no work:rest in the schedule); V17 M_r miss; V16 56-d detraining −12 vs −16 %.
13. **Cellular:** re-run ASI anchors with real fuel/ketones (h50 56 h, EC50_I); one-meal-a-day daily mean −5.6 vs
    dossier; 12-h reference sampling needs a burn-in crossing hFast ≈ 12 h.
14. **Wellbeing:** keto-induction median resolution (τ_p 2.5 d gives 6.7 d vs Bostock 4.5 d → τ_p ≈ 1.7 d); P1NP day
    3-5 dynamics; EA baseline depends on burn-in carrying habitual sessions.

## C. Contract requests not yet applied (see also docs/CONTRACT_REQUESTS.md)
- Schedule inputs: 21 §4G adherence levers (selfMonitor, mealReplacement, preMealWater, flexibleRestraint); post-RT
  cold-water immersion flag; per-fast `refeed` flag; `HabitProfile.smoker`; optional habitual liquid kcal and energy density.
- Signals: `liverGlycogenMaxG` (fuel → ketones), `rtDoseFrac` (muscle → composition), `fatFloorActive`,
  `exSessionNetKcalD`, `eee7` in SafetyTrace; `reproRiskFemale` init 0; prune unused readers (hormones, appetite,
  wellbeing, cellular, fasting lists in the hand-backs).
- Loop: pass `abortOn` to modules (`ModuleContext.abortOn`), let `StateBound.series` name SafetyTrace keys;
  `SimulationResult.constraints` (or the planner calls `computeConstraintMargins`).
- Budgets: ketones 1.5 ms; intake 1.0 ms.
- **Status (engine finisher, 2026-09-30 late):** the signal items are applied (`liverGlycogenMaxG`, `rtDoseFrac` read by
  composition, `fatFloorActive`, `exSessionNetKcalD`, `SafetyTrace.eee7/fastDay/ei28`, reader pruning — `checkWiring` has no
  issues and nothing pending); `abortOn`, `StateBound.series` on SafetyTrace keys and `SimulationResult.constraints` were
  applied by integration A1. Whole engine: planner 6.6 ms, simulate 8.1-9.9 ms per 180 d (bundled, §0.3). Schedule-input
  levers remain open.

## D. Planner-engine follow-ups (for the planner-domain owner, after the integrators finish)
- Implement the 18:10 rulings: fast `durationH` meal to meal; opted-in fasts governed by tier rules with 28-day
  floors (so 24 h / 72 h / 3-7 d fasts are usable at their tiers instead of being dropped); explanation says why a
  fast was or was not used.
- First-class request fields for the user's longest-fast limit and protein/carbohydrate floors (the UI currently
  sends them as extra planner locks tagged `user`).
- Daily P10-P90 ranges per plan (UI uses catalogue fallback bands); a score in progress events (UI computes its own);
  a severity on each safety note (UI sorts by keywords).
- Diversity: real runs returned only one plan — investigate the diversity stage/selection thresholds so 2-3
  meaningfully different options come back whenever the feasible set allows.
- Use `RunOptions.initialSnapshot` (when A1 lands it) to skip burn-in; re-run decoder fuzzing against the final
  input contract (new fields from Integrator B).
- "By week n" deadlines for goals (design asks; engine lacks) — optional.

## E. UI follow-ups
- `ConvergenceChart` duplicate React keys with exactly two points (charts).
- Simulator TODOs: week scrubber for long horizons, multi-day "Edit selection…", custom refeed ramps, per-meal
  protein source; PNG export of charts; print stylesheet for plans.
- Your-body: "prefer not to say" sex mode in `estimateInitialState`; expose maintenance uncertainty from the engine;
  `habitualEnergyDensityKcalPerG` not exposed.
- Evidence articles whose text says "the engine does X" for machinery the spec replaced (01 Hall fuel/DNL, 05 fallback
  insulin, 07 fasting curves, 13 fat-adaptation, 16 sex multipliers) need a wording pass.
