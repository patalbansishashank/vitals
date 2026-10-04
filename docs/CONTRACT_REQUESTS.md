# Contract requests from module engineers (for the core owner, WP-C)

## Performance (flagged independently by cellular, water, composition, energy)
- `createSignalBus()` leaves the 114-signal bus in V8 dictionary mode; every bus access costs ~5-6 ns instead of ~1 ns,
  roughly doubling each module's step cost (the core's own 180-day bench now reads 27-31 ms against a 25 ms bound with
  only some modules real). Build the bus as a fast-properties object (object literal / class with all fields
  initialised in one shape, e.g. generated literal or `Object.fromEntries(SIGNAL_DEFS.map(d => [d.name, d.init]))`)
  or back it with a `Float64Array` + index constants. No eval (CSP).

## Signals / readers
- water: add `water` as a reader of `energyBalance7KcalD` (for `weightPlateau`); document `cycleDay` as 1-based.
- composition: allow composition to emit the fat-floor flag (it currently emits `safetyFlag`, which §7.1 reserves for
  safety) — either a `fatFloorActive` signal or an event; add a muscle signal `rtDoseFrac = min(1, V_wb / V_R(age))`
  so composition stops copying V_R as fixed params.
- energy: add `ResolvedProfile.eat0Kcal`; state in the spec that TEF uses the day's macro mix on absorbed energy (or
  make energy a reader of `raGlcGH` etc.); state that energy reads `moderators.lutealAmp` by id with fallback 0;
  B3 calibration relies on burn-in days −7…−1 being the habitual week.
- cellular: optional `insulinBasalUuMl` signal; drop unused declared reads (`absFluxKcalH`, `fedState`).
- wellbeing: SIGNAL_DEFS lists ~24 readers wellbeing does not use (checkWiring forces declaring them) — prune;
  optional daily `exSessionNetKcalD`.

## Spec notes to reconcile
- cellular: `dL = raAaQGH/raAaQ_pa − 1` divides by ~0 (post-absorptive value is 0); implemented as
  `raAaQGH/(k·FFM)` with k = 0.10 g/kg FFM/h (proposed-fit). h50 set to 56 h (dossier 48; allowed 36-60) to hit anchors.
