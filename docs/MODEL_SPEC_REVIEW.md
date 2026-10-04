# MODEL_SPEC v1 — independent review (2026-09-30)

Reviewer: independent physiological-modelling / numerical-software review of `docs/MODEL_SPEC.md`, `src/engine/types/**`,
`src/engine/core/**` and the 16 stubs, against `docs/INTEGRATION_NOTES.md` and the dossiers (opened surgically).
Line numbers refer to `docs/MODEL_SPEC.md` **after** the edits applied in this review.

## Verdict (10 lines)
1. **Ready for parallel implementation: yes, after 3 decisions** (B3 maintenance closure, M5/M6 double counts, M7 fasting regime switch); everything else can start now.
2. The architecture (one owner per phenomenon, signal bus, hourly closed forms, oracles) is sound and the rulings table resolves every INTEGRATION item on paper.
3. The core energy/mass pathway had two conservation-level defects, both now fixed in the spec: glycogen water counted twice in scale weight (B1) and a rectified hourly deposition cost that contradicted its own citation and the core's conservation check (B2).
4. The ketone integrator prescribed by R-KETNUM failed the spec's own 0.05 mM/5 % tolerance by 40–90 % on fast decays; replaced by 4 × 15-min exponential sub-steps (B4).
5. Seven module inputs the algorithms need had no signal or reader (activity had no RMR, fasting no TEE, energy no planned EAT, composition no activity/RT index…); added to the contract (B5).
6. A weight-stable habitual exerciser drifts at "maintenance" (burn-in has no habitual sessions, TDEE0 ≠ model TEE, post-RT REE not in TDEE0, FM/LT drift hidden by water offsets) — needs a ruling (B3).
7. Several unit/definition slips were fixed: sleep partition shift applied to the wrong fraction (×4 too weak), repletion g/h vs kg/d, luteal RMR not mean-zero (−1.3 kg/yr), caffeine baseline, trained-user SM_RT offset, NaN α_mix on zero days, float-equality hold of AT_R.
8. Validation targets checked by back-of-envelope/scripts are reachable: BWP −5 MJ/d path (engine-like re-implementation within 1.2 kg of the oracle at 180 d — tight), 7-d fast ≈ −5.4 to −5.7 kg (needs the gut fix M16), liver glycogen −63 % at 24 h, BHB 0.5/1.3–1.6/2.3–2.8 mM at 24/48/72 h with kP ≈ 0.008–0.009, novice +1.49 kg (only if run at e = 0).
9. Safety mapping is faithful to 17 (floors, caps, tiers, refeed ramps); the W-F04 copy is now given verbatim; T3/T4 eligibility and the VLED "V" tier should be added to the lever tier data (m7).
10. Repo stays green for the files touched here: `tsc -b --noEmit` 0 errors, `eslint src/engine/{types,core,model}` clean, `vitest run src/engine/core` 32/32, `vitest run src/engine` 230 pass + 3 expected-fail. `eslint src/engine` reports 1 error in `src/engine/validation/fixtures/programs.ts:133` (react-hooks/rules-of-hooks on a function named `use`), a WP-V file created during this review — not touched.

| Severity | Count | APPLIED | DECISION NEEDED | Note only |
|---|---|---|---|---|
| BLOCKER | 5 | 4 (B1, B2, B4, B5) | 1 (B3) | 0 |
| MAJOR | 17 | 9 | 8 | 0 |
| MINOR | 22 | 5 (m1, m2, m16, m17, m18) | 2 (m6, m8) | 15 |

---

## BLOCKERS

### B1 — Scale weight counts glycogen water twice (§1.10 l. 590-599, §4 `labileWaterKg`, §9.1 O-5) — **APPLIED**
- **Wrong:** §1.10 defined `labileWaterKg` as the sum of deviations *including* glycogen water `h·ΔG`, and then
  `scaleWeightKg = tissueMass + (G_L + G_M)/1000·(1 + h) − G0_mass + labileWaterKg` — `h·ΔG` appears twice. The signal table
  said the same ("Glycogen water + ECF…"). `core/loop.ts` checks `scale = FM + FFM_act + labileWater` (no glycogen mass at all),
  so the spec, the O-5 invariant and the core check were three different identities.
- **Evidence:** a 7-day fast removes ≈ 290 g glycogen (20 Table A1): scale would fall by 4·0.29 + 3·0.29 = 2.0 kg instead of
  1.16 kg (error +0.87 kg on a −5.7 kg target, tolerance ±0.8).
- **Fix (applied):** `labileWaterKg = (1 + h)·(G_L + G_M − G_ref)/1000 + E_cna + S_na/140 + (M_gut − M_gut,ref) + E_oed + PV +
  W_cycle + W_Cr − H_def`; `scaleWeightKg = tissueMassKg + labileWaterKg`. Signal description (spec §4 and `signals.ts`) and O-5
  updated; now identical to `core/loop.ts`'s mass check and the water stub.

### B2 — Deposition cost: rectified hourly η contradicts Hall, the core check and 02's meal-frequency null (§0.2 l. 38, §1.8 steps 4-6 and invariant) — **APPLIED**
- **Wrong:** §0.2 said "Mobilisation returns ρ (η enters with the sign of the change …)" — self-contradictory. §1.8 then used
  `(ρ + η)` for gains, `ρ` for losses and `depositionCost = η·max(0, Δ)` **per hour**. `core/loop.ts`'s daily O-4 check uses
  `(ρ + η)` both ways, and the p_E conversion in step 2c used `(ρ + η)` for a *loss* regime (pCat 0.25 → effective 0.269).
