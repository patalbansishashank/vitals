# Integration notes — cross-dossier conflicts and ownership flags
Collected by the orchestrator from the research agents' hand-back reports. The model spec must resolve
each item explicitly (one owner per phenomenon; no double counting).

## Double-counting hazards
1. **Training effect on lean mass** — must exist exactly once. 09 owns the RT accretion term
   (`maxGainRate`, volume curve, energy/protein multipliers). 01 (Hall partition), 03 (`leanFractionOfLoss`
   + hourly MPS model, which 03 says is re-normalised daily so long-term mass change comes only from the
   daily layer) and 11 (lean gain = 09 ceiling × h(EB)) must not add a second training effect.
2. **Adaptive thermogenesis** — 02 owns the AT ODE (AT* = 0.14·(EI − EI0), 40 % resting / 60 % NEAT,
   τ_on 7/14 d, τ_off 14 d). 11's surplus term β_OF = 0.12 is nearly the same thing as Hall's β_AT
   applied to positive imbalance: implement once. 12 says T3 is a biomarker only, not an RMR driver.
3. **Sleep → intake / hunger** — 12 (`D_sleep`) and 16 both model it; apply once. Pick one global sleep
   reference (12 uses 7.0 h, 16 uses 7.5 h).
4. **Water / scale-weight terms** — 13 `M_gut` vs 15 `W_gut,fibre`; 13 `E_cna` vs 15 `L_ket`; sodium
   habituation: 13 `S_na` (τ 5 d, no steady-state change) vs 15 partial habituation h = 0.5 with
   κ = 0.006 kg per mmol/d. One implementation each.
5. **Fibre** — TEF of fibre (02: 0.30 of its 2 kcal/g) vs absorbed-energy correction (15: k_net depends on
   label credit convention). Keep one coherent accounting.
6. **IGF-1** — specified in both 08 (lagged fasting model, grade B) and 12 (protein elasticity 0.43). Merge.
7. **Leptin sex effect** — 12 has sex-specific L0; skip 16's multiplier. Age factor for hypertrophy: prefer 09's `f_age`.

## Numeric disagreements to settle
- Glycogen-bound water: 01 models use 2.7 g/g; 04 sets 3 (range 2-4); 13 uses "4 × glycogen change" for scale weight.
- Glycogen dynamics time-constant: Hall form ≈ 1 d vs calorimetry 3-5 d (11 asks 04 to calibrate).
- Lean-tissue energy density: 1000 vs 1816 kcal/kg (03 vs 01); 02 gives deposition costs 2,050-2,540 kcal/kg.
- Caffeine EE: 02 uses 0.25 kcal/mg; 15 finds 0.10-0.15. Alcohol TEF: 02 0.20 vs 15 0.10.
- Training-status speed: 09 (+2.2 FFMI in year 1) vs 14's BF prior (+1.0).
- β_AT = 0.14 cannot reproduce Leibel 1995 (02 offers an optional high-adaptation scenario).
- Forbes baseline over-predicts lean loss in lean adults (03; Templeman).
- Hall 2010 printed Eq. 12 (lipolysis) and Eq. 37 are wrong/garbled; 01 gives corrected forms.

## Design rulings already implied by the evidence
- No insulin-driven fat-storage term: at equal kcal and protein, carb↔fat swap changes fat balance by 0 ± 20 g/d (04); EE by 0 ± 50 kcal/d per 10 % energy (02).
- No sequencing bonus: periodisation per se earns nothing at equal weekly energy and protein (13); diet breaks only reduce hunger. The planner must not credit sequencing itself.
- Meal timing effects on muscle are small: distribution penalty only on RT gains, floor 0.83 (03).
- Autophagy index is a relative construct (grade C/D) with a mandatory caveat; exogenous ketones must not raise it (08).
- User-set intake is authoritative: hunger/ad-libitum terms feed the hunger/adherence outputs, never silently change intake.
- Hourly fluxes must integrate to Hall's daily fluxes within ±5 % (01).
- Proposed deficit cap: 0.75 × 69 kcal per kg fat mass per day (13, from Alpert) — warning/planner constraint.
- UI uncertainty bands (16): fat change ±35 %, lean ±50 %, hypertrophy ±64 %, RMR ±13 %, TEE ±26 % (80 % bands).
- Metric master list: 19 §6 (56 candidates, core 30).

