# Orchestrator rulings on `docs/MODEL_SPEC_REVIEW.md` (2026-09-30 16:27 IST)
The reviewer's verdict: ready for parallel implementation after decisions (5 BLOCKER, 17 MAJOR, 22 MINOR; most
unambiguous fixes already APPLIED to the spec, `signals.ts` and six stubs). Every DECISION-NEEDED item is ruled
below; **all reviewer recommendations are accepted.** These rulings are NOT yet written into MODEL_SPEC.md — a
core-contract (WP-C) pass must apply them, and the affected module engineers must be told.

| Item | Ruling | Affects |
|---|---|---|
| B3 maintenance drift for habitual exercisers | Burn-in runs over a habitual week; calibrate NEAT0 over the last 7 burn-in days; reset FM/LT/SM at day −1; add invariant O-12 (no drift at maintenance). | core loop, energy, validation |
| M5 gluconeogenesis cost | Default 0 (it double-counts protein TEF and dossier 20's fasting REE fit); keep 0.2 as the registry high. | energy, fuel |
| M6 protein-turnover term during fasts | Freeze P_eff while fasting, the same way AT_R is held. | energy, fasting |
| M7 composition regime selection | Choose per hour, not per day; planned fasts under 24 h use the normal (non-fasting) criteria. | composition, fasting |
| M8 carbohydrate eaten during exercise | Schedule compiler adds it to the day totals; intake absorbs it as glucose. | core compiler, intake |
| M9 fat-mass floor | Replace the 0.5 kg hard clamp with a smooth fat floor; the remainder comes from lean tissue; raise a safety flag. | composition, safety |
| M13 protein effect counted in both 03's partition and 09's accretion | Calibration item: re-verify the Murphy zero-crossing (≈500 kcal/d deficit cancels RT lean gain); lower ρ_max to 0.5 if needed. | composition, muscle |
| M14 `aerobicIdx` | 7-day mean net cardio energy ÷ 300 kcal/d, clamped 0-1. | activity |
| M20 rejected alternatives in the registry | Convention alternatives go to the ParamDef `note`, not to low/high, so they are not sampled as ensemble draws. | all modules |
| M21 surplus glucose supply in fuel | Gluconeogenesis fills the gap: GNG = HGO − J_L,out − lactate. | fuel |
| m6, m8 | Accept the reviewer's definitions (absolute LT0; planner macro unit `pctNonProteinEnergy`). | core, planner |

Known calibration tension to carry into the integration pass: with kP ≈ 0.008-0.009 the 48 h / 72 h fasting BHB
targets are reachable but 24 h sits at ≈0.5 mM rather than dossier 20's 0.3 mM (dossier 05 reports 0.56 ± 0.28 mM
at 24 h in lean men, so 0.5 is within the evidence). The O-1 BWP oracle margin is tight (1.2 of 1.5 kg).

# Rulings of 2026-09-30 18:10 IST (after all module hand-backs)
| Item | Ruling |
|---|---|
| Fuel deviation 1 (muscle glycogen above the normal-diet reference is used on demand) | **Accepted** — required for O-3 (no spurious DNL at 45-70 %E carbohydrate at maintenance). Write into spec §1.6. |
| Fuel deviation 2 (depleted muscle refills before meal glucose is oxidised, below reference only) | **Accepted.** |
| Fuel deviation 3 (`choOxGH` is net carbohydrate oxidation; amino-acid glucose is counted in `gngGH` but booked as protein) | **Accepted** — single booking of protein energy. |
| Fast duration semantics | `durationH` of a fast event is **meal to meal** (last intake to first intake). A planned fast with durationH ≥ 24 gets fasting accounting (M7); the compiler must not turn a 24 h fast into 23 h. |
| Fasts vs the 7-day energy floor / deficit cap (planner dropped 72 h fasts; safety raised W-E04 danger for a 72 h fast) | The owner requires 24 h, 72 h and week-long water fasts to be usable. **Fast events at a tier the user has opted into are governed by the fasting-tier rules (duration tier, spacing, refeed days, cumulative fasting cap), not by the rolling 7-day energy floor or deficit cap.** Those two rules are evaluated on non-fast days, and a fast additionally must respect a 28-day mean-intake floor (same kcal floors as dossier 17 HC-E1, applied to the 28-day mean) and the rate-of-loss cap evaluated on 28-day tissue-mass trend (not scale weight). In the Simulator the fast shows its own tier warning instead of W-E04. Tiers stay as ruled: ≤24 h default, 24-72 h opt-in, 3-7 d expert with attestation, >7 d never prescribed. Mark this rule PROPOSED (grade D) in the registry and in the Evidence safety topic wording later. |
| Planner protein cap | 2.2 g/kg is a soft target; hard caps 35 % of energy and 3.1 g/kg FFM. **Accepted.** |
| Fasting levers in the planner | Offered only when the user ranks a transient-marker goal (ketones, autophagy index, IGF-1) above lean mass or states a fasting preference — consistent with dossier 20's verdict of no fat-loss advantage. **Accepted**; the explanation text must say why a fast was or was not used. |
| Ketone module budget | 1.5 ms per 180-day run accepted if the whole engine meets its target; engine target stays ≤ 10 ms nominal on desktop (currently ≈ 14-25 ms). |
| Muscle protein factor (R-RT swap to per-kg-FFM `f_Pgain` broke 09's older/obese targets) | Integrator decides between reference-FFM normalisation and recording known misses; prefer the option that restores 09's calibration without breaking 03's deficit table. |
| Activity RPE map (x = 0.25 + 0.075·RPE) | Keep as PROPOSED/unverified ParamDefs; note in KNOWN_MISSES/evidence as an interim convention. |