- water: `fastZeroCarb = 1` switch so natriuresis starts with the fast (matches dossier 20's 24/48/72 h table).
- composition: 10 V22 (exercise reduces VAT without weight loss) has no owner in the spec.
- energy validation misses kept as expected-fail: V3 (caused by GNG cost 0 ruling), V4, V6 (−5 % RMR cap), V8, V10.

## Integration failures observed with partially real modules
- Full engine currently fails MAN steady state (scale +0.32 kg), O-12 (lean 0.45 kg) and the t = 0 weight check;
  composition must give t = 0 tissue mass = entered weight (B3c) since water has no tissue offset.

## 2026-09-30 18:45 — Integrator A1 (energy/mass backbone, core loop) → Integrators A2 and B
- **A2 · intake — run state kept in the constants object (blocks exact snapshot/restore).** `intake`'s `prepare()` returns the
  per-run trajectory caches (`pKeyG/pKeyV/pLen/pRef/pDig/pSlope/pRem`, `gKeyE/gKeyLag/gLen/gRef/gEm/gRem`, `trajNext`) and meal
  slots reference them across hours (reference counts, in-flight trajectories). K must be immutable after `prepare`
  (MODEL_SPEC §0.5: state is `structuredClone`-able and complete). With `RunOptions.initialSnapshot` (new, for the planner)
  the restored run diverges at day 0 hour 0 (`raProtGH` 3.92 vs 0 g/h, `eAbsKcalH` 100.7 vs 42.9). Fix: move those arrays
  into `IntakeState` (allocated in `init`); nothing else changes. Verified: with intake's K folded into its state the whole
  16-module engine restores bit-identically (1 152 module-hours compared). `core/__tests__/loop.test.ts` carries the real-module
  case as `it.fails` until then.
- **B · muscle — habitual resistance training is not at equilibrium at t = 0 (dominant O-12 failure).** Burn-in freezes the
  training states and publishes `rtAccretionKgD = 0`; from day 0 the habitual week's RT volume accretes as for a novice when
  `body.trainingYears` is absent (TS₀ = 0), even with `habits.trainingHistory = '1to3y'`. Full loop, habitual week at 100 %
  of maintenance, 90 d: lean tissue +1.79…+1.92 kg, fat −0.54…−0.58 kg (energy-consistent), wake scale +1.26…+1.36 kg, glycogen
  +15…+18 g (larger muscle) — ages 22-70, BMI 20-38, both sexes, 3 RT sessions/wk. With `body.trainingYears` 1/3/6: lean
  +1.12/+0.42/+0.10 kg per 90 d; LEAN_MAN (3 y) +0.45 kg; validation MAN_EX (3 sessions, mix 0.5, no history) +0.45 kg / 30 d.
  Every other part of the ledger is flat (with `rtAccretionKgD` forced to 0 the same RT rows give |ΔFM| ≤ 0.08, |ΔLT| ≤ 0.016 kg).
  Suggested fix (mirrors energy's NEAT0 calibration): treat the habitual weekly volume as the maintenance stimulus — at the end
  of burn-in set the accretion reference so that the habitual week gives A_r ≈ D_r (only volume/protein above habitual
  accretes), keeping novice gains for users who *start* training (habitual sessions 0). Secondary (B · resolveProfile/body):
  when `body.trainingYears` is absent, derive an effective value from `habits.trainingHistory` (e.g. lt1y 0.5, 1to3y 2, gt3y 4 y).
- **B · safety — fat floor.** Composition now writes `fatFloorActive` (1 − g of review M9, hourly, 0 normally) and no longer
  emits `safetyFlag`; please drive W-01-FATFLOOR from `fatFloorActive` (declared reader) instead of recomputing the floor.
- **A2 / B · "ketones above 3 while eating" danger warnings** (results-view observation): a planned fast inside a deficit
  produced keto-fed danger warnings. The fed/fasted test must use the fast's own intake (W-05-KETO-FED should not fire while
  `fastActive` = 1 or within the refeed hours where BHB decays from the fast); ketone owner (A2) to confirm BHB decay on refeed,
  safety owner (B) to gate the rule.
- **B · core/compileSchedule — per-hour copy cost.** In a bundled 180-day planner run (all modules, 14-d burn-in, ≈ 8.3-9.9 ms)
  `expandDayToHours` is 4.1 % and `loadHour` 2.1 % of the run (≈ 0.6 ms). Suggest: have `loadHour` copy only fields that change
  within a day (or expose the hour table as typed columns the modules index by hour) and skip the meal/session scan for hours
  without events. The loop now expands the habitual burn-in week once (7 instead of 14 expansions).
- **A2 · fuel, ketones, intake — top per-hour costs.** Self-time share of a bundled planner run: fuel 14.2 %, ketones 13.6 %,
  intake 12.8 % (≈ 1.2-1.4 ms each per 180 d); `param()` lookups in `prepare` 3.4 % (cardiometabolic `buildK` alone
  120 µs per run, intake prepare+init 70 µs, safety 65 µs). See `docs/MODEL_SPEC.md` §0.3 table for the current per-module costs.

## 2026-09-30 (evening) — Integrator B (moderators, activity, muscle, hormones, appetite, cellular, cardiometabolic, wellbeing, safety; input contracts)

### For A1 (core types / loop)
- `types/result.ts` `SafetyTrace` doc comments must follow the semantics the safety module now fills (MODEL_SPEC §1.16, ruling
  18:10 "fasts vs the 7-day floor / deficit cap"): `ei7` = the intake the HC-E1 floor applies to (7-d mean over **non-fast
  days**; with a planned fast-event day in the trailing 28 d the lower of that and the 28-d mean; on a fast-event day the
  28-d mean); `tdee7`, `deficitPct7`, `proteinGPerKgRw`, `fatPctEnergy` over non-fast days (NaN on fast-event days);
  `rate14*` = OLS slope of tissue mass over 28 d when a fast-event day lies in that window, else 14 d; `bmi` and
  `bodyFatPct` from tissue mass (17 "projected BMI", no glycogen/water swings). Optional: explicit `fastDay: Uint8Array` and
  `ei28: Float32Array` fields so the planner can show why.
- SIGNAL_DEFS readers to prune (declared-but-unused; checkWiring lists them as pending): `activity` from
  `muscleGlycogenRel`, `ketoAdaptFast`; `wellbeing` keeps only `exSessionNetKcalD, ffmActKg, fatMassKg, muscleGlycogenG,
  ketoAdaptFast, sleepDebtSlowH, labileWaterKg, vo2maxMlKgMin, skeletalMuscleKg, fastActive, ageYears` and is no longer a
  reader of `exSessionNetKcalH` (it reads activity's daily `exSessionNetKcalD`). The sub-integrators' lists for muscle,
  hormones, appetite, cellular and cardiometabolic follow in the final report.
- `ModuleContext.abortOn` (safety reads it through a cast today; review list item C).
- More stale readers (sub-integrator reports): `muscle` from `insulinUuMl`, `bhbMmolL`, `fedState`, `hoursSinceMealH`,
  `tdeeEstKcalD`; `hormones` from `energyBalanceFrac`, `energyBalance7KcalD`, `bhbMmolL`, `hoursPostAbsorptiveH`,
  `fastHoursH`, `eaKcalKgFfm`, `ea7KcalKgFfm`, `exSessionNetKcalH`, `sleepDebtSlowH`, `stressLevel`, `atKcalD`, `cycleDay`;
  `appetite` from `energyBalanceFrac`, `scaleWeightKg`, `fatMassKg`, `leptinRel`, `stressLevel`, `atKcalD`.
- `SafetyTrace.eee7` (trailing 7-d session EEE, INTEGRATION_TODO C) — safety computes it (`q.eee7`) but the trace has no field.
- composition (O-12 / hormones): habitual RT personas recompose at maintenance (fat −0.2 kg, lean +0.7 kg per 90 d; muscle
  accretion at TS ≈ 0.6 is physiology per 09); at 6 % body fat that alone moves leptin/testosterone −10 %. Non-RT arms of
  the muscle targets miss on the partition side: Villareal aerobic −1.26 vs −2.7 kg, Ballor diet lean share 11.6 vs 24-28 %,
  Chaston sedentary 0.19 vs 0.27, Mettler control-protein arm −0.65 vs −1.6 kg (numbers from the muscle sub-integrator).
- fuel (A2 via wellbeing): muscle glycogen relaxes −2.6 % over 10 d after t = 0 at the exact habitual intake (f70 BMI 20
  sedentary: 143.5 → 139.8 g), i.e. it is not at its burn-in equilibrium at `endBurnIn`.

### For A2 (intake / fasting / fuel / ketones)
- fasting: planned-span activation (≥ `plannedMinSpanH` 24 h, ruling M7) should use the new
  `CompiledSchedule.fastSpans[i].mealToMealH` (last intake → first intake) instead of `endHour − startHour`: since the
  18:10 meal-to-meal ruling the span covers only the whole hours strictly between the two intake hours, i.e.
  `durationH − 1` hours for a 24-h fast (fallback when absent: `endHour − startHour + 1`).
- intake: caffeine half-life × `moderators.caffeineSmokerMult` (0.56) when `profile.habits.smoker` (new field), as it
  already does for the combined-OC multiplier; moderators applies both for its bedtime residual.
- fuel: spurious events at habitual maintenance in the full loop — `glycogenLow` for 16-18 of 54 personas (older and/or
  BMI 38 with habitual RT or cardio, e.g. m70 BMI 27 RT) and `supercompensation` (f70 BMI 20).
- ketones: 25 g/d carbohydrate at maintenance reaches only BHB ≈ 0.13 mM (no ketosisEntered; 05 expects nutritional
  ketosis 0.5-3 mM); older women on a 72-h water fast exceed 6 mM (`ketoneAlert`, W-05-KETO-FED danger).

## 2026-09-30 20:45 — Integrator A1 (validation owner) → A2, B, orchestrator
- **A2 · fasting — 24-h meal-to-meal fasts get no fasting accounting.** A `FastEvent(day, 24, 20)` compiles to the span
  [21 h, 44 h) (23 h after the 20:00 meal, `mealToMealH` 24). The overlay activates only for spans ≥ 24 h, so the weekly 24-h
  fast scenario shows peak N 3.0 vs 13.5 g/d and net protein −5 vs 315-675 g over 12 wk. Ruling 18:10: "a planned fast with
  durationH ≥ 24 gets fasting accounting; the compiler must not turn a 24 h fast into 23 h" — fasting should test
  `mealToMealH` (or B's compiler should keep the 24-h span).
- **A2 · fuel — glycogen swings too small for the water/weight rows.** KD switch (13 V1): total glycogen 580 → 481 g on
  31 g/d carbohydrate (dossier ≈ −300 g); short overfeeding (Jebb 12 d, Ravussin 9 d, Müller 7 d, Díaz 42 d): +60…+100 g
  then declining. Water's own terms behave as specified (E_cna −0.41 L on the KD vs the dossier's −0.4), so these weight rows
  are registered to A2 in `validation/knownMisses.ts`. Also requested: a published `rq24`-ready pair (daily VO2/VCO2 or
  CHO/fat/protein oxidation sums) so the catalogue can carry a 24-h RQ detail series.
- **B · compileSchedule defaults — dietary sodium does not scale with food.** Overfeeding by 33-60 % keeps sodium at the
  habitual 3 g/d, so ECF does not expand in short overfeeding (15 A_nat = 0 by R-WATER; the only sodium path is S_na). Suggest
  `sodiumMg` default per 1 000 kcal of the day's energy (habitual g/d × E/TDEE0) when the template does not set it.
- **B · moderators — 16 V2 (Wang) shift is exactly 0**: with the ruled hRef 7.0 h a 7.0-h night carries no debt, so
  `partitionSleepShift` = 0 in both arms (row registered, fix pending).
- **B · muscle — Murphy zero-crossing** measured at 788 kcal/d (target 500-700; ruling M13: ρ_max → 0.5 if needed).
- **Orchestrator · spec decision** (MODEL_SPEC §11.1): O-5 anchors the entered weight at t = 0 (midnight) while users enter
  a morning weight — the day-0 wake scale sits −0.1…−0.45 kg below it (overnight glycogen/water fall); literal O-12 "day-90
  wake vs t = 0" includes that offset. Keep, or anchor labile references at the habitual wake hour?
- **All · validation register.** Every must-pass row that misses is now in `src/engine/validation/knownMisses.ts` (owner,
  class, measured value, reason) and runs as `it.fails`; K rows too. When your change makes a row pass, the suite turns red:
  delete the entry (A1 owns the file; a one-line removal by the owner who fixed it is fine).

## 2026-09-30 — Integrator A2 (intake / fuel / ketones / fasting): integration pass

**Signals added by A2 (additive, `types/signals.ts`; WP-C/A1 please add the §4 rows and prune readers):**
- `muscleGlycogenExDefFrac` (fuel → ketones, hour, 0..1): exercise-driven muscle-glycogen deficit ÷ fed reference — 05's
  δ_M. Fixes the long-fast ketone runaway (20's k_Mf decline no longer feeds 05's FFA boost).
- `liverGlycogenMaxG` (fuel → ketones, day, g): G_L,max for ketones' G50 = g50Frac·G_L,max (replaces registry peeking).
- `insulinRefRel` (intake → ketones, hour): insulin ÷ the overnight insulin of an insulin-sensitive reference adult on the
  same diet = 05's I with IR contained (R-KET). `insulinRel` stays for hormones but is now normalised by the person's own
  last-burn-in-day trough (dinner tail included; before: the basal term at 00:00, which put the overnight value at 1.2-1.3):
  hormones' SHBG proxy (`insMin`) now sits at 1.0 at baseline. `insulinBasalUuMl` is now written by intake.
- Readers no longer used by ketones (prune): `muscleGlycogenRel`, `muscleGlycogenG`, `insulinRel`, `insulinResistanceIdx`,
  `fedState`. Please also update the `insulinRel` description ("05 proxy I" → own-baseline insulin).

**B · core/compileSchedule:**
- MCT energy: `DayInput.energyKcal` / `HourInput.kcal` count MCT at 9 kcal/g (`ATWATER.fat·fatG`); intake's `eAbsKcalH`
  uses 8.3 (MODEL_SPEC §0.2, 05 §4.17), so a 30-g MCT day is 21 kcal lower in the engine than in the planned energy.
  Please count `mctG` at `ATWATER.mct` in both.
- Meal moving at fast boundaries: a FastEvent that starts at 00:00 of a maintenance day now puts the whole day's meals at
  00:00 (e.g. FastEvent(0, 0, 24): 2 634 kcal in hour 0 for Table A1's man) and a dinner-to-dinner 24-h fast puts all three
  next-day meals at 20:00. Physiologically that makes the "last meal" a feast (liver/muscle glycogen supercompensated,
  24-h BHB 0.81 instead of 0.50 after a normal dinner). Suggest dropping (not moving) meals that fall inside a fast of
  ≥ 24 h, or moving them only into the non-fasted part of the same day.

**Validation owner (A1) · register and fixtures** (A2 cannot edit `src/engine/validation/**`):
- Now passing, delete from `knownMisses.ts`: `05-V7…/h14`, `05-V9…/min`, `05-V9…/max`, `20-V8…/f48`,
  `20-4B3-fast-broken…/bhbHalves`, `07-3-etrf…/bhb18`; K row `05-V8…/lc12` is now passing (promote).
- New gating misses caused by the retune (please register, owner A2): `13-V15…/d1` 1.48 vs 1.06 ± 0.3 MJ/d (lower b_P and
  τ_L 20 h raise day-1 storage; d2/d3 already registered); `05-V4…/d3` 1.555 vs 2.23 ± 0.669 (0.006 outside);
  `05-V3…/tEx` 22 h vs 17.5 ± 3 (the exercise arm runs 45 min at 20:30 straight after dinner).
- Fixture issues (each makes a row measure something other than the study): V11 "fasted" arm keeps the 08:00 breakfast
  (fast events 0-8 and 9-15; truly fasted the engine peaks at 2.50 mM, inside 1.96-4.29); V12 compares 24-h means and
  spreads the MCT pro-rata into dinner (study: 2 × 19 g pure C8 at breakfast and 4 h later, ≈ 8-h day mean); V10 compares
  the BHB series with Féry's TKB numbers (engine TKB 0.18 → 0.34 → 0.81 vs 0.20 → 0.39 → 0.93 passes); V13 Burke eats
  100 % of 'current' maintenance without the 3 h/d of walking (≈ 1 000 kcal/d deficit; eucaloric → 1.28 mM vs 1.2 ± 0.36);
  fasting fixtures starting at t = 0 over maintenance programs now include the compiler's 00:00 feast (above: V8 m24/f24,
  20-4B3-24h/h24Bhb); O-3's oracle books protein oxidation at 4.7 kcal/g and TEE = TDEE0 while the engine's convention is
  4.0 kcal/g (MODEL_SPEC §0.2, §1.6 step 4) — the fat-oxidation rows (+5.6/+14/+60 %) are this convention difference (fuel's
  own rig passes O-3 within 1 %); 04 V3 reads 08:00 after a 20:00 dinner (≈ 5.6 unsuppressed hours) vs Taylor's 10.5-h
  window from 4 h after the meal; 04 V1 Acheson runs at habitual activity (EE_np 1 146 vs ≈ 705 kcal in 10 h, protein
  oxidation 0 vs 29 g) and the +408 g at 5 h is unreachable through intake's 60 g/h cap; 07-1 Rothman's meal is at noon
  after a 16-h fast (the study's was a dinner after a normal day).

**A1 · water:** the obese woman's early fast loses too little water (Table A3 day 1/3: scale −1.24/−2.84 vs −1.7/−3.4 kg,
DXA-lean −1.12/−2.34 vs −1.5/−2.8); tissue, glycogen and N rows match. Lean man day 1/2: −1.40/−2.50 vs −1.6/−2.7 kg (inside
±15 %; the remaining 0.2 kg is ECF). `fastZeroCarb` is not needed by A2.

**B · safety (W-05-KETO-FED):** after a fast BHB stays > 3 mM for 0 h (72-h fast), 1 h (7 d) or 2 h (21 d) after the first
meal (−40 % in the first hour, < 1 mM within 3-4 h). Ketones now keeps such hours in category 3 (decaying fasting
ketosis) when category 3 occurred in the last 24 h; the safety rule should use the same exemption.

## 2026-09-30 (late) — Integrator B → A1 (validation owner), fallout notes
- `core/compileSchedule.habitualWeek`: habitual cardio sessions are now 'other' at the §5.3 default intensity (0.625
  VO2max, what the Simulator's default cardio session compiles to) instead of 5.0 MET — with 5.0 MET a fit person's habitual
  training had MEM 0 (below 40 % VO2max), so VO2max/cardiometabolic states drifted when the same week continued. Energy's
  NEAT0 calibration absorbs the difference to the 5-MET EAT0 prior. B mirrored the change in
  `validation/fixtures/programs.ts` `habitualWeekSchedule` (one line + import; please keep it identical to habitualWeek, or
  import habitualWeek directly). With it, `composition/steadyState.test.ts` sedentary + cardio + diet-variant cells pass,
  and O-12 passes.
- Default sodium now follows the food (habitual density × E/TDEE0 when a template sets none; water-only days the habitual
  level). Promoted rows (now passing, entries deleted from `knownMisses.ts`): `11-proto-muller/bw`,
  `03-3-bray-2012-lean/leanNormal`, `07-8-buchinger-5d-20d/bw20`, `13-V9-vink-rate-of-loss/vlcd`,
  `15-V8-yang-water-fraction/waterShare`. New misses registered to B: `11-proto-sagayama/bw` (+1.36 vs 0.7 ± 0.18 kg) and
  `11-8-sagayama-return-to-baseline/bw3` (+1.33 vs 0.6-1.2) — the scenario's +1 500 kcal/d now carries +1.8 g/d sodium;
  if the study's added foods were low-sodium, set `hydration.sodiumG` in that scenario.
- W-01-FATFLOOR reads `fatFloorActive`; W-05-KETO-FED ignores hours with `fastActive` and the 24 h after a fast > T0.

## 2026-09-30 (night) — Integrator A2 → A1 (validation owner), B, orchestrator: VLC ketosis pass
- `insulinRefRel` (intake → ketones) is now dossier 05's own insulin proxy, I = IR·(I_b + 0.12·Ra_C + 0.04·Ra_P)·(1 − 0.3x), computed
  on the engine's absorption rates (was: 04 absolute insulin / its burn-in trough). Only ketones reads it; `insulinRel` (04) is unchanged.
- `eAbsKcalH` gains the reader `fuel` (burn-in recording for the equilibration replay in `endBurnIn`). Signal table updated.
- Fuel now re-equilibrates in `endBurnIn` (replays the last burn-in week 6× against energy's recalibrated TEE) and latches the habitual
  glycogen min/max; `glycogenLow`/`supercompensation` are edge-triggered against those (none at steady state). New param
  `fuel.glycogenLowHabFrac` 0.75.
- Intake: caffeine t½ × `moderators.caffeineSmokerMult` when `habits.smoker`; trajectory caches moved into state (snapshot-safe).
- Validation rows for the known-miss owner (A1), not edited by A2. Now passing: `05-V4-owen-balasse-prolonged-fast/d3` (1.59),
  `05-V5-hall2016-fasting-bhb/kd` (0.66), `13-V15-schrauwen-fat-balance/d1` (1.25). New misses: `20-V8-browning-bhb-24-48-72h/f48`
  (1.95 vs 1.22 ± 0.37) and Q `…/sexOrder` (−0.09, want > 0). Browning puts women below men at 48 h, while `05-V2-haymond-1982-sex/women`
  (1.12 vs 1.7) puts women above men at 30 h, so no shared parameter set can pass both; dossier ruling needed. `15-V8-yang-water-fraction/waterShare`
  48.0 % (band 50-70): the KD arm now loses more fat (`13-V2…/wKd` 326 g/d, was 288). Worse but still registered: `05-V13-burke-2021-lchf/bhb`
  3.64 (reg 2.71): the scenario's 100 % "current maintenance" leaves the 2 × 90 min walks unfunded. With intake = the training-day TEE,
  A2's rig gives 1.60. Please check whether `pctMaintenance` should include the scheduled exercise. `20-V8…/f24` 1.01 (reg 0.86).

## 2026-09-30 (late) — Engine finisher: requests resolved, and what is left for owners
Resolved (all additive; `pnpm exec tsc -b --noEmit` clean for the whole repo, no UI fallout):
- `SafetyTrace` docs follow the safety module's semantics; new optional fields `eee7`, `fastDay`, `ei28`.
- Readers pruned (37 entries across activity, wellbeing, muscle, hormones, appetite, cellular, cardiometabolic); new reads
  `appetite ← hoursSinceIntakeH` (fasting-hunger time course, R-FASTHUNGER) and `cardiometabolic ← tissueMassKg` (weight
  terms on tissue-mass loss). `checkWiring()`: no issues, nothing pending.
- MODEL_SPEC §4 rows for `muscleGlycogenExDefFrac`, `liverGlycogenMaxG`, `insulinRefRel` (table regenerated from `signals.ts`).
- `validation/fixtures/programs.ts` `habitualWeekSchedule` now builds on `core/compileSchedule.habitualWeekPrograms`, the
  same templates as `habitualWeek` (test: `core/__tests__/compileSchedule.test.ts`).
- `composition/steadyState.test.ts` habitual-lifter cells: `it.fails` → `it` (O-12 matrix 78 cells pass).
- Fixture problems 05 V10-V13, O-3 (engine mean TEE, 4.0 kcal/g protein), 04 V1/V3, 07-1 fixed; further scenario inputs
  corrected from the study reports (list in `docs/VALIDATION_REPORT.md`). `pctMaintenance` keeps its meaning (maintenance
  at habitual activity); studies that add training are fed with `atModelTee` (the engine's TEE on the study's schedule).
- Water: fasting natriuresis scales with body size (R-EFAST: E_fast* = −1.3 L × ECF0/17 L, ECF0 = 0.2·BW, 20 §4.5.2), so the
  obese woman's fasting ECF loss is no longer the lean man's 1.3 L; `kFast` and `fastZeroCarb` retired.
- Morning anchor (R-MORNING) implemented; O-5 checks the day-0 wake hour.

Left for module owners (registered in `validation/knownMisses.ts`, reasons in `KNOWN_MISSES.md`):
- **fuel** — consequences of ruling 18:10 (muscle glycogen held at c_ref on low-carbohydrate diets: Hall 2015 RC, 13 V1,
  13 V2, 15 V8, 13 V15 d2/d3, O-3 dG/fatOx); calibration candidates that change no other fuel row: `cLMax` 420 (07-1 g4/g15),
  `cMMax` 180 (04 V4 b72). The requested `rq24`-ready daily oxidation pair is still open.
- **ketones** — Haymond (05 V2) vs Browning (20 V8) sex order needs a dossier ruling; 05 §4.17 age/insulin-resistance term
  (Gipson, now mapped to the paper's 08:00 shake).
- **fasting** — labile-protein repletion (`tauRep`, `lMax`) vs the weekly-fast protein row (20 V9 Templeman).

## 2026-09-30 (final round) — Engine engineer → UI and planner engineers: contract additions (all additive, defaulted)
**R-MAINT** (MODEL_SPEC §5.2; `core/activityReference.ts`). "% of maintenance" resolves against the maintenance at the
schedule's PLANNED activity (habitual maintenance − habitual exercise energy + planned exercise and steps as the activity
module books them, phase/week-averaged, with the engine's compensation, TEF and AT rules), for every reference mode.
- `EnergySpec` pct: `activity?: 'planned' | 'habitual'` (default 'planned'; 'habitual' = % of the habitual intake).
- `DayInput`: `maintenanceKcal` (now the reference incl. the adjustment, set on EVERY day incl. kcal/zero days),
  `activityAdjKcal`, `activityDeltaKcal`, `plannedBalanceKcal` (= energyKcal − maintenanceKcal; < 0 deficit). Runtime
  ('current'/'blockStart') days are updated in place by the loop.
- `compileSchedule(schedule, profile, { activityReference?: boolean })` (default true).
- Series `inMaintRef` (kcal/d) and `inBalancePlanned` (kcal/d); `inEnergyPctMaint` is vs the R-MAINT reference.
- `maintenance` metric: energy that holds the current body at the scheduled activity on the habitual diet mix (falls with
  weight loss and AT; t = 0 = the static reference). `SeriesDef.description` filled for `maintenance`, `ketosisState`,
  `inEnergyPctMaint`, `inMaintRef`, `inBalancePlanned`.
- Exported helpers: `activity.activityConstants/sessionsBookedKcal/firstRtEndH/dayAerobicDose`,
  `muscle.trainingStatus0`, `core/activityReference.activityReference/activityRefConstants/baselineShift`.
**Planner fallout (planner-owned code, not edited):** `planner/domain/dayMath.ts`, `decode.ts`, `features.ts`,
`explain.ts`, `repair.ts` resolve % days against `rp.tdee0Kcal`; the engine now uses `DayInput.maintenanceKcal`. Take the
per-day reference from a `compileSchedule` of the decoded schedule (or call `activityReference`) so prescriptions, the
protein-floor repair (safety.fuzz saw 2.02 vs 2.11 g/kg because %E protein now resolves on a lower reference when the
plan drops the user's habitual session) and explanations match the simulated intake.
**UI:** label blocks with `DayInput.plannedBalanceKcal` / `inBalancePlanned` (deficit < −5 % of `maintenanceKcal` <
surplus, e.g.), show `maintenanceKcal` as "maintenance at this plan's activity"; `useScheduleModel.ts` still uses
`resolved.tdee0Kcal` as the maintenance for its % echo.
**Ketones:** the daily `ketosisState` is the wake-hour (morning fasting) category — the Preview's "ketosis N d" now counts
morning ketosis; hourly values unchanged.
**Safety (R-T4CAP, R-PLAN-SAFETY):** `SafetyTrace.fastH7Cap` (T1-T3 fasting hours; HC-F2 uses it), `SafetyTrace.
deficitPct28`; `SimulationResult.warningMargins?: WarningMargin[]` (`types/events.WarningMargin {id, severity, margin,
unit}`) with `RunOptions.constraints`, from `safety.computeWarningMargins` — one margin per caution/danger warning evaluated
on the trajectory, at least as strict as the rule (mapping in `model/safety/constraints.ts` and MODEL_SPEC §7.3). The
planner's own W-E07 window margin can be replaced by `warningMargins` 'W-E07' (EA ≥ 35 whenever EA applies).