- **Evidence:** 01 §4.2.4 / 02 §4.11: "EE includes η_F·dF/dt + η_L·dL/dt" (signed; Hall's τ formula contains η_F + ρ_F).
  Scratch model (3 meals/d, 2 900 kcal, glycogen buffering): Σ positive hourly S_h ≈ 660 kcal/d → rectified cost ≈ 17 kcal/d
  (−0.65 kg fat/yr at "maintenance"); one meal/d ≈ 29 kcal/d → a spurious ~12 kcal/d *meal-frequency effect*, which 02 §4.4
  rules out (grade A null) and which leaks into O-8/O-9. Rectified η also double counts TEF (fat TEF 2.5 % ≈ η_F 1.9 %).
- **Fix (applied):** Hall convention everywhere: effective density ρ + η for gain and loss, `depositionCostKcalH = ηF·ΔFM + ηL·ΔLT`
  (signed), hourly invariant `S_h = (ρF + ηF)ΔFM + (ρL + ηL)ΔLT`, daily `EI − TEE − ΔE_gly − ketone loss = ρF·ΔFM + ρL·ΔLT`.
  Fasting branch ΔFM = `(S′ + (ρL + ηL)|ΔLT|)/(ρF + ηF)` (protein energy returned ≈ 5.3 kcal/g incl. the η_L saving; effect on
  20 V1 fat ≈ 0.04 kg/7 d). The composition stub placeholder already used the signed form; no code change needed.

### B3 — Maintenance does not close for users with habitual exercise; burn-in drift is hidden (§0.1 l. 29, §3.4 l. 993, §1.5 init, `core/compileSchedule.habitualTemplate`, `core/resolveProfile`) — **DECISION NEEDED**
- **Wrong:** (1) `TDEE0` includes `EAT0 = sessions·(MET − 1)·BW/7` (resolveProfile) but `habitualTemplate` has **no exercise**,
  so the 14-day burn-in runs at +EAT0 kcal/d, detrains VO2max (τ 30 d) and empties the RT history. (2) In the simulation the
  model TEE of a habitual lifter adds post-RT REE (0.05·REE·(1 − 0.5·H) ≈ 45-90 kcal/d, 09 §4.13), EPOC and uses "net of own
  RMR" instead of "MET − 1": model TEE ≠ TDEE0 at "100 % of baseline". (3) FM/LT drift during burn-in is never re-anchored;
  §3.4 says t = 0 weight is "enforced by water's reference offsets", which hides a fat-mass error rather than removing it.
- **Evidence:** 3×/wk RT, 90 kg: post-RT REE ≈ 0.05·1 850·0.5-1.0 = 46-92 kcal/d → −1.8 to −3.6 kg/yr for a person told
  they are at maintenance. The owner's must-have "weight-stable person stays stable" is untested (no maintenance-drift
  target in §9).
- **Recommended fix (all three):**
  (a) `habitualDay` → a habitual *week* (7 DayInputs; `sessionsPerWeek` sessions of 60 min at the habit MET mix on
  alternating days; RT sessions with the 09 "moderate" preset), cycled twice in burn-in;
  (b) energy calibrates at the end of burn-in: `NEAT0 += EI_hab − mean(model TEE over the last 7 burn-in days)` (so every
  term the analytic TDEE0 misses — post-RT REE, EPOC, GNG baseline, TEF of fibre/alcohol — is absorbed once);
  (c) composition resets FM, LT, SM (and energy its FM0/FFM_act0 references) to the profile values at `endOfDay` of day −1;
  add invariant **O-12**: MAN / WOMAN / LEAN_MAN with habitual training at 100 % baseline maintenance for 90 d:
  |ΔFM| < 0.15 kg, |Δscale(wake)| < 0.3 kg.

### B4 — Ketone integrator (R-KETNUM) fails its own tolerance (§1.7 step 5 l. 418, §2.2 l. 892) — **APPLIED**
- **Wrong:** one 60-min step of the ODE linearised at T0 over-shoots Michaelis–Menten decay whenever T falls by more than
  half within the hour (exogenous-ketone decay 05 V11, refeeding exit V7 / 20 §4B.3 "BHB halves in 1 h").
- **Evidence (scratch `ket.py`, 90 kg / FFM 67.5 kg, 05 §4.17 constants):**

  | case | exact | 5-min Euler | 60-min linearised | 4 × 15 min |
  |---|---|---|---|---|
  | T0 = 3 mM, P = 0 | 0.405 | 0.340 | **0.041** | 0.396 |
  | T0 = 5 mM, P = 0.2 (refeed after 7-d fast) | 1.127 | 1.032 | **0.632** | 1.109 |
  | T0 = 2.5, P high (fasting rise) | 1.868 | 1.851 | 1.849 | 1.867 |
- **Fix (applied):** four 15-min sub-steps of the same exact-linearised exponential (4 `Math.exp` per hour, allocation-free);
  hour mean = mean of the four sub-step means. O-10's 0.05 mM / 5 % gate stays.

### B5 — Contract gaps: modules cannot implement their algorithm without reading another module's state (§4, `signals.ts`, stubs) — **APPLIED** (definition of `aerobicIdx`: M14)
| Needed by | For | Was | Now |
|---|---|---|---|
| activity | "net of the person's own RMR", displaced baseline 0.2·RMR, post-RT REE 0.05·REE (§1.2 step 2) | no RMR readable | reads `rmrKcalH` (h−1) |
| fasting | `prLate·TEE/29.4` (20 §4B.1); `Kk` needs exogenous BHB | no TEE, only total BHB | reads `tdeeEstKcalD` (d), `bhbEndoMmolL` (h−1) |
| energy | `tdeeEstKcalD = … + plannedEAT` "via the activity module's estimate" | no signal | new `exPlannedKcalD` (activity, day, startDay) |
| composition | 03 M_act "activity index", 11 `s_RT = min(1, V_wb/12)`, 03 ΔL_age RT term | none (rtRetentionFrac uses V_R(age), not 12) | new `aerobicIdx` (activity), `rtVolumeWb` (muscle, d−1) |
| muscle | "×0.95 beyond the 10th set when `muscleGlycogenRel` < 0.5" (§1.9 step 1) | not declared | reads `muscleGlycogenRel` (h) |
| ketones | exogenous BHB × (fed ? 0.75 : 1), MCT meal factor (§1.7 step 4) | not declared | reads `fedState` (h) |
`checkWiring` stays empty (loop/registry tests pass); signal count 111 → 114.