## Added after dossiers 05, 06, 07, 10, 17, 20, 21 and the body module landed
- **Zero-intake regime (20 is the owner):** 20 §4.4 supersedes the fasting nitrogen/protein-loss models of 03 and 07, which under-predict water-only protein loss in lean users by 1.5-2.5×. 07's BHB values from day 5 on are ~1 mM low for true water fasts (20: 0.3 mM at 24 h, 1.4-1.9 at 48 h, 2.3-2.7 at 72 h, ~4-4.8 by days 6-8, 6-6.6 by day 21). Adaptive thermogenesis at zero intake (02 / Hall 2010) is **replaced** by 20's fasting RMR trajectory during fasts, not added on top. 08's IGF-1 fasting curve needs an obesity modifier (no fall by 72 h in obese men).
- **DXA-lean vs protein tissue:** in a 7-day fast the 3.6-4.6 kg "lean" loss is only ~35 % protein tissue; refeeding restores water/glycogen within 3 days. The metric catalogue must distinguish *lean mass (DXA-equivalent, includes water + glycogen)* from *muscle/protein tissue*.
- **17 copy correction (from 20):** adverse events "≈20 % by day 5" are grade ≥3 events, not *serious* adverse events (SAE 2/768 visits, 0.26 %). Fix the warning text.
- **05 ketone model:** 11/15 validation targets met by its author's own simulation; V8, V14, V15 fail, V7 (exit) ~15 % fast; parameters must be retuned after coupling to 04's glycogen model and reconciled with 20's fasting BHB table. Protein brake on ketosis is weak (−25 % from 0.75 to 2.2 g/kg; plausible range 0-0.69).
- **10 exercise compensation:** metabolic part c_met = 0.15 (0-0.28) vs 02's constrained-TEE term (27.7 %, τ ≈ 60 d, grade C) — one implementation. The appetite part (100·(1 − exp(−E_net/150)) kcal/d) feeds hunger only. Energy-availability convention (net vs gross exercise energy) unsettled between 10 and 17.
- **06 biomarkers:** presented as change from baseline (17's regulatory framing). Proposed lean-hyper-responder LDL term is grade C/D. n-6:n-3 ratio not modelled. HbA1c τ = 50 d; LDL τ 7-10 d; liver fat τ_down 12 d / τ_up 21 d.
- **17 tiers:** fasting ≤24 h default; 24-72 h opt-in; 3-7 d expert mode with attestation; >7 d never prescribed by the Planner. Energy floors 1200 (F) / 1500 (M) kcal/d as 7-day mean; deficit cap 25 % (30 % at BMI ≥30); rate ≤1 % BW/wk and ≤1.5 kg/wk; BMI ≥20 to start a deficit; protein floor 0.8 (1.2 in deficit or age ≥65) g/kg; fat floor 30 g/d.
- **21 levers:** creatine (`CrLoad` state, +0.75-0.9 kg water, 15 % accretion multiplier PROPOSED), caffeine (performance +, sleep −, no fat-loss credit), viscous fibre and omega-3 (lipids/BP), post-meal walk (glycaemia only), sauna (SBP −4 mmHg, PROPOSED half of RCT), post-exercise cold-water immersion (f_CWI = 0.8 on RT accretion, PROPOSED). Extra simulator inputs X1-X19 and planner blocks L1-L19 are in 21 §3 / §4J. Behavioural levers map to an adherence shift only.
- **Body module (`src/engine/body`, built):** API `estimateInitialState`, `estimateBodyFat`, `allocateRegional(prev, target, opts)` (call after FM/SM change; step-size independent; conserves mass), `stateToAvatarParams(state, {baseline})`, slider helpers. Simulation state must carry the `BodyState` fields (fat, muscle, satShares, frameZ, FM/FFM/SM). Untouched sliders must be passed as `undefined`. `Sex` is declared in both `src/engine/body/types.ts` and `src/engine/types` — export from one place. Dossier 09's training status should use `training.{ffmi, ffmiNormalized, ffmiUntrainedRef, trainingYears}`. RMR/PAL in the body module are defaults only; 02 owns RMR.

## Dossier inconsistencies reported by the evidence editors
- 15 §4.7: κ = 0.006 kg per mmol/d vs merge note "0.54 kg per +100 mmol/d (κ 0.0054)".
- Protein-bone result LS-BMD +0.52 % (0.06-0.97): "5 RCTs" in 15 §4.14 vs "16 RCTs" in 19 §4.2.
- 16 §4.8.5 vs V10: "×0.85 with resistance training" reproduces the measured 21 % only if applied to 25 %; V10 applies it on top of ×1.3 (→0.28, at the tolerance edge).
- 16 V7: linear `ageRmrMult` gives 0.81 at age 90 vs ≈0.74 in the paper.
- 15 §8.16 "mean turnover 2.7-4.3 L/d" vs §4.8 means of 4.3 (men 20-30) and 3.4 L/d (women 20-55).
- 15 §4.10: MPS "floor −0.25 / −0.37" reads as a cap on the reduction, not a floor on the multiplier.
- 19 k_h basis "CALERIE ≈1.8/≈10" vs hip ≈ −1.7 % in the same dossier.

## More inconsistencies reported by the evidence editors (rule on each)
1. **Adaptive thermogenesis has three parameterisations:** 01 §4.1.4 (Hall 2010: λ₁ 0.74, τ 7 d, σ 0.52, T = −0.37 → −17.8 % RMR and −19 % activity for a 50 % cut; almost none in surplus, λ₂ 0.02); 02 §4.8 (symmetric β_AT 0.14, σ 0.6, τ 7/14 d); 11 §4.6 (β_OF 0.12, τ 14 d).
2. **Cost of de novo lipogenesis:** ε_d 0.835 in 01 §4.1 (16.5 % lost), 0.8 in 02 §4.11 (20 %), 24.5 % in 11 §4.4, 28 % in 04 §4.13.
3. **Bray 5 %-protein arm REE:** −86 kcal/d (11 §4.5) vs ≈0 (02 §4.5, 03 §4.3, 01 §7.7d). 11 §4.5 TEE "+176 / +2 186 / +1 898 kJ/d" is implausible — verify before using as a validation target.
4. **Constants:** glycogen water 2.7 g/g (01, 11) vs 3.0 (04 §4.1); glycogen energy "17.6 MJ/kg (4.18 kcal/g)" in 01 §4.7 but 17.6 MJ/kg = 4.21 kcal/g (02, 11 use 4,206-4,207 kcal/kg); lean-tissue ρL 1000 kcal/kg (03 §4.4.2) vs 1816 (01, 02, 11).
5. **04 internal slips:** §4.14 — 50 g carbohydrate suppresses lipolysis "≈3 h" (emergent) vs 1.7 h from 0.076·C^0.79; §4.9 glycogen persistence 34/20/46 % at 3/5/7 d is non-monotonic; §4.22 "≈44 g at K_brain 0.58" vs 46.5 g from the formula.
6. **01 / 11 slips:** Hall 2015 deficit −800 (01 §4.7) vs −810 kcal/d (§7.5); 01 §7.1 cites the wrong reference for Minnesota; 11 states Levine's NEAT range as fact while 02 marks it UNVERIFIED.
7. **IGF-1 modelled twice with different kinetics:** 08 §4.12 (lag 30 h, τ 44 h down / 173 h up → 0.52 at 72 h) vs 12 §4.7 (τ 3 d / 10 d → −43 % at 72 h; mispredicts Hartman's "unchanged at 56 h").
8. **T3 carbohydrate dependence:** 12 §4.3 uses 1 − carb/130 (contradicts Spaulding "≥50 g → no change"); 13 §4.11/T14 use a 50 g threshold. **Leptin** forms also differ (12 §4.1 vs 13 §4.11).
9. **08 §4.4:** EC50_I 5 with nI 1.5 gives S_ins = 0.74 at +10 µU/mL but its own data point says 94 % of maximum at +10.
10. **09 §4.14:** strength check gives +31 % at 12 wk vs published 19-27 %.
11. Minor: 12 §4.1 Keim −54 % vs −57 %; Davoodi n = 60 vs 74; MATADOR arm order; resting HR "53 → 27 bpm" (12 §4.13, 13 §4.20) looks wrong; 08 §4.15 "6-10 h" vs 3 × 2-4 h = 6-12 h.

## Third batch (editors of 05, 06, 07, 10, 17, 20, 21)
- **Fasting ketone timing differs:** 05 §4.6 — BHB 0.5 mM at ~21 h, 0.56 ± 0.28 mM at 24 h; 07 §4.4.3 — 0.30 mM at 24 h, crosses 0.5 mM around 30 h; 20 — 0.3 mM at 24 h, 1.4-1.9 at 48 h, 2.3-2.7 at 72 h. One calibration target set must be chosen (cohort-dependent: lean men vs mixed).
- 10 §4.3: K = 150 kcal/d is an e-folding constant (half-max ≈ 104 kcal/d), not a half-saturation constant as §1 says.
- 10 §4.10: two Houmard groups both listed at 170 min/wk.
- 07 §4.4.4: table headed "70-kg reference man" but weights come from the 80-kg man of §4.5; §8 "REE rises ~4-6 % at 36-72 h" vs cited +14 % and −8 %.
- 05: slow adaptation state A_s is called "weeks" but τ = 120 h; MFO grade stated two ways; ketone mass conversion 0.103 vs 0.104 g/mmol.
- 17: warning W-F04 text still says "serious events ~20 % by day 5" — must read "grade ≥3 adverse events 20/28/32 % by day 5/10/15; serious adverse events 2 of 768 visits".
- 20: text fat-oxidation ranges (lean man 180-195 g/d) differ slightly from Tables A1/A4 (174-193).