---

## MAJOR

### M1 — Sleep partition shift added to the mass fraction instead of the P-ratio (§1.8 step 2c l. 474; §4 `partitionSleepShift`) — **APPLIED**
16 §4.0.1 converts Nedeltcheva to the **P-ratio** (protein *energy* share) and states "raises a P = 0.09 baseline to ≈ 0.18".
The spec added it to pCat (lean *mass* share): +0.09 on mass ≈ +0.02 on energy → ~4× too weak. Fix: `p_E = f(pCat·(1 − R_RT)) +
partitionSleepShift`, clamp [0, 0.9]; the multiplication by (1 − R_RT) now precedes the energy conversion.

### M2 — Repletion flux booked with the wrong time unit; dangling "protein ceiling" (§1.8 step 2 l. 484, §1.4 step 4) — **APPLIED**
`leanExtraKgD = … + fastRepletion·(1 + h_P)/1000` mixed kg/d with `fastRepletionGH` (g **per hour**) → 24× too small. §1.4
said composition "subtracts it from the protein ceiling, §1.8" but §1.8 had no such step. Fix: explicit hourly
`ΔLT_rep = fastRepletionGH·(1 + h_P)/1000`, and `q` for the partitions excludes 24·fastRepletionGH (20 §4B.1 "03 must not
double-count"). `ΔL_age` (g/d) converted to kg explicitly.

### M3 — Luteal RMR term is not mean-zero (§1.5 step 2 l. 305) — **APPLIED**
`(1 + a_lut·s(d))` adds +5 % RMR in the luteal half → +2.5 % mean ≈ +35 kcal/d over the cycle, while RMR0 (Mifflin/Müller) is
phase-averaged → −1.3 kg/yr at "maintenance" for every cycling woman. Fix: `(1 + a_lut·(s(d) − s̄))`, s̄ = cycle mean of s.

### M4 — Caffeine EE: wrong baseline and unit (§1.5 l. 305-312) — **APPLIED**
`0.10·(mg − 150)` used the population habit, not the user's (drift of 0.1 kcal/mg·(habit − 150)); energy read
`caffeineLoadMg` (body load, mg) while the formula needs the daily dose; `Tol` lives in intake's state. Fix: dose from
DayInput, `mg_hab` from the profile, hourly shape ∝ load, energy keeps its own 14-d tolerance EMA.

### M5 — GNG cost double counts protein TEF (and 20's calibrated fasting REE) (§1.5 step 2 l. 313, R-GNG) — **DECISION NEEDED**
Fuel's GNG = 0.57·protOx + 0.10·fatOx; +77 g/d protein raises GNG by ≈ 44 g → 0.2·4·44 = 35 kcal/d **on top of** TEF_P
(0.25·4 = 1 kcal/g, which already contains ureagenesis/GNG ATP: FAO NME 3.2 vs ME 4.0, 02 §4.4) and kP (0.6 kcal/g/d).
Protein thermogenesis becomes ≈ 2.1 kcal per g (51 % of protein energy) and 02 V10 Mikkelsen (+80-120 for +117 g) is at
risk (≈ 82 TEF + ≈ 50 kP + ≈ 53 GNG). In fasts, 20's `fastRmrMult` is fitted to *measured* REE, which already includes GNG.
**Recommendation:** set `energy.gngCost` default 0 (keep 0.2 as registry high, sensitivity only); if kept, restrict it to
GNG from **tissue** protein and glycerol above the burn-in baseline while `fastActive = 0` and never with protein intake.

### M6 — Protein-turnover term kP stays on during fasts (§1.4 R-FAST, §1.5 step 2 l. 304) — **DECISION NEEDED**
At zero intake P_eff → 0 (τ 2 d): `kP·(P_eff − P0)` ≈ −0.6·100 = −60 kcal/d by day 5, *multiplied* by fastRmrMult whose
φ_AT/A_SNS were fitted to measured fasting REE (20 V3 Dai −7.5/−13.7/−20.3 %) that already contains the turnover drop →
≈ −3.5 points of extra REE fall. Same logic as "AT_R held". **Recommendation:** while `fastActive`, hold P_eff (and compKcalD)
like AT_R; resume on refeed.

### M7 — Composition regime chosen per day; short planned fasts switch lean accounting off (§1.8 step 2a l. 466; §1.4 step 1) — **DECISION NEEDED**
Regime (a) is selected when `fastActive` at the day's first hour or a planned fast covers ≥ 12 h; after the fast is broken
mid-day `fastProtOxGH = 0` and the rest of the day books **no lean change at all** (refeed protein → fat). `hour.plannedFast`
activates the overlay for any span, so a 16-h FastEvent gets 20's peak N rate (≈ 3.4 g protein/h) while the same eating
window expressed through `meals.window` does not — a representation artefact the planner can exploit.
**Recommendation:** pick the branch **per hour** (fasting branch iff `fastActive` this hour, else the fraction branch with
the day's p_E); `plannedFast` activates the overlay only for spans ≥ 24 h (shorter ones use the 24-h intake criteria).

### M8 — Carbohydrate eaten during exercise never enters intake (§5.2 cardio `carbDuringGPerH`; `compileSchedule.ts:674`) — **DECISION NEEDED**
The compiler writes it only to `HourInput.exCarbDuringGPerMin`; it is not in `DayInput.carbG/energyKcal`, not in any meal,
and §1.3 does not absorb it, so its energy is missing from `eAbsKcalH` (60 g/h × 2 h = 480 kcal) while fuel may use it for
liver sparing (§1.6 "full sparing at ≥ 1.2 g/min"). **Recommendation:** compiler adds it to the day's carbohydrate and
energy totals (compile note `carbsDuringExerciseAdded`) and intake absorbs it as glucose with t_p 0.5 h (04 §4.3); fuel
reads only `raGlcGH`.

### M9 — Fat-mass clamp breaks energy conservation in long fasts of lean users (composition stub `fmKg < 0.5`; §9.1 O-4 vs O-6) — **DECISION NEEDED**
8 % BF, 70 kg (FM 5.6 kg) at ≈ 180 g fat/d reaches the 0.5-kg clamp around day 28 — inside O-6's 28-day run; clamping
drops the residual energy (O-4 fails) and scale weight stalls. 01 §4.6's Alpert cap (69 kcal/kg FM/d) cannot be used as a
general law (20's lean man oxidises ≈ 150 kcal/kg FM/d). **Recommendation:** smooth floor: fat share of a negative S′ is
multiplied by `clamp((FM − FM_min)/1.0 kg, 0, 1)` with FM_min = 0.02·BW0, the remainder taken from LT at ρL + ηL (conserving);
emit a `safetyFlag` when it engages.

### M10 — `smRtKg` non-zero at t = 0 for trained users; SM split 0.85 vs 0.7 (§1.9 step 2 l. 558, §1.8 step 7 l. 498) — **APPLIED**
`smRtKg = 0.7·Σ M_acc` with `M_acc,0 = TS0·G_pot > 0` gives RMR_mass(0) = RMR0 − (γL − γSM)·SM_RT0 ≈ −9·4.2 = −38 kcal/d for a
3-year lifter (02's form assumes SM_RT(0) = 0). Composition added `0.85·rtAccretion` to skeletal muscle (03 §4.19) while
muscle reports 0.7 (09 §4.9) for the same kilograms. Fix: `smRtKg = 0.7·Σ(M_acc − M_acc,0)`; composition uses 0.7 (R-RT).

### M12 — `maintenanceKcalD` is 0/0 on zero-intake days (§1.5 step 3 l. 318) — **APPLIED**
`EI_inst = (…)/(1 − α_mix)` with α_mix "for the planned macro mix": EI = 0 → α_mix = 0/0 → NaN into 'current' days, fasting
criteria (`kcal24 < 0.10·maintenance`) and safety. Fix: realised α_mix when EI_day > 0.1·EI0, else α_mix0.

### M13 — Protein acts twice on lean mass in deficit + RT (03 M_P in the partition, 09 ρ(P) in A_r) — **DECISION NEEDED**
09 §4.8 fitted d0/ρ_max (Murphy zero-crossing ≈ 500 kcal/d, Longland, Garthe) *on top of a protein-free Forbes partition*
("after adding the retention term… 01 computes the non-training partition"); the engine uses 03's protein-modified partition.
Not a structural double count (different mechanisms) but the calibration no longer holds. **Recommendation:** keep both,
re-verify 09 §7 Murphy/Longland/Garthe with the real composition partition in WP-M8/M7 and, if Murphy's zero-crossing moves
below ≈ 400 kcal/d, set ρ_max to its low 0.5.

### M14 — 03's M_act "activity index" is undefined (§1.8 step 2c; 10 §4.13 is the health "ActivityHealthIndex", not this) — **DECISION NEEDED**
Signal `aerobicIdx` now exists (B5). **Recommendation:** `aerobicIdx = clamp(7-d mean net cardio EE (exSessionNet, cardio only)
/ 300 kcal·d⁻¹, 0, 1)` (≈ 150 min/wk moderate → 0.5; Chaston's aerobic arms ≈ 1); steps stay in NEAT only.

### M16 — Gut contents do not empty in a fast (§1.10 l. 597) — **APPLIED**
13 §4.5's target `(S0 + 5·NSP)·T_tr` keeps S0 = 162 g/d (men) at zero intake → ≈ 0.3-0.5 kg of the 20 V1 weight loss missing
(spec path: −4.9 kg vs −5.8 ± 0.8). Fix: target 0 while `fastActive` (τ_empty 1.5 d).

### M19 — `fastRmrMult ≠ 1` equality test holds AT_R forever after the first fast (§1.4 step 2 l. 259; `signals.ts`) — **APPLIED**
s_AT relaxes exponentially and never returns exactly to 0. Fix: hold while `active ∨ |fastRmrMult − 1| > 0.001`.

### M20 — Convention constants became ensemble draws (§0.4 l. 65, §8.1 l. 1341, §1.8 params l. 453, R-RHO) — **APPLIED (densities) / DECISION NEEDED (rule)**
§0.4 makes every rejected alternative a `low/high`; §8.1 draws every `low < high`. `rhoL` [1000, 1816] would draw lean
densities of a *different convention* (hydrated DXA lean), breaking f_prot = 0.385 and 20's protein energy per draw. Applied:
ρF, ηF, ρL, ηL, ρG, f_prot are `draw: 'fixed'`; 03's 1000 recorded in `note`. **Rule to decide:** a rejected alternative
becomes `low/high` only when it is a plausible value *of the same quantity*; structural/convention alternatives go to `note`
(also review `t3CarbKnee` [50, 130], `hRef` [7.0, 7.5], 20's γ_P/γ_F "alternatives" which are not even used by the formula).

### M21 — Liver/HGO supply surplus has no destination (§1.6 step 6 l. 368) — **DECISION NEEDED**
Step 6 covers "supply < demand" only. In fasting, GNG (0.57·protOx + 0.10·fatOx ≈ 3 g/h on day 3) + lactate + J_L,out exceeds
CHOox (brain floor × (1 − ketone share) ≈ 2 g/h): implementers will either drop the glucose (display only) or add it to liver
glycogen (then G_L plateaus higher and ketogenesis φ, fitted via G50, changes → R-KET retune). **Recommendation:** J_L,out and
lactate follow 04 as written; `GNG = max(0, HGO − J_L,out − lactate)` (GNG fills the gap; 0.57·protOx is only its capacity for
display); if `J_L,out + lactate > HGO`, CHOox rises to consume them. This keeps G_L on 04's fitted τ_L curve (63 % gone at 24 h).

---

## MINOR

| ID | § / line | Finding | Status / fix |
|---|---|---|---|
| m1 | §4 `maintenanceKcalD` l. 1061 | Written at energy's endOfDay; fasting (runs before energy) sees yesterday's value; tag said (d) | APPLIED → (d−1). Note: every startDay/stepHour reader effectively sees d−1. |
| m2 | §1.16 l. 757; 17 §3 | W-F04 text only partially specified; 17 still says "serious events ~20%" | APPLIED: full 176-char replacement text given. Dossier 17 itself not edited. |
| m3 | R-DNL, §4 `dnlHeatKcalH` | "28 %" (04 uses 4.1/9.4 kcal/g); engine formula 4 − 9.441·0.3125 gives 26.2 % | Note only (formula is internally conservative). |
| m4 | §1.6 step 4/7 | EE_np subtracts 4 kcal/g protOx; fasting protein is 4.7-5.3 kcal/g; 04 §4.11 uses 4.7 → Oracle B (±5 %) may miss by ≈ 7 % on fat ox | Use 4.7 kcal/g in EE_np for O-3, or define O-3 on the same convention. |
| m5 | §0.2, §1.6 | Glucose-equivalent g → glycogen g conversion (4.0/4.207) not stated in fuel | State it in §1.6; conservation is unaffected (ledger uses ΔG energy). |
| m6 | §1.8 | Absolute LT0 undefined (stub placeholder LT0 = FFM0); `leanTissue` is shown absolute | DECISION: LT0 = FFM0 − (1 + h)·G0/1000 (recommended) or present leanTissue as change only. |
| m7 | §10.3 l. 1473 | 17 §4.3.2 T3 "upgraded eligibility" (BMI ≥ 22, BF ≥ 15/25 %, no gout/stones/meds), T4 (BMI ≥ 25, double ack) and tier V (VLED/PSMF, BMI ≥ 30) not encoded | Add to `waterFast.tier` / a `vled` lever gate. |
| m8 | §5.2 vs 18 §4.4.2 | 18's `carbShareNonProtein` not expressible (pctEnergy is of total energy; runtime energy/protein vary) | DECISION: add `MacroAmount` unit `pctNonProteinEnergy`. |
| m9 | `compileSchedule.ts:664` | Sessions crossing midnight are truncated at 24:00 (minutes lost) | Carry the tail into day d+1's table. |
| m10 | §4 `exSessionNetKcalH` | Three daily modules each accumulate the same hourly signal | Simplify: activity writes a daily `exSessionNetKcalD`. |
| m11 | §4, §1.11 | Cut candidates: `rqHour`, `ffaMmolL` (no readers, no metric); composition's unused reads `bhbEndoMmolL`, `maintenanceKcalD`; GH and ghrelin/SPI states (no consumer); goal eligibility of both `rtMuscleGain` and `skeletalMuscle` next to `leanTissue`; `tdee` as a "maximise" goal (planner can chase exercise volume) | Recommend cutting/clarifying. |
| m12 | §1.2 | RT gets both `epocRt` 0.05 (10 §4.2) and post-RT REE 0.05·REE for 72 h (09 §4.13) — the latter is the slow EPOC | Keep one (recommend 09's post-RT REE, epocRt = 0 for RT). |
| m13 | §1.14 | `insulinResistanceIdx = 1 − S_I` with S relative to the user's baseline → 0 for everyone at t = 0; 02 m_IR and 05 IR scaling intend absolute IR | Note (m_IR PROPOSED anyway). |
| m14 | §1.2 | 10's `obesityWalkFactor` 1.10 [1.05, 1.15] (grade B) omitted | Add to walking cost. |
| m15 | §1.3 step 1 | Slots retired with < 0.1 g left leak mass | Flush the residue into the current hour. |
| m16 | §1.3 l. 224 | eAbs used 9 kcal/g for MCT (§0.2 says 8.3) and ignored exogenous BHB energy (ρK 4.45 kcal/g) | APPLIED. |
| m17 | §1.12 l. 658 | D_ex filter τ 14 d; owner 10 `tauAp` = 28 d | APPLIED (τ 28 d [14, 42]). |
| m18 | §1.10 l. 599 | `leanMass` term list omitted W_cycle and H_def (Δlean ≠ Δscale − ΔFM) | APPLIED: `leanMass = scale − FM` (stub already did this). |
| m19 | §9.1 O-1 | Spec-like daily re-implementation lands +1.0-1.2 kg above BWP at 180 d (kP term alone +0.6 kg) vs ±1.5 kg | Run O-1 with protein at constant %E and kP on; if it fails, disable kP for the oracle scenario only. |
| m20 | §1.8 step 2 | Partition jumps between 03 (lean:fat ≈ 0.27) and 11 (≈ 0.3-0.5) when eb7 crosses 0 around maintenance | Tolerable (S ≈ 0 there); optional linear blend over |eb7| < 100 kcal/d. |
| m21 | §9.2 09 #1 | Benito +1.49 kg is at e = 0; a schedule at 100 % *baseline* with new RT gives e ≈ −0.07 → f_E 0.77 → ≈ +1.15 kg (edge of ±0.4) | Validation fixture must set energy to model TEE (e = 0). |
| m22 | §1.3 / R-LEVERS | Post-meal-walk glycaemic factor is named in R-LEVERS/§11.1 but has no term in §1.3's A_m | Add `M_walk` factor to A_m when steps in the hour after a meal exceed a threshold (21 §4 value). |

---

## Spot checks of spec parameters against the cited dossier sections (48 values)
All ✓ unless marked.
- **02:** γ_L 22 [19.7, 22.8]; γ_F 3.2 [3.1, 4.5]; γ_SM 13; β_AT 0.14 [0.05, 0.40]; σ 0.6 [0.4, 0.8]; τ_R 7 [3, 14]; τ_N 14 [7, 30];
  τ_off 14 [14, 42]; TEF P/C/F 0.25/0.075/0.025; MCT extra 0.065; fibre 0.30; m_IR 1 − 0.25·IR; k_P 0.6 [0.3, 1.1], τ_P 2 d, clamp
  0.4-3.5 g/kg; a_lut 0.05 [0.02, 0.09] (✗ centring, M3); temperature 0.11/°C; η_F 179 (= 750 kJ); TDEE0 steps form; NEAT0 residual;
  worked-example targets 2976/2773.
- **04:** C_L,max 500 [400, 550]; V_liv 1.45 [1.2, 1.8]; c_M,max 200 [180, 290]; h 3.0 [2, 4]; τ_L 24 h [18, 36]; floor 5 g; R_half
  10 g/h; keto reduction 0.75 [0.6, 0.8] (04 §4.4); k_Mr 0.0035 [0.002, 0.005]; c_M,floor 25; S_max 7.5 [5, 10]; E_rapid 1.0,
  τ_E1 1.5 h, τ_E2 36 h; D_max 0.40 [0.25, 0.50]; f_C,pa 0.45; f_C,max 0.95; EC50_ox 54 µU/mL; DNL 3.2 g/g; GNG 0.57 g/g; glycerol
  0.10; B_max 250, K_I 300, b_P 0.6.
- **05 (§4.17 K):** all 32 constants in §1.7 match (Vd 0.25, clFFM 0.0134, Km 6, a_m 0.35, renal 0.00025, T_thr 1, kP 0.010,
  F_hep 0.15, φ_min 0.12, nG 2.5, kI_hep 0.15, a_h 0.35, a_hs 0.5, k_prot 0.15/90, τ_prot 8, F0 0.5, τF 1.0/1.5, kFB 15, e_def 1.5,
  k_mgF 3, ex_F 0.4, τ_postF 3, ex_CL 1, post_CL 0.6, C50 100, τAf 48/40, As 0.5/2.0/120, yC8 0.5, yC10 0.17, meal 0.5,
  R = 1.5 + 0.3·TKB, brain 0.70·T/(T + 1.5)). G50: 05 uses 55·FFM/60 g, spec 0.55·G_L,max (≈ 64 g for everyone) — acceptable
  pending the R-KET retune.
- **20 (§4B.2):** a_SNS, t_p, t_lag, τ_AT 9/4, φ_AT, k_Mf 0.008 [0.005, 0.012], n_pk, pr_late, τ_N 8/3/7, h_P 1.6 [1.1, 3.0],
  C_carb 0.45, K_ket 0.3, K_ex, L_max 0.75, τ_rep 2, A_oed 0.08/2.0 — all match.
- **07 / 03 intake:** kGE 270 kcal/h, KGE 150 kcal, lag 0.5 h, fed ≥ 30 kcal/h; protein Vmax 11 g/h, Km 20 g.
- **09:** k_g 0.001507/d; f_age 1 − 0.0086·(age − 40) floor 0.6; R_max 0.75 [0.5, 0.95]; d0 0.30 [0.20, 0.45]; ρ_max 0.8; b_s 0.15;
  e_sat 0.10; V_R 6 → 10; κ_mem 1.3 → ruled 1.0; post-RT REE 0.05·REE·(1 − 0.5H).
- **10:** step cost 0.44 kcal/kg/1000; c_met 0.15 + 0.010·clamp(BMI − 25, −5, 8), cap −5 % RMR, τ 14 d; displaced baseline 0.2·RMR;
  epocRt 0.05; appetite comp τ 28 d (✗ spec had 14 d, m17).
- **11:** φ_C 0.10 [0.05, 0.15] with the EI > EI_ref gate; β_OF 0.12; r_L as lean:fat **mass** ratio (consistent with the spec's
  p_E formula); ρ/η constants.
- **15:** k_net 2.8 kcal/g, clamp [−0.06E, +0.03E]; alcohol TEF 0.10; fibre TEF 0.30 only while 15's add-on is 0 (consistent).
- **16:** τ_F 1/2 d, τ_S 3/5 d, caps 4 (5), k_Si 0.07, k_P 0.04 cap 0.12 (✗ applied to the wrong fraction, M1).
- **13:** E_max 0.6, C_ref 100, k_fast 0.5, τ 1.5/0.7 d; S0 162/83, slope 5, T_tr 2/3 d; τ_Na/h_Na combination reproduces
  0.0054 kg per mmol/d (0.75·ΔNa/140).

## Validation targets — reachability checks
| Target | Check | Result |
|---|---|---|
| Hall BWP −5 MJ/d × 180 d ≈ −20 kg (01 §4.2.6) | Oracle port (01 §4.12) vs a daily re-implementation of the spec's energy + deficit partition (`bwp.py`) | BWP 79.9 kg @180 d; spec path 81.1 (03 partition), 80.9 (Forbes), 80.5 (kP off). Reachable, 1.2 of 1.5 kg margin (m19). |
| 7-d water fast ΔBW ≈ −5.7 kg, fat 1.3-1.9 kg (20 Table A1, V1) | Term-by-term with spec rules, 20's lean man | fat −1.25, protein tissue −1.63, glycogen + water −1.15, ECF −0.9 + gut −0.5 → −5.4 kg ✓ (−4.9 without M16). |
| BHB 0.3 / 1.4-1.9 / 2.3-2.7 mM at 24/48/72 h | 05 kinetics coupled to 04 liver (τ 24 h, floor 5 g) + 20 k_Mf (`fastket.py`, 5-min Euler) | kP 0.010: 0.64/1.86/3.30 (72 h high); kP 0.009: 0.57/1.58/2.79; kP 0.008: 0.50/1.33/2.31. 48/72 h reachable with kP 0.008-0.009; 24 h ends 0.5 (05's own 0.56 ± 0.28; 20's 0.3 not reachable together) → keep 24 h at ±0.15 mM tolerance or accept as K. |
| Liver glycogen ≈ 60-65 % gone at 24 h (04 §4.2) | τ_L = 24 h exact exponential | 63 % ✓ (from fed stores). |
| Novice +1.5 kg FFM in 10 wk (09 #1) | 09 §4.9 reference simulation +1.49 kg with f_P(1.4) = 03 f_Pgain(1.4) | ✓ at e = 0 only (m21). |
| Bray REE ≈ 0/+160/+227 ± 60 (R-BRAY) | kP·ΔP + γ_L·ΔLT + 0.4·β⁺·ΔEI | ≈ −11 / +109 / +200 ✓. |
| Levine ΔTEE +350-550 ± 150 | TEF + β⁺ + TH_C + η | ≈ 290 ✓ (lower edge). |

## Items I could not check
- Hourly downscaling of 04's fuel rules (Oracle B, O-3) and the Acheson/Bussau/Schrauwen targets — needs the fuel implementation.
- 12's leptin/T3/HPI regressions, 06 lipid/BP coefficient tables, 08 ASI anchor calibration, 19 bone/endurance — not traced (outside the energy/mass pathway).
- 14 body-module outputs (glycogen init, SMM split) were taken as given.
- Performance budget (≤ 10 ms / 180 d) with 4 ketone sub-steps: +3 `Math.exp`/h ≈ 13 k calls per run, expected < 0.2 ms.

---

## Appendix A — hand traces (reference man MAN: 35 y, 180 cm, 90 kg, 25 % BF, FM 22.5 kg, FFM 67.5 kg, Mifflin RMR0 1 855,
7 000 steps; TDEE0 = (1.15·1 855 + 0.44·90·7)/(1 − 0.0872) = 2 640 kcal/d; TEF0 230; NEAT0 555; P0 = 103 g)

Ledger identity checked in every trace: `eAbs − teePre − dnlHeat − ketoneLoss − ρG·ΔG = S = (ρF + ηF)ΔFM + (ρL + ηL)ΔLT` and
`scale = FM + FFM_act + labileWater`. "Owner" = the single module that computes the term.

### A.1 Scenario (a) — maintenance, mixed diet (15.6/45.4 %E P/C, fibre 8 g/1000 kcal), sedentary, after burn-in
**One hour (13:00-14:00, lunch 35 % = 924 kcal at 13:00, t_p 1.25 h):**
| Term | Owner | kcal/h |
|---|---|---|
| eAbs (gamma/MM/gastric kernels) | intake | ≈ 190 (176 lunch + 14 breakfast tail) |
| RMR 1 855/24 | energy | 77 |
| TEF = α·appearing energy (0.087·190) | energy | 17 |
| NEAT 555 over 16 waking h | energy | 35 |
| teePre | energy | 129 |
| ΔG ≈ +2 g (CHO 21 g appearing, CHOox ≈ 20 g, J_L,out suppressed) → ρG·ΔG | fuel | 8 |
| DNL heat (G_tot < 0.95 G_cap) / ketone loss (BHB < 1) | fuel / ketones | 0 / 0 |
| S_h = 190 − 129 − 8 | composition | 53 |
| ΔLT = p_E·S/(ρL + ηL) (p_E ≈ 0.06) → +1.6 g; ΔFM = 0.94·53/9 620 → +5.2 g | composition | — |
| depositionCost (signed) = 179·0.0052 + 229·0.0016 | composition → energy's TDEE record | 1.3 |
**One day:** eAbs 2 640 = teePre 2 640 (RMR 1 855 + TEF 230 + NEAT 555 + EAT 0 + GNG cost 0 + TH_C 0); ΣΔG = 0; Σdep = 0 (signed:
fed-hour deposition cancels fasted-hour mobilisation); S_day = 0 → ΔFM = ΔLT = 0; scale constant. **Before B2** the same day
booked +17 kcal of rectified deposition cost → −1.8 g fat/d. **Before M3** a cycling woman got +35 kcal/d luteal RMR.
**Open (B3):** with habitual 3×/wk RT the day adds post-RT REE 46-92 kcal and EPOC not present in TDEE0.

### A.2 Scenario (b) — 25 % deficit (EI 1 980 kcal, baseline reference), RT 3×/wk (training day), 2 g/kg protein (180 g), week 4
| Term | Owner | kcal/d | Booked once? |
|---|---|---|---|
| eAbs: P 720, C 688 (172 g), F 540, fibre 32 | intake | 1 980 | ✓ |
| RMR: 1 855 + mass (−6) + AT_R (−35) + kP·(180 − 103) (+46) + comp (−c_met 0.178·86 = −15) | energy | 1 845 | ✓ (AT once: 02 ODE; comp once: 10 c_met) |
| TEF 0.25·720 + 0.075·688 + 0.025·540 + 0.3·32 | energy | 255 | ✓ |
| NEAT 555·88/90 + AT_N (−47) | energy | 496 | ✓ |
| EAT: RT 60 min MET 5 → gross 450 − own RMR 77 − displaced 15 + EPOC 19 + post-RT REE 69 | activity | 446 | m12: EPOC + post-RT REE overlap |
| GNG cost 0.2·4·(+40 g) | energy | 32 | ✗ **M5**: duplicates TEF_P |
| teePre (training day) | energy | 3 074 (rest day ≈ 2 700) | |
| ΔG (RT depletion refilled), DNL, ketone loss | fuel / ketones | ≈ 0 | ✓ |
| S_day = 1 980 − 3 074 | composition | −1 094 | |
| RT accretion A_r (f_E 0.17, ρ(P) 0.64 → f_EP 0.70) ≈ +4 g LT | muscle → composition (explicit, costs 8 kcal) | — | ✓ 09 only |
| Catabolic: pCat 03 (q 2.67 g/kg FFM, d 0.25) ≈ 0.15 × (1 − R_RT 0.75) = 0.037 → p_E 0.008 → ΔLT_f −4.4 g | composition | — | ✓ (but M13: protein in both M_P and ρ(P)) |
| ΔFM = −1 094/9 620 | composition | −0.114 kg | ✓ |
Protein thermogenesis = TEF_P 180 + kP 46 + GNG 32 = 258 kcal for 180 g (36 % of protein energy); without M5's GNG term 226.
Muscle's accretion and composition's partition move different kilograms (A_r explicit; R_RT scales only the catabolic term;
in surplus 11's (1 − s_RT) removes the sedentary term) ✓.

### A.3 Scenario (c) — day 3 of a water-only fast (planned FastEvent, electrolytes on)
| Term | Owner | kcal/d | Booked once? |
|---|---|---|---|
| eAbs, TEF | intake / energy | 0 / 0 | ✓ |
| RMR_mass 1 855 − 22·0.6 − 3.2·0.5 = 1 840; AT_R held; kP·(P_eff 29 − 103) = −43; × fastRmrMult (1 + A_SNS 0.049)(1 − 0.15·s_AT 0.054) = 1.041 | fasting (mult) + energy | 1 871 | ✗ **M6**: kP drop on top of 20's fitted multiplier |
| NEAT 555·0.97 + AT_N (−43, 02 continues per 20 §4B.1) | energy | 495 | ✓ |
| GNG cost (73 vs 64 g/d baseline) | energy | 7 | (M5) |
| teePre | energy | 2 373 (20 Table A1 lean man day 3: 2 354) | |
| ΔG: liver −4 g, muscle −k_Mf·(G_M − 0.35·G_M0) ≈ −32 g → ρG·ΔG | fuel (k_Mf from 20) | −151 | ✓ |
| Urinary ketones: TKB ≈ 3.4 mM → Ren 78 mmol/d × 0.46 | ketones | 36 | ✓ (20's 10 g/d constant not added) |
| Protein: N = 67.5·0.2275·0.87 + 6.6·0.13 = 14.2 g N → 89 g/d → ΔLT = −0.231 kg; energy returned (ρL + ηL)·0.231 | fasting → composition | 473 | ✓ (03/07 N models not used) |
| S_day = 0 − 2 373 − 36 + 151 | composition | −2 258 | |
| ΔFM = (−2 258 + 473)/9 620 | composition | −0.186 kg (20: −0.19) | ✓ |
| Water: E_cna → −0.9 L (τ 1.5 d, k_fast); gut → 0 (M16); glycogen water (1 + 3)·ΔG | water | — | ✓ (20's E_fast and 15's L_ket not added) |
| Scale Δ(day 3) ≈ −0.186 − 0.231 − 0.144 − 0.1 | water | ≈ −0.66 kg (20: −0.8) | ✓ |
Fuel reports protOx = fastProtOx (display only); fatOx residual is display only — fat mass comes from the energy ledger ✓.

## Appendix B — scratch scripts
`<scratch folder>/` (session scratchpad; not part
of the repo): `rect.py` (B2 rectification bias), `ket.py` (B4 integrator), `bwp.py` (O-1 comparison), `fastket.py` (BHB retune
feasibility). The pre-edit spec is saved there as `MODEL_SPEC.orig.md`.

## Appendix C — files changed by this review
- `docs/MODEL_SPEC.md`: §0.2, §1.2 step 6, §1.3 eAbs, §1.4 step 2, §1.5 steps 1-3, §1.7 step 5, §1.8 params/steps 2-7/invariant,
  §1.9 step 2, §1.10 algorithm/lean, §1.12 D_ex, §1.16 W-F04, §2.2 R-KETNUM/R-RHO, §3.2, §4 table (+3 signals, readers, descriptions),
  §9.1 O-5.
- `src/engine/types/signals.ts`: new `exPlannedKcalD`, `aerobicIdx`, `rtVolumeWb`; readers for `rmrKcalH`, `tdeeEstKcalD`,
  `bhbEndoMmolL`, `fedState`, `muscleGlycogenRel`; descriptions of `partitionSleepShift`, `smRtKg`, `labileWaterKg`, `fastRmrMult`.
- Stubs (reads/writes only): `activity`, `fasting`, `ketones`, `energy`, `composition`, `muscle`.
