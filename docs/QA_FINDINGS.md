# Open findings after end-to-end QA (2026-09-30 21:05 IST) — next round's work list

## Rulings (orchestrator)
- **R-MAINT (energy % semantics).** "100 % of maintenance" must mean weight-stable **for the activity the schedule
  prescribes**, not for the user's habitual activity. Today the reference is habitual maintenance, so adding training
  silently creates a deficit: a 6-month "106 % surplus" with 4 lifts/week loses 0.8 kg and fires restriction warnings,
  planner plans are "deficit from added training", and more resistance-training volume yields less lean tissue at a
  fixed %. Fix: the maintenance reference used to resolve energy % = habitual maintenance − habitual exercise energy
  + planned exercise energy (net, averaged over the schedule's week/phase, after the engine's own compensation rule),
  for both `baseline` and `current` reference modes. The UI must show the resolved kcal and label blocks by their true
  balance (deficit / maintenance / surplus). Re-verify afterwards: lean-bulk scenario gains weight; RT volume
  dose-response is monotone; planner request "gain muscle, keep fat" returns plans with adequate RT volume.
- **R-T4CAP.** The 108 h / 7 d cumulative fasting cap applies to tiers T0-T3. A single expert-tier fast (72-168 h) is
  governed by its own tier rule (alone in its 28-day window, mandatory refeed days); engine safety and planner
  validator must agree.
- **R-PLAN-SAFETY.** Planner constraint margins must be at least as strict as the Simulator's caution-level warnings,
  so a plan the Planner calls "no flags" produces no caution/danger warnings when opened in the Simulator (keep a
  margin above the 30 kcal/kg FFM energy-availability floor instead of sitting on it).

## Engine (after the finisher hands back)
1. Implement R-MAINT in `core/compileSchedule.ts` / resolve path + spec §5; add tests (lean bulk gains; habitual
   lifter at 100 % stays stable; sedentary user adding cardio at 100 % stays stable).
2. Ketones, re-verify on the final tree (QA ran during recalibration): (a) starter scenario with 60-140 g/d net
   carbohydrate showed BHB > 0.5 mM most nights ("ketosis 51-81 d") — check against dossier 05's dose-response
   (soft threshold 50-100 g/d; deficit raises BHB ≈ 1.7×) and fix if the model over-reads; (b) a 72 h fast with a
   resistance session on a fast day reached 9.2 mM and was flagged "while eating" — bound exercise-driven boost in
   fasts (< 8 mM for every body; typical post-exercise rise +0.7 mM) and fix the fed/fasting categorisation.
3. Displayed maintenance rises in a deficit (+22 / +38 kcal/day) — find why (metric definition vs adaptation) and fix.
4. Warning copy/triggers: "Your deficit (734 kcal/day) is above about 734 kcal/day" (threshold equality + rounding);
   7-day-mean deficit warning labelled on a day at 100 %; "Gaining more is not advised" fires during a fast.
5. Finisher's open items, if any remain (see its hand-back): build red on `src/engine/validation/scenarios.test.ts:83`.

## Planner engine
6. Request (b) "gain 2 kg skeletal muscle, keep fat mass, 16 weeks" returns no plan ("no plan satisfied every safety
   limit"); with lean tissue it returns one plan mis-named "Maintenance with training" at 110 %. After R-MAINT.
7. Time-to-target search wrong: says −10 kg fat and +2 kg muscle are "not reached within 12 months at the safe limits".
8. Plans B and C never appear during a run: the progress throttle in `src/workers/planner*.ts` drops the single
   progress event that carries the alternatives (always deliver events carrying new options).
9. Prescription quality: training session overlapping a meal (18:00-19:13 vs 19:00 meal); meal times like 10:18
   (round to 15 min); a muscle-first plan opening with 2 deficit weeks; a strength goal given 5 sets/muscle/week plus
   3 × 75 min cardio; phase text not matching the phase ("used for LDL/ApoB goals" on an autophagy plan; "15-25 %
   deficit" when it is 11 %); "What moves goal 1 most" sentence has the wrong sign (UI currently hides it).
10. R-PLAN-SAFETY and R-T4CAP; plan quality swings between engine builds — add golden-plan regression tests for the
    three owner requests.

## UI
11. Explain drawer for blood ketones leads with a protein mechanism; no value-at-crosshair or "what drives it".
12. Settings › Safety still says "fasts up to 24 hours" after opting in to 72 h.
13. Imported safety answers lose the eating-questionnaire sub-answers.
14. Light-theme `ink-3` on chassis is 4.0:1 (needs ≥ 4.5:1) — adjust the token.
15. Simulator/results: label blocks by true balance once R-MAINT lands; PNG export; week scrubber (nice-to-have).

## Already fixed during QA (for the record)
Chart canvases 2-3× too wide on high-density screens; store registration when Settings opens first; focus after route
change; mobile overflow in planner days tab and simulator side panel; day view showing ketones/glycogen; insert-fast
duration (88 h instead of 72 h); gentle-mode starter; many copy fixes; evidence `howModelled` wording for topics
01/05/07/13/16; validation-report page at `/evidence/validation`; README rewritten.

# Release check 2026-10-01 00:40 IST — two blockers remain (rulings)
- **R-DETRAIN.** A habitual lifter whose schedule paints no lifts loses 3.9 kg lean in 8 weeks. Two fixes: (1) muscle
  detraining must follow dossier 09 §4.8: no measurable loss for 2-3 weeks after the last session, then exponential
  decay with τ ≈ 70 d **towards a retained floor, not to zero** — long-term lifters keep part of their trained
  muscle (myonuclear "muscle memory"; PROPOSED floor 50 % of trained gains, registry range 30-70 %, grade C), and
  the untrained/FFMI-derived set-point is never detrained; (2) the Simulator's programs and starter scenario default to
  the user's **habitual training** ("training as usual": sessions from the profile), with an explicit "no training"
  choice — so an ordinary schedule does not silently stop the user's lifting.
- **R-EA-PLANNER.** The planner's energy-availability floor is 30 kcal/kg FFM (dossier 17's threshold), applied with
  small headroom (≈ 31), not 35, and only on days with exercise, exactly as the Simulator's rule applies it; the 35
  figure is the "adequate" band, not a constraint. Fat-loss plans for non-athletes must reach dossier 17's rate caps
  (0.5-1 % BW/week) when the user's goals ask for it.
- **R-TTT.** Time-to-target must be consistent with the pre-run "reachable in this horizon" estimate: both computed by
  the same fastest-safe-rate search; never report absurd horizons (248 weeks) — cap at 104 weeks and say "more than
  two years at the safe rate" beyond that.
- Planner labels must be self-consistent (a "keep" goal at ±0.0 kg is "kept", not "not reachable"; titles and phase
  names show the same %).
- Minor: a day inside a fast must show as fasted in the day editor (no kcal/meals); inserting a "72 h" fast must not
  warn about "a 71 h fast" (rounding); intake/energy lanes must honour kJ; the keto-adaptation metric shown to users
  should be the slow (weeks) component or a labelled combined index, not the fast component alone.

# Ruling R-FAST-GATE (2026-10-01, engineering package E2 — PLAN 01 item 8 "Fasting is under-prescribed")
Behaviour change (the evidence-backed no-fast result for fat loss, insulin sensitivity and hunger is kept, but by the
search, not by a gate; the two safety bugs that removed every fast for people who train are fixed):
1. **Energy availability over non-fast days** (engine safety, `computeDay`). When a planned fast-event day (≥ 12 h of a
   planned zero-intake span longer than T0, or a graded-refeed day; MODEL_SPEC §7.2) lies in the trailing 7 days,
   `SafetyTrace.ea7` — HC-E4, W-E07/E08/E09/E20, the EA legs of W-E18/E19 and the planner's EA floor (R-EA-PLANNER reads
   the engine's W-E07 margin series) — is the mean daily EA (EI − EEE)/FFM of the **last seven non-fast days, searched back
   through the 28-day window**; on a fast-event day it is not evaluated (NaN); the EA persistence counters pause on fast
   days instead of restarting. Weeks without a fast keep the bus EA_7 bit for bit. New ParamDefs `safety.eaSampleMin`
   −5 / `safety.eaSampleMax` 70 kcal/kg FFM/d (grade C, the daily-sample clip of 19 §5 / §2, mirror of wellbeing's).
   Basis: ruling 18:10 already governs opted-in fast days by the fasting-tier rules and exempts them from the 7-day intake
   and deficit checks; the HC-E1 kcal floor still applies to min(EI_7 non-fast, EI_28), so fasting cannot dodge the energy
   floor, and a fast never hides low EA on the eating days (tested). Before, one zero day in a training week dragged the
   eating days' 32.8 kcal/kg FFM to a 28.1 weekly mean, W-E08 (danger) fired and the planner's floor removed the fast.
   Deviation from PLANNER_V2_SPEC §3.2 (N7 if ≥ 4 non-fast days, else N28): seven non-fast days keep the week's
   training/rest mix — after a 72-h fast and its refeed the calendar week holds 3-4 mostly-training eating days, which
   biased EA low.
2. **W-05-KETO-FED limited to its own text.** The danger rule ("ketones above 3.0 while eating are a warning sign in
   people with diabetes or on some diabetes drugs") applies to type 1 diabetes or any diabetes treatment incl. diet only
   (05 §9: the DKA criterion needs "known diabetes"; Umpierrez 2024 PMID 39052901, Kitabchi 2009 PMID 19564476) and to
   pregnancy/breastfeeding (lactation ketoacidosis, von Geijer 2015 PMID 26428083); for everyone else it does not fire —
   nutritional and post-fast ketosis keep bicarbonate ≥ 18 (05 §8 item 8). For people in scope the whole refeed phase
   after a fast > T0 counts only BHB > 6: `safety.ketoFedRefeedWindowH` 72 h from the first intake (grade D, PROPOSED:
   REE back to baseline ≈ 3 d after full refeeding, Dai 2024 PMID 39557965; 20 τ_N,off 3 d) plus every planned
   graded-refeed day (was 24 h); switch `safety.ketoFedNeedsDiabetes` (1). The planner's guard (`model.ts` margin 14)
   matches: not evaluated outside the scope, daily-mean proxies 2.5 / 5 mmol/L inside it. Scope note for PLANNER_V2_SPEC
   §3.3 (PROPOSED T1D/insulin/SU/SGLT2 only): confirmed broader per 05 §9; inside the planner the difference is moot (those
   profiles are blocked or limited to fasts ≤ 12 h).
3. **Gate** (`context.ts` `fastingGate`, PLANNER_V2_SPEC §3.1): fasting structures are offered when fasting is not refused,
   the effective longest fast is ≥ 24 h, a tier is held (the default 24-h tier counts; opt-ins only raise the ceiling), a
   goal fasting can serve exists (transient markers, fat loss as a deficit pattern, glycaemia, TG/BP, hunger/adherence;
   with "I prefer fasting" the top goal) and no muscle goal ranks above it. The "never with a muscle goal in the top two"
   rule (no dossier source) is gone. The 24-h overlay may sit in B0, B1, B2, B3, B6, B22 and B24 (was B1/B3/B6); surplus
   phases never fast; refeed days stay deficit-only.
   Guards so that a fast stays a delivery pattern, not a loophole (the 7-day cap, floor and EA are judged on non-fast
   days): planner margin `HC-E3.28` keeps the 28-day mean deficit, fast days included, within the deficit cap whenever a
   fast lies in the trailing 28 days (20 §4C "a delivery pattern of a small deficit"; without it weekly fasts were stacked
   on a 25 % deficit); multi-day events are no longer enumerated for plans made only of B11 phases (two low days a week
   leave no room for the span and its locked recovery — those skeletons decoded to no fast and filled golden d's
   shortlist); the best plan with a fast is offered to the final shortlist when safe and within the relaxed floors.
4. **Penalty as a true tie-breaker** (`optim/goals.ts` `finalKey`, `selectAlternatives`): plans are compared on the
   weighted goal score in steps of 0.01 first (`GOAL_SCORE_STEP`, PROPOSED), then on the complexity/hunger/time
   regulariser. Stage keys unchanged (PLANNER_V2_SPEC §4.3 quantised stage keys are E6's).
5. **Explanations** ("considered and rejected because …", PLANNER_V2_SPEC §3.6): an option without a fast carries a rival
   (`FastingVerdict.rival`) — option A's plan with fasts added at equal weekly energy when A has no fast, else the search's
   best plan with a fast — re-run in Simulator mode, validated and P90-checked, with the reason (validator, safetyMargin,
   chance, goalLoss, shortlist, alternative, noGoalGain) and its numbers; an option with a fast says what it buys.
6. **Preflight / request:** hints `fasting-short-longest` (opted into 48/72 h, longest fast below it),
   `fasting-muscle-above`, `fasting-no-goal` (replaces "muscle in your top two"); `expertMode` passes through
   `toSafetyInput` (only with a T4 opt-in and the app flag, which stays off).
7. **Not done (left for an engine follow-up, PLANNER_V2_SPEC §3.9):** hunger relief during multi-day fasts (dossier 20;
   dossiers 05 and 12 disagree on the ketone hunger factor) and a lower lean cost of 24-h fasts for overweight people.
Evidence from the runs (real engine, 2026-10-01; numbers are the model's):
- Autophagy first, T3, 2-4 training days (88-kg man, 12 weeks): before, no plan at all; now three safe options, each with
  two (or one) 24-hour fasts a week inside a very-low-carbohydrate phase (tier S and M). Without training: a 48-h fast
  plan (A, B) and weekly 24-h fasts (C). No option chose 72-h fasts.
- Fat loss first, T3 (78-kg woman): fasting offered, options keep no fast; the same plan with a weekly 24-h fast at equal
  weekly energy loses the same fat within 0.2 kg, 0.56 kg more lean tissue and +6 hunger points, and crosses the rate cap's
  headroom — stated in the explanation. Golden a (fat loss, muscle, autophagy; no opt-in) now keeps a weekly 24-h fast in
  option A (the autophagy index, goal 3, gains with fat loss unchanged and muscle within tolerance) and returns one option.
- Golden d: the fast-free very-low-carbohydrate cycles with a 6-h window win; the best plan with a fast reaches the
  shortlist but fails goal 1's relaxed floor across the ensemble. Ketosis first (T2, tier M): a ketogenic 25 % deficit
  alone gives a mean BHB ≈ 4.5 mmol/L, above every fasting plan, so no fast (tier S chose weekly 24-h fasts).
- Engine observation for QA item 2 (ketones over-read): ketogenic eating with two 24-h fasts a week reaches 6-7 mmol/L
  while eating and ≈ 3.5-4.5 mmol/L as a daily mean (nutritional ketosis is 0.5-3, 05 §4.7/§9). The scope fix stops this
  from blocking plans for people without diabetes; the calibration stays an engine item.
Tests: EA invariance and pause semantics (`safety/fastEa.test.ts`), keto-fed scope and the 72-h refeed phase
(`safety.rules.test.ts`), the gate truth table, overlay hosts, keto guard and fasting kinds
(`context.fastingGate.test.ts`), the goal-first comparator (`optim/goals.test.ts`), the regressions
(`fasting.autophagyFirst*.test.ts`, `fasting.ketosisFirst.test.ts`), preflight hints and `expertMode`
(`features/planner/__tests__/fastingPreflight.test.ts`). Two golden properties are not met and kept as `it.fails`
(reported, not loosened): golden d "≥ 1 option with a fast" (PLANNER_V2_SPEC §3.8.2) and golden a "≥ 2 distinct options".
Spec deviations (PLANNER_V2_SPEC §3, for the orchestrator): EA over the last seven non-fast days instead of N7 ≥ 4 / N28;
keto-fed scope broader (any diabetes treatment and lactation); the rival is option A's equal-energy twin first; reasons
`shortlist` and `alternative` added; `kind` / `longestFastH` optional in the type; ketosis-first test asserts the
explanation instead of a fast; the "longest fast follows the opted tier until set" default and the GoalsView handling of
the new `set-longest-fast` action need `features/planner/model.ts` / `GoalsView.tsx` (not E2 paths; the action currently
scrolls to the limits).
Final gate vs evidence graph (owner ruling 2026-10-01 22:40 IST, "fasts appear exactly when they help"; E6 successor):
the gate's served test is now `fastingServes` (`context.ts`) = the goal class is in `FASTING_SERVED` **or** the evidence
graph (`servesFasting`, `evidenceGraph.ts`) attaches a zero-intake mechanism whose sign credits the goal's direction
(sign 0, "either way", counts as credit). Offered is not used: the optimiser drops a fast that brings no gain. The muscle
rule and the safety/limit conditions are unchanged. Remaining differences are the gate-only pairs, recorded in the
coverage audit as known divergences (`KNOWN_FASTING_DIVERGENCES`, `audit/static.ts`); any other difference fails
`audit.static.test.ts` and `pnpm audit:planner`.

| Goal / direction | Gate before | Graph | Outcome | Reason |
|---|---|---|---|---|
| Lower LDL | not offered (lipids) | credit, either way | **offered** | rises during a fast, falls with the weight lost (sign 0, condition "weight loss") |
| Lower ApoB | not offered (lipids) | credit, either way | **offered** | as LDL |
| Raise endurance capacity | not offered (endurance) | credit, either way | **offered** | lighter body vs emptier glycogen (sign 0, condition "weight loss") |
| Lower total glycogen | not offered (endurance) | credit (fasts lower it) | **offered** | every zero-intake span lowers glycogen |
| Lower hunger | offered (comfort) | no credit | offered, known divergence | hunger rises during a fast; comfort class kept, a person may prefer eating this way |
| Raise adherence | offered (comfort) | no credit | offered, known divergence | every fast lowers modelled adherence; as hunger |
| Lower keto-induction symptoms | offered (comfort) | no credit | offered, known divergence | the index does not respond to fasts |
| Raise IGF-1 | offered (transient) | no credit | offered, known divergence | fasts only lower IGF-1; the class's other direction is served |
| Lower blood ketones | offered (transient) | no credit | offered, known divergence | fasts only raise ketones; the class's other direction is served |

Tests: `context.fastingGate.test.ts` (the four graph-credited goals are offered as goal 1; a muscle goal above still
blocks), `audit.static.test.ts` (the comparison equals the five known divergences, reasons leak-free). Open: the Goals
screen's preflight (`features/planner/preflight.ts`, own copy of `FASTING_SERVED`) still shows the "no goal gains from
fasting" hint for LDL / ApoB / endurance / glycogen goals; it should call the engine's `fastingServes`.
Check 4 (limits that change nothing): the limits form's default longest fast now follows the opted-in tier
(`defaultLongestFast`, T2 → 48 h, T3/T4 → 72 h), so the T2/T3 opt-ins are no longer hidden (audit: `masked: false` at the
tier's default); the expert tier stays unreachable through the form's largest option (72 h), reported.
Audit run (`pnpm audit:planner`, 2026-10-01, ≈ 5 min wall: static 89 s, liveness 75 s / 1495 runs, 31 planner runs in 6
parallel parts ≈ 300 s): fasting gate vs graph = the five known divergences, none unexpected; 19/21 levers reachable,
17/17 blocks; 1227/1444 tested mechanisms live; 6 dead fields (screening tier fields, training-profile loads / liked /
capacities); 6 rules flagged for review (`fasting.servedGoal`, `segments.durationFit`, `creatine.muscleGoal`,
`viscousFibre.lipidGoal`, `refeed.deficitOnly`, `fast24.hosts`; four come from one request, fat loss first for the 88-kg
man, whose tier-S baseline is beaten by every gate-off re-run, so single-seed search noise is the likely cause).

# v0.2 · QA pass 1 (2026-10-01)

Package Q1. The production build (`pnpm build` at `87a6b06` + the uncommitted E6 tree) was served with `vite preview`, which sends the same CSP and headers as netlify.toml. It was driven with playwright-core (new devDependency) on the system Chromium 153, at desktop 1280×800 and mobile 390×844, in four areas: first run and Body (ONB), Simulator, Planner and Evidence (SIM, PLN), Living mode (LIV), and Settings, Sync, PWA and data (SET). Fixes were re-verified on fresh builds of the current tree. Planner findings (PLN-*, and the planner parts of LIV-09, LIV-13 and SIM-03) are for E6 and were not touched. Screenshots are in `qa/screenshots/`; the ones cited by blockers and highs are committed.

**Counts (after de-duplication; SIM-01 = LIV-01):** 2 blocker · 16 high · 22 medium (incl. Q1-BUNDLE) · 20 low.
- **Fixed:** both blockers (LIV-01, SET-01).
- **Highs fixed:** 11 (ONB-01, SIM-02, SET-02, SET-03, SET-04, SET-05, LIV-02, LIV-03, LIV-04, LIV-05, LIV-06). SET-04 and LIV-06 are fixed in their own area; their other half is listed below.
- **Highs open:** 5. Planner (E6): PLN-01, SIM-03 (needs E6's v1-vs-v2 benchmark run first), LIV-09 (proposal command; the UI message is fixed). Non-planner, not reached in this pass: LIV-07 (Coach Undo after reload), LIV-08 (Start this plan from the Simulator).
- **Mediums and lows:** two fixed by the way (SIM-04, LIV-10) and one by the CSS fix (ONB-08). The rest are open.
- **Halves left open:** the Coach's one-cause connection error (SET-04b, medium) and the bus `today` rollover (LIV-06, E4).

**Guards.**
- `noInternalRefs.test.ts` and `internalRefsRendered.test.tsx` pass (44 tests).
- Browser text scans of every screen visited found 0 hits for dossier, §, R-XX ids and MODEL_SPEC.
- The built JS still carries "§" 11,290 times, "dossier" 1,596, "MODEL_SPEC" 428 and R-[A-Z]{2,} 268. All of these are in data or metadata fields (param notes and sources, safety `legacy`, metric `src`, planner `maintainerRef`), not screen copy. That is about 1 MB of maintainer notes shipped to clients.
- PLN-01 leaks field ids that are built at runtime, which neither guard catches.

**Bundle (SUITE_SPEC §9.5).**
- **Initial JS** (entry + modulepreload, gzip -9): **251,555 B**, against a budget of v0.1 + 60 KB ≈ 187 kB: about **+64 kB over**.
- **Biggest initial chunks (gzip):** index 102.0 kB, components 54.2 kB, safetyStore 19.0 kB, runtime 17.4 kB, body 8.5 kB, profileStore 8.1 kB, bus 8.0 kB.
- **Lazy (gzip):** engine.worker 394.8 kB, planner evaluator worker 312.5 kB, reach worker 301.2 kB, evidence 192.3 kB, Evolu Db.worker 122.7 kB, commands 121.1 kB, SimulatePage 63.1 kB, PlannerPage 59.5 kB, Evolu 50.2 kB, catalogues 30.9 kB.
- **Precache:** 204 entries, 10.8 MB.
- **Status:** open as a medium (Q1-BUNDLE). Candidates: the bus and tool manifest in the entry graph, the Coach runtime provider, and the figure code. The build also warns that dynamic imports of commands/defs/* are ineffective because they are imported statically too. **Update (B1):** fixed; see "v0.2 · B1 bundle budget" below.

**Not tested in this pass.** Web Bluetooth; the real install prompt; real AI provider keys and Sign in with ChatGPT; Tailscale/HTTPS relay; planner tier S (the UI exposes only M "Find plans" and X); mobile for the Living tabs; Progress with an imported biometrics file (scores, "vendor opinion" label); re-plan, pause and end paths and the planning banner; the training, food and devices intake chapters answered in full (only their skip paths ran; the Indian equipment items exist in the catalogue but were not ticked in the browser); keyboard through the whole intake (first turns only).

## First run, intake, Body (ONB)
### ONB-01 · high · Mobile: the last control on a page sits under the bottom tab bar ("Adjust the drawing" on Shape cannot be tapped)
- Steps: 390x844 touch. First run → screening → basics → shape (/body?setup=shape). Scroll to the bottom and tap "Adjust the drawing".
- Expected: the Frame control can be reached on mobile (body-figure-v2.md §3 mobile layout, §5.4; PLAN item 3).
- Actual: at full scroll the button is at y 810–842, under the fixed `nav.lm-tabbar` (y 785–849), which takes the tap. The main area has no bottom padding for the tab bar.
- Screenshot: qa/screenshots/onb-mob-shape-bottom.png
- Owner area: app shell (src/app/modeNav.css)
- Status: fixed by 9893122 (same root cause as LIV-01: preflight zeroed `.lm-main` padding-bottom). Re-verified: at 390 px the computed padding-bottom of `.lm-app .lm-main` is 0 px on the baseline and 88 px on the fixed build; the tap itself was not re-run.

### ONB-02 · medium · The Frame readout and aria-valuetext never change across the slider: 0, 0.05, 0.95 and 1 all read "shoulders clearly wider than hips" for an 88 kg body (body-figure-v2.md §5.4). Check `frameRatio` / `frameBin` cut-points in src/features/body/avatar/describe.ts. Owner area: src/features/body/avatar. Status: open
### ONB-03 · medium · Skipped chapters show "not answered yet" in "Your picture so far" and the summary, although plans use the defaults (onboarding-intake-v2.md §8, §6.6). The chapter receipts say "using … · asked later" correctly. Owner area: src/features/intake (summary.ts, IntakePage). Status: fixed in 7a9ac5f (Q1b)
### ONB-04 · medium · The "asked later" count attributes every deferred question to "Your body › A normal day" (17 or 28 questions, including training, food and devices); the design says "Body › Your setup" (§6.6). Owner area: src/features/intake/summary.ts. Status: fixed in 7a9ac5f (Q1b; wording only, count still shared)
### ONB-05 · low · The sport row's controls are named "what 1", "what minutes a week" before a sport is typed; light/moderate/hard keys have no row context (§9). Owner area: src/features/intake widgets. Status: fixed in 7a9ac5f (Q1b)
### ONB-06 · low · One visible `svg[role=img]` on the Body page has an empty name (body-figure-v2.md §8). Owner area: src/features/body. Status: not a bug (the figure is named through aria-labelledby; pass 1 read aria-label only); guard test added in 7a9ac5f
### ONB-07 · low · Training "3–4 times a week" counts as 4 sessions in the maintenance drivers (upper end; slight overestimate). Owner area: src/features/intake (activity mapping). Status: open
### ONB-08 · low · The figure/visceral toggle read "figurevisceral" with no gap. Cause: SIM-01 (CSS layer order). Status: fixed by 9893122 (re-verified by the sim agent on the shared bank component)

#### Not tested (onb)
Training chapter answered for real (willingness, equipment kit with mudgar/gada: the items exist in src/features/intake/chapters/training.ts, but the script could not drive the multi-select keys); Food and Devices chapters with real answers (only the skip paths ran); keyboard through the whole intake (first turns only); mobile intake past the first chapter; "Correct it" commit.

#### Passed (onb)
Desktop first run /welcome → screening (incl. eating-disorder follow-ups) → consent → basics → shape → activity, no console or page errors; activity A1–A10 with branching, receipts, "if you skip" lines and "(default)" keys; item 1: "about 2 890 kcal a day — likely 2 520–3 260" with a driver table, "Biggest unknown" and the calibration sentence; the "Correct it" sheet offers three paths; skip-everything path (toasts, receipts, wider band, summary → "Choose a start"); Body landmarks (one main, nav, a single h1, no unnamed visible controls); WebGL 3D canvas renders, and with WebGL disabled the SVG figure (front, side, ruler) renders with no errors; the Frame slider (label "frame", ends "hips-led / shoulders-led", "drawing only", "Match my basics") has no sex or gender words; the visceral waist slice announces the estimate, range, band and rings, with WebGL off too; keyboard: Tab, Enter/Space commit, arrows move focus, visible 2 px focus ring; screening radiogroups named and consent checkbox labelled.

## Simulator, Planner, Evidence (SIM, PLN)
### SIM-01 · (duplicate of LIV-01) · App-wide CSS layer order collapsed component padding (segmented controls read "1 mo2 3 4 6", "metricimperial")
- Steps: open /simulate or /body on the production build.
- Expected: components render as designed (layer order theme, base, components, utilities).
- Actual: modeNav.css loaded before index.css (src/main.tsx), so `components` became the lowest layer and Tailwind preflight `*{padding:0}` beat every component rule.
- Screenshot: qa/screenshots/sim-01-schedule-d.png (before), qa/screenshots/sim-03-visceral-d-fix.png (after)
- Owner area: src/main.tsx (shell)
- Status: fixed in 9893122 (re-verified in browser: yes)

### SIM-02 · high · Simulator warnings: "Show" and the remedy link were squeezed into the 20 px icon column
- Steps: Simulator → insert a 72 h fast, 40 % maintenance on all days, add resistance training → run → acknowledge → Warnings.
- Expected: a readable "Show" button and remedy ("Adjust energy on day 1") for each warning.
- Actual: `.rs-warn` grid auto-placed the actions row into the mark column; buttons read "Sho", "Adj".
- Screenshot: qa/screenshots/sim-03-visceral-d.png (before), qa/screenshots/sim-03-visceral-d-fix.png (after)
- Owner area: src/features/simulator/results/results.css
- Status: fixed in d51ab38 (re-verified in browser: yes)

### SIM-03 · high · The validation page never shows the planner benchmark numbers (PLAN item 17)
- Steps: /evidence/validation → "Planner benchmarks".
- Expected: "Report the numbers in the Evidence library's validation page."
- Actual: "The planner benchmarks are not published yet." The page loads /docs/validation/planner-benchmarks.json (PlannerBenchmarks schema, src/content/evidence/validation/plannerBenchmarks.ts). The harness (src/engine/planner/bench/runner.ts) writes docs/planner-benchmark.json and public/validation/planner-benchmark.json in another schema (PlannerBenchmarkSummary). The published file is only a sanity run of v1 against a copy of itself, so wiring it up now would show no v1-vs-v2 result.
- Fix: E6 publishes a v1-vs-v2 run. Then either the page loads /docs/planner-benchmark.json and renders PlannerBenchmarkSummary, or the harness also emits the page's schema; drop one of the two schemas.
- Screenshot: qa/screenshots/sim-12-validation-d.png
- Owner area: planner (E6) for the run; src/features/evidence (E15) for the loader
- Status: open (needs E6's run first)

### SIM-04 · medium · Parameter cards printed a bare unit "1": "0.005 1 (fraction of body mass)"
- Owner area: src/features/evidence/components/ParamCard.tsx
- Status: fixed in 1871ddd (re-verified: yes; unit test added)

### SIM-05 · low · Warning reference numbers are out of order ("references 54, 4", "2, 3, 1")
- Owner area: src/engine/model/safety/rules.ts or SourceRefLinks.tsx (sort). Status: open

### SIM-06 · low · The visceral readout at 100 cm² highlights "typical"; body-figure-v2.md §6.3 puts 100 in "raised" (a 99.x value is probably rounded for display)
- Owner area: src/features/body/figure3d (VisceralView). Status: open

### PLN-01 · high · The Ideal plan's "what it changes" shows internal field ids (constraints.trainingDaysPerWeek, constraints.maxSessionMin, constraints.eatingWindow, constraints.excludedLevers)
- Steps: Plan → autophagy signal + fat mass, T3 opted in → Find plans → Ideal card. The ids also appear on the days, curves, limits and safety tabs and in "Print day by day".
- Expected: PLAN item 5, no internal identifiers in user-facing text.
- Actual: "constraints.trainingDaysPerWeek 2-4 training days a week … → up to 6 …".
- Fix: src/features/planner/components/LimitCosts.tsx:66, render `${r.from} → ${r.to}` without `${r.field} `. The guard tests miss it because the text is built at runtime.
- Owner area: planner (E6). Status: open

### PLN-02 · medium · The text "Includes 10 fasts of 72 hours" contradicts the card's "72-hour water-only fast × 3"; the phase rows' "1 × 24-hour fast a week" is not counted in the fasting load
- Owner area: planner (E6), src/engine/planner/domain/fastingExplain.ts:222. Status: open

### PLN-03 · medium · The "scientific ceiling" Ideal plan scores below Hard (+23 vs +24 index; fat −5.0 kg at 40 % vs −5.3 kg at 80 %); on mobile the Hard label overlaps the ceiling line
- Owner area: planner (E6). Status: open

### PLN-04 · medium · The Ideal plan's "Maintenance break (2 weeks)" runs at −570 kcal a day
- Owner area: planner (E6). Status: open

### PLN-05 · medium · The effort line's "deficit 7 %" contradicts the phases' "Deficit 17 %/16 %" (Easy: 1 % vs 9 %/8 %)
- Owner area: planner (E6). Status: open

### PLN-06 · low · The Medium rung is usually left out ("a plan in between would buy little"); PLAN item 7 lists Hard/Medium/Easy. Owner area: planner (E6). Status: open
### PLN-07 · low · The table view shows a stray "row" header. Owner area: planner (E6), LadderTable.tsx. Status: open
### PLN-08 · low · "vs Hard +0.8 kg" on Easy's fat mass is ambiguous (Easy loses 0.8 kg less). Owner area: planner (E6). Status: open
### PLN-09 · low · Fat mass reads "−5.3 kg" on the card but "−5.56 kg" in the explanation. Owner area: planner (E6). Status: open

#### Bundle scan (sim)
In the built JS: "§" 11,290, "dossier" 1,596, "MODEL_SPEC" 428, R-[A-Z]{2,} 268, WP\d 0. Every hit is a data or metadata field (param notes and sources, safety `legacy`, metric `src`, planner `maintainerRef`, topic `dossier` keys); none is screen copy. Browser scans of every Simulator/Planner/Evidence screen visited: 0 hits. Risk: some param labels carry codes ("…; 17 §8"); about 1 MB of maintainer notes ships to clients. noInternalRefs.test.ts + internalRefsRendered.test.tsx: 44 tests pass; neither catches PLN-01.

#### Not tested (sim)
Tier S is not reachable from the UI ("Find plans" = M, 3,075 plans, 21–30 s; exhaustive X not run). Mobile print export. Touch crosshair drag.

#### Passed (sim)
Warnings sources "Safety limits › references 6, 7" with working #ref links; no forbidden text on Simulator/Planner/Evidence screens; visceral view (slice + cutaway, start ghost, 100/130 rings, legend) follows the crosshair and animates with Play on desktop and mobile; T3 opt-in → fasts up to 72 h, longest fast auto-raised; preflight hints; planner progress (H/M/E/I slots), runs 21–30 s; item 8: autophagy-first + T3 → three 72-h fasts per rung, fat-loss-first → no fast with "Why there is no fast"; no A/B/C names (cards, table, tabs, print, Simulator scenario "Hard plan · …", start sheet "Start Hard"); per-rung things to buy; Open in Simulator; six new evidence topics (22–27) render; parameter cards show both item-14 labels; validation page sections render; no console errors.

## Living mode (LIV)
Setup: quick first run, planner run (fat mass ↓ + lean keep, 8 weeks), "Start this plan" on Hard from the ladder (the Simulator has no start path, LIV-08). Fake OpenAI-compatible endpoint: a small local node server on 127.0.0.1:4190 that answers with a streamed `log_meal` tool call and then text.

### LIV-01 · blocker · Component styles lost to Tailwind preflight on every page (CSS layer order)
- Steps: load any page (e.g. /today) on the production build.
- Expected: keys, ticks, KeyBanks and faceplates styled (design/COMPONENTS.md; living-mode.md §4.1).
- Actual: src/app/shell/modeNav.css, imported through App before src/styles/index.css, declared `@layer components` first, so components ranked below base and preflight zeroed padding and borders. KeyBanks read "12345", tick boxes were invisible, the mobile main column lost its tab-bar clearance (ONB-01) and simulator keys ran together (SIM-01, ONB-08).
- Screenshot: qa/screenshots/liv-02-today-first.png (before), qa/screenshots/liv-04-today-fixedcss.png (after)
- Owner area: src/main.tsx / app shell
- Status: fixed in 9893122 (re-verified in browser: yes)

### LIV-02 · high · Ticking a meal "as planned" (Today) or "I ate this" (Food) failed with "Say what was eaten: components with grams or portions, or a text description." and logged nothing (living-mode.md §4.4 T0, §5.2)
- Screenshot: qa/screenshots/liv-03-today-tick.png
- Owner area: src/commands/food (log.meal)
- Status: fixed in 721b1f6 (re-verified in browser: yes)

### LIV-03 · high · The manual logger said "Lunch logged" when nothing was logged
- Steps: Food › I ate something else › "Or describe it": "2 rotis and 1 katori dal" › Log lunch.
- Expected: parsed and logged, or an honest "couldn't identify" (SUITE_SPEC §5.6).
- Actual: the sentence became one component name, the executor answered "ask", nothing was written, and the toast still said "Lunch logged"; typed kcal and protein were dropped.
- Owner area: src/features/living/food, src/features/living/data
- Status: fixed in 721b1f6 (re-verified in browser: yes)

### LIV-04 · high · The Coach ignored a configured custom endpoint ("The Coach needs an AI provider"): Settings stored the key under preset id 'custom', the runtime looked under 'custom-endpoint' (PLAN item 19)
- Owner area: src/ai/coach/runtime.ts
- Status: fixed in e2d1ed7, unit test added (re-verified in browser: yes)

### LIV-05 · high · Coach conversations were not saved: the store rejected "conversations/coach" and "messages/you-<uuid>" as invalid keys (SUITE_SPEC §5.4)
- Owner area: src/ai/coach (documentStore, MAIN_CONVERSATION)
- Status: fixed in e2d1ed7 (re-verified in browser: yes)

### LIV-06 · high · Coach logs landed on the calendar date, not the app's day (04:00 rollover): a lunch told at 00:30 went to Fri 2 Oct while Today showed Thu 1 Oct
- Owner area: src/ai/coach/executor.ts; root cause `today` in src/commands/bus.ts (E4), which also affects MCP
- Status: fixed for the Coach in e2d1ed7 (re-verified in browser: yes); the bus default fixed in ccbbba9 (Q1b)

### LIV-07 · high · Coach card Undo fails after a reload: "That card is no longer here." and the meal stays, although the card says "23 h to undo" (SUITE_SPEC §5.5; living-mode.md §7.2)
- Steps: have the Coach log a meal, reload /coach, press Undo on the card.
- Cause: card records live only in the executor's memory.
- Fix proposal: persist card records with the conversation, or undo through `log.retract` on the entry id.
- Owner area: src/ai/coach/executor.ts (E9b)
- Status: fixed in ba0ea61 (Q1b; re-verified in browser: yes, Undo after reload)

### LIV-08 · high · There is no "Start this plan" in the Simulator; plans can only be started from the planner ladder (PLAN item 6; SUITE_SPEC §6.3)
- Steps: open /simulate/<id>/schedule or /results.
- Note: `plan.start` already accepts `{ source: { scenarioId } }`; it needs a scenario variant of `StartPlanSheet` mounted in the Simulator.
- Owner area: src/features/simulator + src/features/living/start
- Status: fixed in bd3e05d (Q1b; re-verified in browser: yes)

### LIV-09 · high · "Use this swap on every Friday" told the user "Sent as a proposal for the plan." while no command ran (`plan.swapExercise` is a stub)
- Owner area: src/features/living/train (message); planner (E6) for the command
- Status: message made honest in b7876f8 (re-verified in browser: no, unit test); proposal fixed in 6fef189 (E5b: `plan.swapExercise` with `everyWeek` makes a proposed version and reports the weekly equivalence credit; unit tests, browser not re-run)

### LIV-10 · medium · A swapped exercise row lost its equivalence credit ("instead of push-up" only; living-mode.md §6.2–§6.3). Owner area: src/features/living/train. Status: fixed in b7876f8 (unit test; browser not re-run)
### LIV-11 · medium · Train swaps are not kept on reload; after "Session done" the summary lists the prescribed "Push-up" though the stored session has dand; week list says "lift · 50 min" vs 36 min in the session. Owner area: src/features/living/train. Status: fixed in 855d70a (Q1b; re-verified in browser: yes)
### LIV-12 · medium · A provider setup failure shows as the generic "needs an AI provider" state, and "Set up a provider" opens the top of /settings rather than the AI provider section (living-mode.md §7.5; /settings/coach now exists after SET-02). Owner area: src/features/living/coach, src/ai/coach. Status: fixed in ba0ea61 and dfdc64c (Q1b; unit tests)
### LIV-13 · medium · Food supplements with the food intake skipped: says "You chose food first" (nothing was chosen), shows the vegetarian B12 flag without a vegetarian answer, offers a "taken" tick for creatine 4 g from the plan without an opt-in, and "Connect an AI provider to get recipes." appears twice (living-mode.md §5.4). Owner area: src/features/living/food; creatine without opt-in → planner (E6). Status: open
### LIV-14 · medium · Sleep ticked "as planned" is labelled "7.5 h · measured" instead of "you · as planned". Owner area: src/features/living/today. Status: fixed in bdfd2f7 (Q1b; unit tests; the method is inferred from the value, see Q1b open items)
### LIV-15 · medium · Coach › "What the Coach knows" says "Nothing from the last 7 days yet." with today's steps, weight and meals logged (living-mode.md §7.4). Owner area: src/features/living/coach/briefing.ts. Status: fixed in ba0ea61 (Q1b; unit tests; but see Q1B-B-07)
### LIV-16 · low · /settings logs a 404 and ERR_CONNECTION_REFUSED from the Companion probe (same as SET-09). Status: fixed in 7a9ac5f (Q1b, with SET-09)
### LIV-17 · low · src/features/living/start/__tests__/startPlan.test.tsx fails between 00:00 and 04:00. Its TODAY uses the Living clock with the 04:00 rollover, but `plan.start` decides the status from the bus's calendar `today` (src/commands/bus.ts:273, `localDate(nowDate)`), so a start set for "tomorrow" is already 'active'. This is the same root cause as LIV-06, and it is real behaviour, not test flakiness: a plan started for "tomorrow" after midnight goes live at once. Fix: the bus derives `today` with the rollover (`currentDay` in src/commands/livingWiring.ts, kept out of the entry graph). Owner area: src/commands/bus.ts (E4). Status: fixed in ccbbba9 (Q1b; startPlan.test.tsx runs at 13:00 and 01:30)
### LIV-18 · low · The weight field empties after logging and "0 of the last 7 days logged" stays at 0 after logging today. Owner area: src/features/living/today. Status: fixed in bdfd2f7 (Q1b; unit tests)

#### Not tested (liv)
Mobile 390x844 for the Living tabs; Progress (biometrics import, scores, "vendor opinion" label, empty states; a generator for a canonical 14-day file was written but not run through the UI); re-plan, pause and end with confirmation; the "Plan active · back to Today" banner; how the replan/shift/declareEvent stubs present to the user.

#### Passed (liv)
Mode switch (rail: today · food · train · coach · progress, with evidence, planning and settings below); Today menu (both re-plan options, check in, pause, end…, plan details, planning tools); adherence shown as a breakdown table (item · share · counted); no streak wording on Today, Food, Train or Coach; steps, creatine, sleep and weigh-in logging with an Undo toast, and the forecast updates; with no provider, Food shows plain targets per slot, "Plan my day" is disabled with a reason, and no recipes are faked; manual food search ("dal" finds "Lentils, boiled"); Train swap sheet with credit meters and Indian alternatives (dand, kushti), "Counts as today's lift · 99 %"; Coach with no provider is honest and links to Settings and "log by hand"; Coach with the fake endpoint: streamed `log_meal` tool call, then text, an applied card with source, confidence, range, Edit and Undo, and the meal shows in Food; CSP connect-src allows http://127.0.0.1:*.

## Settings, Sync, PWA, data (SET)
### SET-01 · blocker · A device joining sync wrote its defaults over the synced data on every paired device
- Steps: device 1 pairs with the Companion relay, sets imperial units and a Sunday week start, syncs. A fresh device 2 joins with Merge; a fresh device 3 joins with "Replace with synced data".
- Expected: the synced data stands and nothing is dropped (SUITE_SPEC §2.6; settings-sync-ai.md §4.4).
- Actual: device 2 showed metric/Monday, device 3 metric/kcal, and device 3's defaults then synced back over devices 1 and 2. `attach()` in src/state/sync/controller.ts concluded "the owner has no data" after one `pull()`, but Evolu reports the round as done before the rows reach its snapshot.
- Fix: a joining device keeps pulling until the document count is quiet for 1 s (12 s at most); regression test for late rows under Replace and Merge.
- Screenshot: qa/screenshots/set-d2-joined-mobile.png (before)
- Owner area: src/state/sync (I1)
- Status: fixed in df244ad (re-verified in browser: yes; with three devices, every device ends imperial/Sunday and a kJ change made on device 2 reaches device 1)

### SET-02 · high · /settings/devices, /sync, /coach, /agents and /data-sources showed "Not found", including the "Add a device" links from Today and Progress
- Expected: SUITE_SPEC §6.2; settings-sync-ai.md §2–§3.
- Fix: a `settings/:section` route that scrolls to the section and resolves aliases; test in navPort.test.ts.
- Owner area: src/features/settings, src/app/routes.tsx
- Status: fixed in 8ba3222 (re-verified in browser: yes)

### SET-03 · high · Sync created a key and showed the 24 words for a server that was not running; there was no Test step
- Steps: Settings › Sync, address http://127.0.0.1:4199 (nothing listening) → "Set up sync on this device".
- Expected: test before create, with the failure copy (settings-sync-ai.md §4.2, §12).
- Actual: 24 words shown, status "offline · 6 changes waiting".
- Fix: relayTest.ts checks /health for the relay role (it grants the origin, and revokes it if the check fails); a Test button; Set up runs the same check first.
- Screenshot: qa/screenshots/set-pair-unreachable.png (before), qa/screenshots/set-sync-test-mobile.png (after)
- Owner area: src/features/settings/sync
- Status: fixed in b9513fb (re-verified in browser: yes)

### SET-04 · high · AI provider test against an unreachable endpoint blamed CORS ("your server doesn't accept requests from a web page"), in lower case
- Expected: an honest error (settings-sync-ai.md §5.4, §5.8).
- Fix (Settings): the message names both possible causes, gives a fix for each preset (Ollama/LM Studio/vLLM), and shows offline copy when offline.
- Still open: the Coach shows the same one-cause wording at src/features/living/coach/copy.ts:30 and src/ai/coach/adapter.ts:44.
- Owner area: src/features/settings/ai; Coach copy → living/ai
- Status: fixed in 1205b10 for Settings (re-verified: yes); Coach copy open (medium, see SET-04b)

### SET-05 · high · With sync on, "Your data" and About › privacy still said "Stored on this device only. Nothing is sent to a server."
- Expected: the sync-on wording (settings-sync-ai.md §9). Owner area: src/features/settings
- Status: fixed in 3c3f84b (re-verified in browser: yes)

### SET-04b · medium · The Coach's connection error still names a single cause (CORS) for an unreachable endpoint (src/features/living/coach/copy.ts:30, src/ai/coach/adapter.ts:44). Owner area: living/ai. Status: fixed in ba0ea61 (Q1b; unit tests)
### SET-06 · medium · With sync on, Install copy still says "Your data stays on this device either way", and the "Changes made offline sync when you're back online" line is missing (design §7). Owner area: src/app/pwa/InstallSection.tsx. Status: fixed in 7a9ac5f (Q1b)
### SET-07 · medium · The sync key panel is missing the 10-s countdown announcement, "Keep showing key", pause-on-focus and "Print a paper copy" (design §4.3); it has only a fixed 60-s auto-hide. Owner area: src/features/settings/sync/PairingCodePanel.tsx. Status: open
### SET-08 · medium · The sync-on view is missing the devices list and rename, the "Lost a device?" revoke/rotate panel, the typed "turn off" confirmation and the permanent data-loss sentence (design §4.5). Owner area: src/features/settings/sync (I1). Status: open
### SET-09 · medium · Opening Settings probes the Companion automatically (GET <origin>/health 404, GET 127.0.0.1:4870/health refused, so two console errors; on the public site this triggers Chrome's local-network prompt before any explanation) (design §4.6). Owner area: src/features/settings/agents (E12). Status: fixed in 7a9ac5f (Q1b; probe only on “Look for the Companion” or when already paired)
### SET-10 · medium · Settings sync is last-writer-wins per document, not per field (SUITE_SPEC §2.3), because the Evolu adapter stores one JSON value per document. Found by reading the code; not reproduced on its own. Owner area: src/sync/evolu (I1). Status: open
### SET-11 · medium · QR join opens the live camera (getUserMedia; header camera=(self)), while the design and spec say photo picker with camera=() (design §4.4; SUITE_SPEC §9.1). Needs a decision on which side changes. Owner area: src/features/settings/sync + headers. Status: open
### SET-12 · low · Devices comes before Sync in Settings (design §3 orders Sync first). Status: fixed in 7a9ac5f (Q1b)
### SET-13 · low · A disabled "Sync now" shows while sync is off (design §4.1). Status: fixed in 7a9ac5f (Q1b)
### SET-14 · low · About, export files and the Companion report "0.1.0" in the v0.2 build (package.json version). Owner area: release. Status: open
### SET-15 · low · Devices: "last data 2026-03-10" ignores the date-style setting; the import toast appears twice. Status: fixed in 7a9ac5f (Q1b; duplicate toast not reproduced, toast given one id)
### SET-16 · low · The capability check has no "Skip — assume from the provider's list" (design §5.3). Status: open
### SET-17 · low · An import after "Reset everything" defaults to Merge and duplicates the starter scenario ("Moderate deficit (imported)"). Status: fixed in 7a9ac5f by unit test (Q1b), but the Q1b browser round trip still defaulted to Merge (Q1B-A-01); open until re-verified on a fresh build
### SET-18 · low · Chromium warns "Unrecognized feature: 'bluetooth'" on every page (from the Permissions-Policy in the spec). Status: open

#### Not tested (set)
Web Bluetooth and the real install prompt (headless); a real AI provider key; simultaneous-edit conflicts.

#### Passed (set)
Settings reachable before intake, no overflow or page errors on desktop and mobile; 18 AI presets with honest notes for the Companion and Sign in with ChatGPT; custom endpoint fields; the saved API key appears nowhere in DOM text, input values, HTML, local/session storage, IndexedDB (stored encrypted) or the console, is shown only as "ends …5b4a", and is sent only to the configured base URL; pairing with the real relay (24 numbered words, QR, Hide gated on "I've saved the words", status shows time and host); two-way sync after Sync now (with SET-01 fixed); production CSP allows http/ws 127.0.0.1; Stop syncing confirms and keeps data; Devices CSV import creates sources, Coach access hidden by default, policies persist, vendor scores off by default, honest Bluetooth copy; manifest icons 192/512/maskable/180 apple-touch; service worker controls the page (204 precached); offline reload of Settings/Body/Simulate/Plan/Evidence/validation works; Install section shows "ready on this device"; export v2 has no keys/secrets/ledger/sync state; erase needs "reset", clears vitals.* storage and the AI key, and returns to /welcome; the export → erase → import round trip restores profile, goals and settings on desktop and mobile.

## Cross-area
### Q1-BUNDLE · medium · Initial JS is 251.6 kB gzip, against the §9.5 budget of about 187 kB (v0.1 + 60 kB); see the numbers above. Owner area: app shell / commands (I1). Status: fixed by B1. Initial JS is now 201.5 kB and JS+CSS 218.6 kB, inside the budget. The 187 kB figure was wrong: v0.1's own initial JS is 150.8 kB, so the budget is 210.8 kB. The routes' first-paint totals are still above v0.1 + 60 kB; see "v0.2 · B1 bundle budget".

# v0.2 · QA fix round 1b (2026-10-02)
Package Q1b. The E6 planner job was still live throughout (no docs/wp/E6.md), so no planner path was edited and the planner findings "for E6" stay with E6. Browser checks used playwright-core with the system Chromium against production builds served by `vite preview` (same CSP and headers as netlify.toml), as in pass 1. Scripts are in qa/scripts/q1b/ (qa-a: intake, devices, export round trip, PWA; qa-b: Progress import, Train, Food recipes, Coach Undo, Simulator start) and fixtures in qa/fixtures/q1b*/. Note: /tmp on the build machine was full (other projects), so runs used TMPDIR=.tmp-q1b.

**Counts.** Pass-1 findings fixed in this round: 21 (2 high, 11 medium, 8 low; listed below, statuses updated in place above). New findings: 16 (5 high, 4 medium, 7 low; Q1B-B-10 bundles four small items), of which 7 are fixed (5 high, 1 medium, 1 low).

## Fixed (commit)
- **App day (root of LIV-06, LIV-17).** `ccbbba9`: one helper, src/living/appDay.ts (04:00 rollover, read from the wall clock so DST does not move it; `rolloverOf(settings)`). The bus's `ctx.today`, living upkeep (`currentDay`), the Living clock (`clockToday`, used by Today, logging, the start sheet and the mode nav) and the Coach use it. Tests at 00:30, 03:59, 04:00, month and year edges and Berlin DST, the bus at 01:00 and 03:59, and startPlan.test.tsx at 13:00 and 01:30 on a faked clock ("start tomorrow" stays scheduled; it fails again if the bus goes back to the calendar date).
- **LIV-07** (high) `ba0ea61`: Coach cards store their command, undo (`log.retract {entryId}` or change id), proposal and actor with the conversation. Undo after a reload goes through the bus; past 24 h the card says so and offers none. Browser: pass.
- **LIV-08** (high) `bd3e05d`: "Start this plan" in the Simulator (desktop top bar on schedule and results; mobile results bar), loading the start sheet's scenario variant on demand. It starts `{ source: { scenarioId } }`, so the rung is `custom`, and replacing a running plan needs the typed word. Browser: pass.
- **LIV-11** `855d70a`; **LIV-12** `ba0ea61` + `dfdc64c`; **LIV-14**, **LIV-18** `bdfd2f7`; **LIV-15**, **SET-04b** `ba0ea61`; **LIV-16**/**SET-09**, **SET-06**, **SET-12**, **SET-13**, **SET-15**, **SET-17** (unit only, see Q1B-A-01), **ONB-03**, **ONB-04**, **ONB-05** `7a9ac5f`; **ONB-06** is not a bug (a guard test was added).
- **log.fromBiometrics** `9662746`: for an app day, steps, the main sleep (on the app day it ends in) and workouts from streams with "my plan" switched on in Settings › Devices become log entries with `source.by: 'device'`. It is idempotent per day and stream (per record for workouts), never overrides the user's own entry (reported as skipped: userEntry), and can be undone with `log.retract`. Retracting an entry that replaced another now restores the original (`effectiveEntries`). Parity snapshot regenerated with `pnpm vitest run src/commands/__tests__/parity.test.ts -u` (only log_from_biometrics loses "stub" in the four surfaces, plus the toolset hashes); docs/COMMANDS.md regenerated (141 implemented, 5 stubs, all planner).
- **New-finding fixes:** Q1B-B-03 `67a3fdc`, Q1B-B-05 `7524043`, Q1B-B-04 `25c1e17`, Q1B-B-02 `2b850f7` + `c6fb8b7`, Q1B-B-01 `8027738`, Q1B-B-10 `{vendor}` part `7a25e8f`, Q1B-B-09 `49088fa` (each has a unit or component test; not re-run in the browser).
- **Test fix:** `9af41cc`. AiSection's spending-cap test stamped usage with the real clock but rendered with a fixed clock (1 Oct 09:00 UTC), so it failed whenever the real time was later.

## Newly tested in the browser
- **Pass.**
  - Training chapter answered for real: willingness, where, days, the "Indian traditional set" preset (mudgar, mudgar pair, gada) plus Indian clubs and dumbbells, weights, time, injuries (knee, low back), conditions. Receipts, summary, the summary after reload, and the export carry the answers, on desktop and mobile.
  - Food and kitchen chapter: the B12 flag shows only for a vegetarian answer.
  - PWA:
    - The manifest's fields and icons (192, 512, maskable, SVG) check out.
    - The service worker is active and controlling with 199 precache entries.
    - A synthetic `beforeinstallprompt` gives an Install key, then `prompt()`, then "installed".
    - Offline reload of /, /settings, /settings/devices, /evidence, /evidence/supplements and not-found works.
  - Train swap: the sheet and the row show the equivalence credit, the swap survives reload, "Session done" lists the swapped exercise, and the week minutes match.
  - Food recipe slots with a fake provider answering food.planDay:
    - The no-provider, loading, recipe and error states all show.
    - Claimed nutrients (9999 kcal, 1 g protein) were replaced by table-verified numbers (709 kcal, 131 g).
    - "I ate this" lands on the app day (a log at 01:30 went to the previous day).
  - Coach Undo after reload (LIV-07).
  - Simulator "Start this plan" with the replace confirmation (LIV-08).
  - Progress empty states and grade/version/device tier on tiles after import.
- **Partial.**
  - Devices chapter: answers persist, but Settings › Devices ignores them (Q1B-A-02).
  - Export v2 → Reset everything → import: settings, profile, intake, goals and bioSources come back identical apart from document metadata. `safety.pendingReview` turns on, which is expected (answers apply after you check them). The starter scenario is duplicated (Q1B-A-01).
  - Keyboard: the training chapter only, as far as the kit.
- **Failed then fixed (unit-tested, browser re-run pending):** the vendor-opinion labelling, sleep and resting heart rate after import (mostly a bug in the QA generator), the dossier text, body signals with stale data, and the "I ate this" totals.

## New findings
### Q1B-B-01 · high · Imported vendor readiness/sleep/stress never shown, no "vendor opinion" label. Owner: src/features/living/scores. Status: fixed in 8027738 (shown only with the vendor switch on, which is off by default; the policy default in personMatrix disagrees and should be aligned)
### Q1B-B-02 · high · After importing the 14-day file, sleep read 25 min and resting HR "have 7". Cause: the QA generator added seconds to milliseconds, so every night was 35 min long; the app read the file correctly. Status: fixed in 2b850f7 (the import now warns when asleep time exceeds the night) and c6fb8b7 (generator); browser re-run with the corrected file pending
### Q1B-B-03 · high · Progress score detail showed "dossier 16 d_t", "dossier 19 RHR_fit". Status: fixed in 67a3fdc (guard extended to every catalogue score's detail)
### Q1B-B-04 · high · Progress showed "No body signals yet" when the latest data was 2 days old. Status: fixed in 25c1e17 ("last data 30 Sep · 2 days old")
### Q1B-B-05 · high · "I ate this" on an accepted recipe logged the slot target (754 kcal, 52 g) instead of the recipe (709 kcal, 131 g). Status: fixed in 7524043
### Q1B-A-01 · medium · Export → Reset everything → import with the default Merge duplicates the starter scenario. The SET-17 unit fix in 7a9ac5f did not show in this run; it may have used a build from before that commit, or Reset may leave data that is not counted as starter. Owner: src/state import. Status: open
### Q1B-A-02 · medium · Settings › Devices says "No devices yet" after the intake chose a ring, a smart scale and 8 streams. Owner: src/features/settings/devices. Status: open
### Q1B-B-06 · medium · Recipe portions print the quantity twice ("1¾ 1 breast Chicken breast…"), and the "closest" fit text shows day-level gaps on every slot ("energy 1144 kcal under" on a 754 kcal meal). Owner: src/ai/coach/recipes.ts. Status: open
### Q1B-B-07 · medium · The Coach opens with "No plan is running" and "Nothing from the last 7 days" in its briefing until the first message, even when a plan is running. Owner: src/features/living/coach. Status: open
### Q1B-B-08 · medium · Today shows "Lift · 45 min" while Train shows 29 min for the same session. Owner: living today/train. Status: open
### Q1B-B-09 · medium · A Simulator scenario with 0 lifts started as "training on mon…sun". Status: fixed in 49088fa
### Q1B-B-10 · low · Several small issues:
- The swap sheet has no dialog role.
- A slot error shows the provider's raw text.
- The vendor help showed a literal "{vendor}" (fixed in 7a25e8f; the copy guard now catches unfilled placeholders).
- The Coach date separator uses the calendar date, not the app day.
- Food reads "eaten nothing logged yet of…".

Status: open except {vendor}
### Q1B-A-03 · low · The "which smart scale" model list is the ring/watch brand list. Owner: src/features/intake devices. Status: open
### Q1B-A-04 · low · Enter does not commit "Which days can you use them?", unlike "Where". Owner: src/features/intake. Status: open
### Q1B-A-05 · low · The days-a-week stepper starts blank although skipping means 3 × 30; the first + gives 1. Owner: src/features/intake. Status: open
### Q1B-A-06 · low · Page loads (not only /settings) log GET /health 404 and 127.0.0.1:4870 refused with no Companion running. This was seen after the SET-09 fix, so there is another automatic probe (sync or companion status). Owner: src/state/sync or the companion client. Status: open

## Still open, and why
- **Planner (E6 live, not touched):**
  - PLN-01…09 and SIM-03.
  - LIV-09's proposal command.
  - LIV-13's creatine without opt-in.
- **Need a decision:**
  - ONB-02: the drawn shoulder-to-hip ratio moves only about 0.085 across the whole Frame slider, so no cut-points can fix it. The words should either be relative to the body, or the slider should change the drawing more.
  - SET-11: photo picker or live camera.
  - SET-14: the v0.2 version number is set at release (docs/RELEASING.md).
  - SET-16: what the Coach assumes when the capability check is skipped.
- **Larger work:**
  - SET-07: the sync key panel's countdown, keep-showing, pause and print.
  - SET-08: the sync-on devices list, revoke/rotate and typed turn-off.
  - SET-10: per-field sync merge (I1).
  - Q1-BUNDLE: initial JS is 250,857 B gzip (26 files), down from 251,555 B in pass 1 but still about 64 kB over the §9.5 budget. **Update (B1):** fixed. Initial JS is 201.5 kB; see the B1 section.
- **Gaps left by this round's fixes:**
  - LIV-14: the "as planned" method is inferred from the value. Recording it needs a field on log.sleep/log.steps and in src/living/types.ts.
  - `settings.dayRolloverH` is read but not yet in the settings model, and src/living/projection.ts keeps its own `?? 4`.
  - LIV-11: sessions logged before 855d70a, or on another device, still list the prescribed exercise.
  - A Coach card that expires while the page stays open loses Undo without the note until a reload.
  - SET-18 and the remaining lows from pass 1.
- **Not tested:** Web Bluetooth and the real install prompt (headless); real AI provider keys; tier S planner; keyboard through the food and devices chapters; the recipe, swap and Coach flows on mobile; a browser re-run of the seven new-finding fixes and of the corrected biometrics file.

## Gate (2026-10-02, after the fixes; E6 still live, so planner tests excluded)
```
$ pnpm typecheck   →  tsc -b --noEmit   exit 0
$ pnpm lint        →  eslint .          exit 0
$ pnpm build       →  … files generated dist/sw.js, dist/workbox-398fc23b.js   exit 0
$ pnpm vitest run --exclude 'src/engine/planner/**' --exclude 'src/features/planner/**' --exclude '**/node_modules/**'
 Test Files  6 failed | 345 passed (351)
      Tests  6 failed | 4633 passed | 185 expected fail | 1 skipped (4825)
   Duration  74.02s
```
The six failures, each rerun alone:
- src/engine/model/ketones/ketones.test.ts: 30 passed | 1 expected fail. Load-sensitive.
- src/engine/model/water/water.bench.fastbus.test.ts: 1 passed. Load-sensitive.
- src/engine/model/safety/safety.props.test.ts: 25 passed. Load-sensitive.
- src/engine/model/intake/__tests__/bench.test.ts: 1 passed. Load-sensitive.
- src/features/evidence/__tests__/page.test.tsx: 7 passed. Timing-sensitive.
- src/features/settings/ai/__tests__/AiSection.test.tsx: 1 failed | 8 passed. This was a real clock bug in the test; it passes 9/9 after 9af41cc.

# v0.2 · B1 bundle budget (2026-10-02)
Package B1 (Q1-BUNDLE). The E6 planner job was still running, so no planner path was edited. Numbers come from `node qa/scripts/bundle-report.mjs`. The script runs `vite build --manifest` into .tmp-bundle/dist and sums gzip -9 sizes (kB = 1000 B). **Shell** means what index.html loads: the entry, its modulepreloads and the stylesheet. Each route adds the static import closure of the lazy page it renders before first paint. Chunks loaded after first paint are not counted: the registry load in state/persistence.ts, the sync check, workers and Evolu. The v0.1 column is the `v0.1.0` tag built with the same script; v0.1 has no Living mode.

**Before first paint, gzip -9, kB.**
| Route | v0.1.0 JS / CSS / total | before B1 JS / CSS / total | after B1 JS / CSS / total |
|---|---|---|---|
| shell (index.html) | 150.8 / 16.6 / 167.4 | 251.7 / 17.1 / 268.8 | **201.5 / 17.1 / 218.6** |
| / first run → /welcome | 184.3 / 21.4 / 205.7 | 722.6 / 21.9 / 744.6 | **252.1 / 21.9 / 274.1** |
| /body | 206.7 / 23.3 / 230.0 | 747.7 / 28.7 / 776.4 | **304.2 / 28.7 / 332.9** |
| /simulate | 586.1 / 39.4 / 625.5 | 892.6 / 44.5 / 937.1 | 856.1 / 44.5 / 900.6 |
| /plan | 562.1 / 37.6 / 599.7 | 881.1 / 45.0 / 926.2 | 846.9 / 45.0 / 891.9 |
| / active plan → /today | n/a | 764.9 / 28.0 / 793.0 | 685.3 / 28.0 / 713.3 |

**Budget (SUITE_SPEC §9.5: initial JS ≤ v0.1 + 60 kB gz).**
- v0.1's measured initial JS is 150.8 kB, so the budget is ≤ 210.8 kB. The brief's figure, v0.1 initial ≈ 164.7 kB, gives ≤ 224.7 kB.
- The shell is now 201.5 kB JS and 218.6 kB JS+CSS. It meets both readings.
- **Q1-BUNDLE is fixed.**

**What changed.** No behaviour changed.
- **Barrel imports in the entry graph.**
  - The app shell, the PWA update notice, the save notice and two Living helpers now import from `@/components/<Module>`, not from the `@/components` barrel. Before, the barrel put every design-system primitive (NumberField, ScaleSlider, Select, …) in the initial chunk.
  - The body store and `resolveProfile` import from `@/engine/body/estimateBody` and `@/engine/body/sliders`, not from the package index.
  - `frameForSex` moved to src/engine/body/frame.ts. It is re-exported from avatar.ts and from the index, so the avatar maths stays out of the shell.
- **App-root contexts.** `CoachAdapterContext` and `RecipeProviderContext` now live in their own tiny modules (coach/adapterContext.ts, food/recipeContext.ts). `CoachRuntimeProvider` no longer loads the Coach briefing, the Living data source, the Food copy or the mock dishes at boot. The recipe context now defaults to null and `useRecipeProvider()` falls back to `noRecipeProvider`, so the result is the same as before.
- **Live scores provider.** It is now a lazy component in src/features/living/routes.tsx. The shell's Suspense shows the page fallback while it loads. A first-run user no longer downloads the biometrics document index.
- **Onboarding copy.** The safety gate and the safety store need the acknowledgement versions and `MODE_LABEL` before first paint. These moved to src/features/onboarding/copyEarly.ts and are re-exported from copy.ts, so copy.ts stays the one place reviewers read. The rest of the copy, about 40 kB raw, left the shell.
- **The full command registry is no longer on the first-paint path for /welcome and /body.**
  - The first-run, Body and safety dialogs dispatch only `safety.*`, `profile.*` and `settings.update`. Their stores already register those definitions.
  - These screens now import `dispatch` from `@/commands/bus` plus the matching `@/commands/defs/*`. That is the same pattern the stores use.
  - The full registry (engine core, catalogues, Living executors) still loads for every user right after first paint, from state/persistence.ts. Commands that agents and the Coach use are therefore still registered as before.
- **Engine barrel.** src/living/calendar.ts, src/living/prescription.ts and src/features/simulator/lib/training.ts import `compileSchedule`, `habitualWeekPrograms` and `resolveProfile` from their modules. They no longer import `@/engine`, which loads every model module and the planner domain. This took the planner domain out of the registry chunk.
- **Catalogues are lazy (§9.5).**
  - `log.session` loads the seed exercise catalogue on first use.
  - The food table and the supplement line import their own data files, not the content index. The index builds the whole seed catalogue at import time.
  - `intake.nextQuestions` loads the intake question sets on first use. This also removed four of the six INEFFECTIVE_DYNAMIC_IMPORT warnings. The two left are the intended `late.ts` waits.
- **Other checks.**
  - No duplicate dependencies: every package resolves to a single version.
  - Shell CSS is 17.1 kB, against 16.6 kB in v0.1, so it was left alone.
  - Precache: 225 entries, 10.9 MB. Every non-Evolu JS and CSS file in dist/assets is in sw.js (checked), and no file is over the size limit.
- **Tooling.** qa/scripts/bundle-report.mjs (`--no-build`, `--out <dir>`, `--json`). .tmp-bundle/ is git- and eslint-ignored.

**Remaining gap (routes, not the §9.5 metric).**
- Against v0.1 + 60 kB per route:
  - /welcome is +8.4 kB (274.1 vs 265.7).
  - /body is +43 kB (332.9 vs 290.0).
  - /simulate is +215 kB (900.6 vs 685.5).
  - /plan is +232 kB (891.9 vs 659.7).
  - /today has no v0.1 baseline.
- The Living screens import the registry for their data source (`readLivingDocs`) and actions. Today also renders `projectLiving`, which runs daily assimilation through the engine loop on the main thread. Together that is about 140 kB gz of engine core plus about 70 kB of registry.
- The Simulator and Planner stores reach the same registry and engine core.
- What would close the gap:
  1. Run daily assimilation and the projection in the engine worker, behind the §9.2 gateway. Today could then render from the cached `ConfirmedState` record.
  2. Let `implement()` take a loader, so the Living, Coach and catalogue executors load on first dispatch while the definitions stay eager.
  3. Have the Simulator and Planner pages import the bus and their own defs instead of `@/commands` (the planner part is for E6).
- For /welcome and /body, the rest is page code: AvatarMorph 17 kB, the intake doc 22 kB, the Disclaimer 11.5 kB and the components chunk 13.5 kB.

**Gate (B1).** pnpm typecheck exits 0, pnpm lint exits 0 and pnpm build exits 0 (precache 225 entries, no size warning).
- `pnpm vitest run` on the 61 test files under tests/, src/app, src/features/living, src/features/intake and src/features/body: 520 passed.
  - The files are passed explicitly. The bare filter `tests` also matches every `__tests__` path, planner suites included.
  - In an earlier, wider run under load, today.test.tsx failed. Alone it passes 15/15. Load-sensitive.
- Touched areas (onboarding, commands, state, living, engine/body, engine/core, ai/coach, simulator, settings; planner excluded): 84 files, 898 passed, 3 expected fail, 1 failed.
  - The failure is src/features/simulator/__tests__/gentleStarter.test.tsx, a `waitFor` timeout. Alone it passes 2/2. Load-sensitive.

# v0.2 · QA pass 2 and release gate (2026-10-02)
Package Q2. Planner behaviour checked with numbers, AI safety proved by tests, full gate under normal load, acceptance walk.

## Planner behaviour (tier M, app path)
- **Harness.** src/engine/planner/__tests__/qa/ (`vitest.qa.config.ts`; `.qa.ts` files, never in `pnpm test`):
  - `run.qa.ts` makes one full `runLadderPlanner` run per request, as the app does (ladder, Ideal, limit costs, time to target).
  - It replays every rung through the Simulator's own `simulate` call and writes a digest to qa/results/q2/planner/<key>.json.
  - `checks.qa.ts` asserts on the digests.
  - Requests: golden a–e (d and e with the personas' supplement consent), autophagy first with T3 and 2–3 training days (`af`), fat loss first with T3 for the 78-kg woman (`flf`), and the benchmark's fuzzed training-split requests fuzz0–9.
  - Result: **30 of 31 checks pass**; the failure is PLN-06.
- **(a) Autophagy first, T3, training: passes.**
  - Both rungs fast: Hard has a weekly 24-h fast, 12 in all; Easy has five 48-h fasts.
  - Each rung says why: "because it can serve goal 1 (autophagy signal). Without the 24-hour fasts, autophagy signal would be about 3.0 index lower …".
- **(b) Fat loss first, T3: passes.**
  - The gate offers fasting; no rung fasts. Each rung names the rival and why it lost.
  - Hard: "A plan with a weekly 24-hour fast was considered. Goal 1 (fat mass) would end 0.31 kg higher. It also meant higher hunger peaks (+9 points) and 0.63 kg more lean-tissue loss."
  - Easy: the fasting plan "is harder than the Easy plan allows".
- **(c) Ladder.**
  - The golden rungs are strictly ordered in D, and every missing rung carries a reason (5/5 pass).
  - **PLN-06, quantified:** Medium was dropped in **9 of 10** fuzzed requests and in 16 of 17 requests overall. Only fuzz8 (autophagy first) shows Hard 0.60 / Medium 0.44 / Easy 0.28. Easy was present in 5 of 10 fuzzed requests.
  - Reasons for Medium's absence (final run, 16 requests): tooClose 12, notDistinct 2, infeasible 1, belowMinimal 1.
  - **Fix attempted, measured, reverted:**
    1. Kept Medium's threshold inside the frontier band [F(D_E + gap), F(D_H − gap)], with a key that does not reward D below D_E + gap.
    2. Scaled the D gap to min(0.15, ¼ D_Hard).
    3. Capped Medium's threshold at Hard's goal-1 level.
    - Re-run on all 17: Medium was still dropped in 16 of 17.
  - Instrumented runs show the cause is the frontier, not the scale:
    - Golden a: Medium reaches 95 % of Hard's fat loss at D 0.36 against Hard's 0.47, but is nearly Hard's plan (Gower 0.06).
    - `af`: Medium lies inside the band but is Easy's plan structure (Gower 0.11).
    - c: Hard and Easy are only 0.15 apart.
    - d, fuzz3: Medium was solved, but none of its 3 candidates passed validation and the chance check.
    - fuzz6: Medium **equals Hard's goal 1 at D 0.40 while the pinned hybrid Hard needs D 0.60** (new finding PLN-10).
  - Loosening the Gower check would show near-duplicates, which PLANNER_V2_SPEC §1.3 forbids. A change with no measured benefit was not shipped. The code is in .e6-tmp/ (not committed).
  - The digests before the limit-cost fix are kept in qa/results/q2/planner-before.
- **(d) Ideal.**
  - Never startable: the start command maps only Hard/Medium/Easy, and the v1 view carries only A/B/C.
  - Ideal ≥ Hard on goal 1 for golden a–e.
  - Limit costs add up to the gap together with the interaction remainder.
  - Found and fixed (c392c2c): golden a's cardio limit "cost" was a 0.29 kg *loss* of fat loss. A short relaxed search had ended below Hard although Hard's plan stays feasible. The limit cost now falls back to no change, as the Ideal does (PLN-03 rule).
- **(e) Re-plan from a logged week: passes at the engine level.** domain/__tests__/replan.test.ts passes 10/10:
  - past prescriptions immutable;
  - today and tomorrow locked;
  - light re-plan touches the next 7 days only, within ±10 % energy;
  - churn limits ±10 % energy, ±1 session, no new fast or day type;
  - automatic changes only lower load.
  - **But the app never calls it** (LIV-15 below).
- **(f) Tier M wall time, 8 evaluator threads** (benchmark perf job, machine otherwise quiet, load ≈ 10 at start), full app run:
  - golden a 34.1 s, golden c 23.3 s, `af` 30.9 s, all ≤ 40 s;
  - the v1 search alone takes 13–18 s;
  - qa/results/q2/timing-tierM.json.
- **(g) R-PLAN-SAFETY: passes on all 17 requests.** No rung's Simulator run raises a caution or danger the plan may not carry. Listed ones are the opted-in regimes only (W-E07, W-E18, W-M09, W-F02).

## Rulings
- **R-AUDIT-1 (2026-10-02): keep** "alternate zero-energy days only when the goal fasting serves is fat loss or a transient marker".
  - The evidence (20 §4C, 13 §4C B12) is in overweight people losing weight.
  - Removing the rule gained 21× the tolerance on one corpus request, but with a training-attributable lean loss in 3 of 3 people tested.
- **R-AUDIT-2 (2026-10-02): keep** "omega-3 only with a triglyceride or blood-pressure goal".
  - Omega-3 has no documented fat-loss mechanism.
  - The gain without the rule is 1.0 × the tolerance, within search noise.
- Both still count as flagged in the coverage numbers (so a larger gain later stays visible). The report row now says "reviewed 2026-10-02, kept" with the reason (a3e654b).
- **Golden supplement consent:** stated in the fixture as `GOLDEN_SUPPLEMENT_CONSENT` with a comment saying why (5049721).
  - The dependence stays an open finding (PLN-12): without the opt-in, golden d returns no fasting rung and golden e's easier rung opens with a deficit.

## AI safety and parity
Commits a89332c and 9c2ef3f. The tests run on the real registry, bus and manifest for every provider dialect: OpenAI chat (incl. Gemini, Ollama), OpenAI Responses (incl. Sign in with ChatGPT) and Anthropic.
1. **Destructive commands: proved.**
   - UI-only destructive tools are never offered: data.eraseAll, data.import, sync.unpair, coach.delete, bio.deleteSource.
   - A forged call naming any destructive command dispatches nothing and changes no document.
   - `plan.end` / `plan.replace` are on the AI surface by design (§5.2/§5.7): they become typed-confirmation cards and the model never runs them.
2. **Edits become proposals: proved.**
3. **Logs apply with Undo: was broken, fixed.** In src/ai/coach/executor.ts, a model's log of a measurement, note, steps, sleep or fast could not be undone: Undo called `history.undo` on an append-only collection, was rolled back, and the card said Undo failed. It now retracts the entry (`log.retract`), as the Living screens do. The test fails without the fix.
4. **Agent surface: proved.** WebMCP, MCP `tools/list` and the Companion gate carry no destructive tool and refuse forged names and ids.
5. **API keys: proved.** A fake key used in real Coach turns, including a 401 body that echoes it, is absent from the console, transcript, history, every document (so nothing syncs), the export file and localStorage.
- Parity test (src/commands/__tests__/parity.test.ts): 15/15 pass.
- noInternalRefs + internalRefsRendered: 45/45 pass.
- **Bundle scan** (dist after the gate build): "dossier" 1,575, "§" 11,291, R-[A-Z]{2,} 304, "MODEL_SPEC" 428, "A/B/C" 0.
  - Every sampled hit is a data or metadata field: planner `maintainerRef`, param notes and sources, rule `legacy`.
  - Screen copy is covered by the two guards. Unchanged risk from pass 1: about 1 MB of maintainer notes ships to clients.

## Gate (2026-10-02, after the fixes, normal load)
```
$ pnpm typecheck      → tsc -b --noEmit                                   EXIT 0
$ pnpm lint           → eslint .                                          EXIT 0
$ pnpm build          → precache 225 entries (10924.35 KiB) … dist/sw.js, dist/workbox-398fc23b.js   EXIT 0
$ pnpm test:release
 Test Files  396 passed (396)
      Tests  4960 passed | 185 expected fail (5145)
   Duration  404.50s
 Test Files  17 passed (17)
      Tests  103 passed (103)
   Duration  18.20s                                                       EXIT 0
$ pnpm audit:planner
 Test Files  8 passed (8)
      Tests  8 passed (8)
   Duration  177.97s
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  1.35s                                                        EXIT 0
```
No load-sensitive file failed in this run.

## New findings
### PLN-06 · medium (raised from low) · Medium is shown for 1 of 17 requests (9 of 10 fuzzed requests drop it). Cause: the attainment frontier between Easy and Hard holds no plan that is both ≥ the D gap from each side and ≥ 0.20 Gower from both. Medium candidates are Hard or Easy with small changes (see above). Owner area: planner algorithm (a ladder-specific search for a structurally different middle plan) and the difficulty weights (spec §1.7, owner topic). Status: partly fixed in dd4f5fe (E5b, see below)
### PLN-10 · medium · The hybrid's Hard is not always the least burdensome plan for its result. In fuzz6 a plan reaches the same goal 1 (d̃₁ 0.448 vs 0.446) at D 0.40 against the pinned v1 Hard's 0.60; spec §1.3 says Hard is the least burdensome among goal-tied plans. Owner area: optim/hybrid.ts (after the pin, prefer a goal-tied lower-D plan). Status: open
### PLN-11 · low · Fat loss first, Easy: the fasting text says the fasting plan "reaches 1.4 kg more fat mass loss", while the rival's detail field says "goal 1 (fat mass) 0.31 kg higher" (Hard's rival). Owner area: domain/fastingExplain.ts. Status: open
### PLN-12 · low · Golden d's fasting rung and golden e's surplus-only easier rung depend on the supplement opt-in (creatine); now stated in the fixture. Owner area: planner. Status: open
### LIV-15 · high (known limitation for v0.2.0) · "Re-plan the rest (same goals)" (Today menu, Progress drift card) dispatches `plan.replan`, which is still a stub, as are `plan.declareEvent`, `plan.shift`, `plan.editDay` and `plan.swapExercise` (src/commands/defs/living.ts). The person sees "This isn't available in this version of Vitals yet." The planner's receding-horizon `replan` and its port (livingWiring.ts) exist and pass their tests, but no executor calls them, so a running plan is never re-planned. Owner area: src/commands/living. Status: fixed in 6fef189 (E5b, see below)
### AI-01 · low · Coach messages are stored in the synced `messages` collection including `providerState` (reasoning signatures / encrypted reasoning), which §5.4 says is local-only. No keys are in it. Owner area: src/ai/coach/documentStore.ts:34-36, 94. Status: open
### AI-02 · high · The Coach's Undo of a model's log (other than meals and bulk logs) failed. Status: fixed in a89332c

## Open after Q2
- **Planner:** PLN-06 (partly fixed, E5b), PLN-10, PLN-11, PLN-12; the budget-neutral promise of the hybrid (E6).
- **Living:** LIV-14, Q1B-B-07, Q1B-B-08, Q1B-B-06. (LIV-15 and LIV-09 fixed in E5b.)
- **Sync/settings:** SET-07, SET-08, SET-10, SET-11 (decision), SET-14 (version, set by `pnpm release minor`), SET-16, SET-18, Q1B-A-01, Q1B-A-02, Q1B-A-06.
- **Intake:** ONB-02 (decision), Q1B-A-03…05.
- **AI:** AI-01. 71 of 132 new references are flagged abstract-only/unverified (E15).
- **Not tested:** real provider keys, Sign in with ChatGPT against OpenAI, Web Bluetooth with a ring, WebMCP in Chrome, the 3D figure's WebGL path in a headed browser, tier S/X from the UI.

# E5b · adaptation commands and the Medium band search (2026-10-02)
- **LIV-15 fixed (6fef189).** `plan.replan`, `plan.declareEvent`, `plan.shift`, `plan.editDay` and `plan.swapExercise` are implemented (src/commands/living/adapt.ts, src/living/edits.ts; docs/LIVING_PLAN.md §9.1). The person's edit is applied and its days pinned; the planner's receding-horizon `replan` (worker port, tier passed through) re-plans the other days; `checkReplan` + `adoptionPolicy` decide; the result is a proposed version (a change card) unless every change lowers load and the person made it. 0 stubs are left (docs/COMMANDS.md).
  - Tests (src/commands/living/__tests__/adapt.test.ts, tier S, in-memory store, 8/8): busy for three days → past and lock window unchanged, busy days without sessions, weekly churn limits hold against the edited plan, goal date moves later and fat end P50 rises, idempotent key, Undo removes the version; high-carbohydrate occasion → that day +120 g carbohydrate / +480 kcal, rest within churn limits; illness; pushBack moves the end date on adoption; editDay, an unsafe edit refused with nothing written, past days refused; plan.replan; swap for a day (dayStatus.swaps) and every week (proposal, weekly mean credit ≥ 0.90, engine schedule unchanged). Planner test: pinned days and baseline (domain/__tests__/replan.test.ts 11/11).
  - Found on the way and fixed: when none of the six re-plan finalists verified, the planner reported "no safe plan" even when the current plan still verified; it now keeps the current plan. Unlogged days are no longer sent to the planner as logs (they made every re-plan before the first check-in fail the energy-bias band). Busy and travel days keep the plan's food (the habitual day pushed training-day energy availability out of the band before the first check-in).
  - UI: Today "I'm busy or away…" (declareEvent, or shift pushBack), Plan details "Re-plan the rest", Train swap (day and every week, honest copy, LIV-09), Coach cards for the five tools; parity snapshot regenerated (stub markers gone; schema hashes of declareEvent and swapExercise changed). `plan.editDay` has no screen yet (Coach and agents only; its "no screen calls it" reason stays).
  - Open: a Coach card for an event the plan keeps as a proposal (it raises load) must be applied again on Today.
- **PLN-06 partly fixed (dd4f5fe).** When the final ladder check drops Medium while Hard and Easy stand, a short Medium band search runs. It is seeded from structures other than Hard's and Easy's and costs about 220–360 EU on top of the total. It looks in [D_E + gap, D_H − gap] for a plan that passes the unchanged thresholds (D gap 0.15, Gower ≥ 0.20, order, validation, chance check).
  - Medium now shows for **6 of 17** requests (was 1): d, af, flf, fuzz4, fuzz6, fuzz8. That is 6 of the 10 requests where Easy stands, and **3 of 10 fuzzed** (was 1), so the "Medium in at least half of the fuzzed requests" check still fails (30/31).
  - The rest are honest drops: in 7 requests Easy itself is dropped (b, e, fuzz0, 1, 5, 7, 9); for c and fuzz2, Hard − Easy < 0.30, so the band is empty; in a, the best plan in the band (D 0.312, Gower 0.33/0.31) misses Medium's goal-2 constraint; in fuzz3 the band is 0.005 wide.
  - Tier-M wall time on 8 workers: golden a 33.9–34.2 s, c 23.0–25.0 s, af 31.8–32.4 s (≈ +1.7 s on af, none measurable on a or c), all ≤ 40 s. Digests and timing: qa/results/e5b/.
- **Gate (2026-10-02, after dd4f5fe):**
```
$ pnpm typecheck      → tsc -b --noEmit                                   EXIT 0
$ pnpm lint           → eslint .                                          EXIT 0
$ pnpm build          → precache 225 entries (10957.68 KiB) … dist/sw.js, dist/workbox-398fc23b.js   EXIT 0
$ pnpm test:release
 Test Files  400 passed (400)
      Tests  4985 passed | 185 expected fail (5170)
   Duration  390.60s
 Test Files  17 passed (17)
      Tests  103 passed (103)
   Duration  16.33s                                                       EXIT 0
$ pnpm audit:planner
 Test Files  8 passed (8)
      Tests  8 passed (8)
   Duration  173.98s
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  1.22s                                                        EXIT 0
```

# v0.3 · integration (I2)

Open items handed back by batch 02 (E16–E22) and carried by the integrator after the merge into main (2026-10-02).
Sources: `docs/wp/E16.md` … `docs/wp/E22.md`. Each line gives the kind (follow-up, decision, or owner = needs the owner present), the owner it goes to and the status.

## Blood markers (E20)
### I2-01 · follow-up · 5 marker rules and 15 interaction rows cite only the project's own research index (no DOI, PMID or URL), so they render without a source link. List: `INTERNAL_ONLY_RULES` in src/markers/__tests__/interactions.test.ts. Source: E20 open item 1. Owner: research follow-up (R13 owner). Status: open
### I2-02 · follow-up · The planner search does not read `preferLevers` yet. The request field exists (weight ≤ 0.02, regulariser only per SUITE_SPEC §13.5.3) but no `prefer` rule changes the ranking. Source: E20 open item 3. Owner: planner (E21 successor). Status: open
### I2-03 · follow-up · A blood-test report file cannot be deleted: there is no attachment or blob delete command, and the review's button says so. Reports are stored under the blob store's `photo` purpose. Source: E20 open item 8. Owner: markers / blobs. Status: open
### I2-04 · follow-up · Lab history entries (`measurements`, `metric: 'lab:<id>'`) may count as logged days in the living projection; profile labs migrated into `markers/me` get no history entries. Source: E20 open item 11. Owner: living. Status: open
### I2-05 · follow-up · The Evidence topic `blood-markers-and-diet` has no `relatedMetricIds`, so it is not offered in "Explain this curve". Source: E20 open item 13. Owner: evidence. Status: open

## Planner ladder (E21)
### I2-06 · decision · Medium is still rare (3 / 6 / 4 of the 17 test requests at quick / standard / exhaustive). Where it is missing, Hard and Easy are usually < 0.30 apart in effort or < 0.40 apart in plan distance, so no middle plan can be ≥ 0.20 from both (the §1.3 pairwise rule). Loosening it (distance to Hard only, or 0.15) is a spec decision for A3; the old PLN-06 check (`checks.qa.ts` (c), "Medium in ≥ half of the fuzzed requests") stays red until then. Owner: A3 (PLANNER_V2_SPEC §1.3), then planner. Status: open
### I2-07 · follow-up · fuzz0: at the standard search the easier plans beat the pinned (v1) Hard on goal 1 (d̃₁ 0.72 vs 0.26), so Easy and Medium are dropped for breaking the order; at exhaustive Hard's goal-1 change is below the minimal one. This is PLN-10 (Hard not always the best plan for its result). Owner: planner (optim/hybrid.ts). Status: open

## Supplements (E18)
### I2-08 · follow-up · Habitual supplements are not in the engine: a `taking` row only grants consent (`optIns.levers`). SUITE_SPEC §13.2 says a taken lever is in the baseline and every rung, never added by a plan and costs no difficulty; the request has no field for it. Pointer: `supplementPlannerInputs().habitual` (src/catalogues/supplements/planner.ts); needs an engine hook such as `PlannerSafetyInput.optIns.habitualLevers`. Owner: planner / engine. Status: open
### I2-09 · follow-up · Today does not show the dose of supplements the person takes habitually; Today lists only the prescription's supplements, and the "yours" rows are only on the Food tab (SUITE_SPEC §13.2 "dose shown on Today"). Pointer: src/living/today.ts. Owner: living. Status: open
### I2-10 · follow-up · Safety flags do not reach the supplement row's caution line: `SupplementRow` has a `caution` prop, but Food's `safetyFlags` is still `[]` (TODO(E2) in src/features/living/food/profile.ts). Owner: living food + engine safety (E2). Status: open

## Kitchen and pantry (E17)
### I2-11 · follow-up · `food.candidates` (`readFoodSetup` in src/commands/food/context.ts) and the grocery "already have" set (src/features/living/food/groceries.ts, the ⋯ Pantry panel) still read the v0.2 `intake.kitchen.pantry` instead of `pantry/me` (`pantry.get`). Recipes already read `pantry.get`. See docs/LIVING_PLAN.md §8.1. Owner: living food. Status: open
### I2-12 · follow-up · Pantry and staple items resolve to nutrients only for the 19 fixture-linked items: `usdaFdcId → FoodRecord.id` must be mapped when the food bundle lands (`resolveFood(cat, id, table, fdcToFood)`); 172 IFCT-pending items wait for the licence. Owner: catalogues / food bundle data task. Status: open

## Intake v3 (E16)
### I2-13 · follow-up · A measured TDEE (`tracking` method) is stored and shown on the maintenance card but is not yet an observation at plan start (SUITE_SPEC §13.1 binding). Owner: living (plan start / filter). Status: open
### I2-14 · follow-up · "Couldn't save" is wired only to `intake.answer` failures; the loading skeleton and the 10-minute draft keep from the design (§3.5) are not built. Pointer: useChapterFlow.ts (`failed`), QuestionCard.tsx. Owner: src/features/intake. Status: open
### I2-15 · follow-up · After a deep-linked Change from a Body › Maintenance driver row, the chapter's back link goes to `/body#habits`, not back to `/body#maintenance` with focus on the row. Pointer: IntakePage.tsx `backTarget`. Owner: src/features/intake. Status: open
### I2-16 · follow-up · The summary's "blood markers" row text comes from the chapter's first answers, not a markers summary line. Pointer: summary.ts `LINE_QUESTIONS`. Owner: src/features/intake + markers. Status: open
### I2-17 · follow-up · The food chapter's reducer reads its base questions; parts that replace base questions must write their own documents. Status: addressed in the I2 merge (the kitchen picker answers are mapped back to the v0.2 ids for `DietProfile`; the supplement questions stay in the base graph as `supplements` / `taking` and their reducer writes v2)

## Companion (E22), owner-dependent
### I2-18 · owner · Sign in with ChatGPT consent: OpenAI's bot check stops scripted and headless runs before login, so the consent step needs the owner's browser. Steps: docs/COMPANION.md §7 "Re-run when the owner is present". Status: open
### I2-19 · owner · OpenCode Zen Coach turn (log a meal, propose a swap): no Zen key on this PC; `vitals-companion keys import opencode-zen` is ready. Status: open
### I2-20 · owner · Phone sync proof through the oci-arm relay: the phone was offline in Tailscale. Status: open
### I2-21 · owner · ChatGPT desktop app window (MCP card, WebMCP in its browser): the app needs a restart to load MCP servers, and its `webMcp` flag is remote. Its bundled Codex host passed. Status: open
### I2-22 · owner · Repoint the PC wrapper at the main checkout after the merge: `node "<checkout>/packages/companion/bin/vitals-companion.mjs" install --force`; then redeploy the server from main (rsync, `npm install --legacy-peer-deps`, `systemctl --user restart vitals-companion`). Status: open
### I2-23 · follow-up · No screen lists staged agent proposals to apply: agents get `pending_user`, but the person cannot find where to apply them (found by the WebMCP proof). Owner: app UI (proposals). Status: open
### I2-24 · follow-up · `installPolyfills()` is never called in the web app (src/main.tsx); current Chromium has the methods built in, Safari and older browsers may not. Owner: app shell. Status: open
### I2-25 · follow-up · Settings › Agents shows the tab's tool count (120), not the 109 MCP tools. Owner: src/features/settings/agents. Status: open
- Fixed during the merge (db7d95e): `plan.declareEvent`'s schema description no longer contains "×" (it hid the schema from Chromium's CDP `toolsAdded`), and `log.measurement`'s `metric` is now an enum of ids (`weightKg` …), so agents no longer guess `weight`.

# v0.3 · QA pass 3 and release gate

Q7, 2026-10-03, main. Sources: docs/wp/I2.md, docs/wp/E23.md, qa/findings-Q3.md … qa/findings-Q6.md. Every blocker and
high from Q3–Q6 is fixed (statuses in those files). Q7 fixed these before the gate, each with a test:

| Finding | Severity | Fix | Test |
|---|---|---|---|
| Q6-11 creatine listed twice on Food and Today | medium | 50d2711: one line per supplement, "you take 5 g · morning · plan suggests 3 g", one Taken key | food/__tests__/FoodPage.test.tsx, today/__tests__/today.test.tsx |
| Q6-12 Today row sheet shows no selected answer | medium | c03cc7b | today/__tests__/rowSheet.test.tsx |
| Q6-14 repeated copy (because chip; "Let the plan ease itself") | low | a997385 | markers/ui/__tests__/bannerBecause.test.tsx, planDetails.test.tsx |
| Q5-02 agents named by raw MCP client ids | medium | 72b5db5 (Companion `clientDisplayName`, app `agentProductName`) | companion mcp.test.ts, ops.test.ts; ProposalsList.test.tsx, AgentsSection.test.tsx |
| Q5-04 clean server install skips better-sqlite3's build; rsync deletes the lockfile | low | a6d1415 (docs/COMPANION.md §2) | docs only |
| Q4-17 remainder: quiet mode on by default in safety mode R1 | low | ffdac30 | quietMode.test.ts, QuietMode.test.tsx, living documents.test.ts |
| Q3-J5-10 `committed` fires before the write is readable | low | 60abab6: a read waits for writes already announced (capped 1.8 s); 4ce36ed parity test | commands/__tests__/readAfterCommit.test.ts |
| Stopping a search can return a near-empty Hard (Q3b open item) | high in effect, found by Q3b | 61cb7c5: a stopped run worse or less complete than the shown ladder keeps it and says so; a stopped run with no Hard above g_min shows no plan; 5e1dbc6 pool test | stopped.test.ts, stoppedLadder.test.ts, planner page.test.tsx, planner.pool.test.ts |
| Q3-J1-05 skip after saving marker readings | medium (question) | no change: skip keeps the readings and says so | b806b19 markers.test.ts |

## Open after Q7 (medium and low), with owners

| ID | Severity | What | Owner | Why open |
|---|---|---|---|---|
| Q3-J4-04 | medium | Medium is a "too close" chip on some quick-search ladders (engine audit: shown 13/11/13 of 17 at S/M/X) | planner (PLN-06) | distinctness rule by design (PLANNER_V2_SPEC §12.6, §12.8); a verified reason is shown |
| Q5-03 | medium | Applying the `maintenance8` starter keeps the plan name "Moderate deficit" | scenario commands (E6 area) | needs "name set by a person" stored on scenarios |
| Q6-11 follow-up | low | Ticking Taken on a merged supplement line logs the plan's dose, not the person's own dose | living/food (data/commands.ts) | product decision: which dose to log |
| Q6-14 follow-up | low | Some banner sentences read "Because of this result and …" after the clause moved to the chip | markers copy (src/markers/because.ts) | wording polish |
| Q3-J1-09 remainder | low | summary markers row wording, month-without-year date, inert supplements Done, `regions: []` in kitchen.get, 768 progress inset | src/features/intake, food-kitchen | each its own logic or layout change |
| Q5-05 | low | Settings › Agents logs a harmless 404 for `/health` on the app's origin | src/agents/companion.ts | probe only when served by the Companion |
| Q5-02 server side | low | The Companions on this PC and oci-arm still run the pre-Q7 code; the app maps raw ids itself, the server's `mcpClients` names change after a redeploy | orchestrator / owner (docs/COMPANION.md §2) | touches the live relay |
| J1v tablet walk | low | "tablet: walk completes" timed out in 2 full Q3b runner passes, passed alone | qa/scripts/Q3 | flaky, not reproduced |
| Q4 real model | owner | Coach journeys ran only against the scripted stand-in provider | owner (key) | no real key on this PC |
| I2-01…I2-25 | follow-up/owner | see "v0.3 · integration (I2)" above | as listed | unchanged by Q7 |

Found while gating (Q7) and fixed: the worker-pool cancel test expected options after a stop in the first phase (5e1dbc6,
test follows the new rule); a long search stopped at the plateau that kept the quick ladder lost its convergence curve
(3cd4896, tests in stoppedLadder.test.ts and ladder.test.ts); Q4 J9 failed because today is a rest day in the seeded
plan (c9ff11f, script moves the page clock); Q3 J4 expected tier X where the quick ladder is kept after a stopped long
search (bb1bb06, script now checks the "long search was stopped" notice instead).

## Gate (Q7, 2026-10-03)

| Step | Result |
|---|---|
| `pnpm typecheck` | 0 errors (5e1dbc6 and c9ff11f) |
| `pnpm lint` | 0 problems |
| `pnpm test:release` | 472 files, 5,868 passed, 185 expected fail, 0 failed; serial part 17 files, 103 passed (c9ff11f) |
| `pnpm audit:planner` | 17 part files + report passed, 36 min (5e1dbc6); 204 cells (4 levels × 3 tiers × 17 requests), 0 failed |
| `pnpm build` | precache 264 entries, 12,044 KiB; shell JS 203.8 kB gz (221.1 with CSS) |
| Q3 `node qa/scripts/Q3/run.mjs` | full run 2,190/2,195 (5 script expectations, fixed in bb1bb06), `run.mjs j4` re-run 1,215/1,215: 2,205 passed, 0 failed |
| Q4 `node qa/scripts/Q4/run.mjs` (scripted provider) | 117/117, exit 0 |
| Q5 `node qa/scripts/Q5/run.mjs` (Companion doctor exit 0) | 44/44, WebMCP 26/26, exit 0 |
| Q6 `node qa/scripts/Q6/run.mjs` (check mode, Q6b screenshots) | 7/7 steps, 129 checks, 0 failed, exit 0 |

# v0.4 · Q10 (dynamic whole-app review, 2026-10-03)

Build: `wp/Q10` cut from main at `0675267` (I3 merged). Local only: preview on :5283, a local Vitals Server (home role,
packed build) behind an https proxy on :5284, the scripted model on :5285. oci-arm was not used (Q8's run).

| ID | Severity | What | Repro | Pointer | Status |
|---|---|---|---|---|---|
| Q10-01 | high | Today drops the steps and sleep rows once a device has measured the day, so the "fed by your ring · Correct" row (E28) never shows when the ring has a reading; the person cannot correct today's steps or sleep from Today | ring paired over MQTT with today's data → Today lists weigh-in and meals only | `src/living/today.ts:107-108` (checklist leaves them out when `observations` has them); `src/features/living/today/model.ts` | fixed: Today's row model puts the two rows back when the checklist left them out; test `today/__tests__/deviceRows.test.ts` |
| Q10-02 | medium | Settings at 390 px scrolls sideways by 64 px once a device source exists: the five-column stream table on the Devices card is wider than the card | paired ring → any Settings page at 390 px | `src/features/settings/devices/DevicesSection.tsx` `PolicyRows` | fixed: the table scrolls inside its card |
| Q10-03 | medium | Coach at 390 px scrolls sideways by 39 px when a correction proposal card is in the conversation (the log's implicit grid column takes the card's min-content width) | Coach proposes a correction (log steps on a ring-owned day) → Coach at 390 px | `src/features/living/coach/coach.css` `.lv-coach-conv/log/turn`; the card: `src/features/living/components/changeCard.css` | **fixed**: the card wraps (E33 9be38ef); the last 24 px were the composer's long prompt chip (Q11-01, fixed in dc03a61); srv-coach at 390 px 0 px overflow in Q11's pass |
| Q10-04 | low | Accessibility (axe, WCAG 2 A/AA): the empty "Your supplements" list held a paragraph inside `role=list` (every Settings route, score 96) | Settings with no supplement rows | `src/features/components/SupplementRowList.tsx` | fixed: the note sits outside the list |
| Q10-05 | low | Accessibility (axe `definition-list`): the intake summary and Body's summary rows put a link inside `dl > div` next to `dt`/`dd` | /onboarding/summary, /body | `src/features/intake/IntakePage.tsx:369`, `BodyIntake.tsx` | open (low; axe score stays 95–100; not a blocker for 0.4.0) |
| Q10-06 | low | The Lumen history import toast reads "2026-09-29 to 2026-10-01 · 10 records · 47 samples · 0 duplicates skipped" (ISO dates, counts in internal words) | Devices › Lumen Health over MQTT › Import your Lumen Health history… | `src/features/settings/devices/copy.ts` `imported` | **fixed** (E33 9be38ef; test `src/features/settings/devices/copy.test.ts`) |
| Q10-07 | low | The server's MCP lists `plan_edit_day` and `plan_declare_event` (and likely other planner-backed tools) in edit scope, but they fail at call time with `internal` "runs in the Vitals app, not on the server"; docs/SERVER.md says such tools answer `not_on_server` and are dropped from the list | edit-scope agent token → `plan_declare_event` on a person with a running plan | `packages/companion/src/home/aiMount.ts` / person program dispatch | **fixed** (E33 9be38ef: tools that answer `not_on_server` are left off the server's list; test `home/notOnServer.test.ts`) |
| Q10-08 | low | The Q3 forbidden-text list bans the word "Lumen" (the product rename); v0.4 names the ring's own app "Lumen Health" on the Devices card on purpose | Q3 J6 settings scan | `qa/scripts/Q3/lib.mjs` `FORBIDDEN` | **fixed** in Q11 (c27d123): Q3's list allows "Lumen Health" and still bans "Lumen" alone |

## v0.4 · Q9 (ring path against oci-arm, 2026-10-03)

Scripts `qa/scripts/Q9/`, evidence `qa/results/Q9-*.json`, hand-back `docs/wp/Q9.md`.

### Q9-1 · high · Today hid the device's night and steps, so **Correct** could not be reached. Status: fixed (34f35d2)
Repro: a running plan, the sleep and steps streams switched on for "my plan", a night from the ring → Today has no sleep or
steps row at all (no value, no source, no Correct). Cause: `src/living/today.ts` `checklist()` dropped the `sleep` and
`steps` items whenever `observations` held a device reading (pre-E28 rule), so `PrescriptionRows` never got a row to put
`FedBy` on. Fix: the items stay, `done` when the device recorded them. Test: `src/living/__tests__/integration.test.ts`.
Rechecked on oci-arm (journey 4): Today reads "sleep · 7 h 00 min · J-Style 2301 · Correct".

### Q9-2 · medium · Devices card had no battery line; "See why" named only the latest reason. Status: fixed (9d1dbbf), deployed (0.4.0-70000ef and later); Q9 J1 on oci-arm 9/9 shows the battery line
Repro: stream `state/battery` (64 %) → the card shows connection, last event and counts, no battery (journey 1 on oci-arm 0.4.0).
`ingest.status` kept the battery in `stats.json` but never returned it; `RingBatteryLine` (E29) was never placed. Fix:
`/v1/mqtt/status` returns `battery` and `deadLetters.byReason` (`packages/companion/src/home/ingest.ts`); the card shows
"Battery 64 % at HH:MM · last data received HH:MM" and "See why" lists each reason with its 7-day count
(`src/features/settings/devices/MqttCard.tsx`; older servers: the fields are optional). Tests: `broker.test.ts`,
`MqttCard.test.tsx`; checked on a local server from this build (journey 3, `qa/results/Q9-j3-restart.json`).

### Q9-3 · high · Per-message ingest writes a new sample chunk for every MQTT sample; superseded chunks are never pruned. Status: fixed (E33: 19530e2, merged 8699492; 124 messages store the same 4 chunk files as one batch, `packages/companion/src/home/chunkCopies.test.ts`). Limit kept: copies already uploaded to the relay stay there (its `/blobs` is create-only)
Repro: journey 1, the same 141 samples: the broker path stored **141 chunk documents (130 superseded, 25,954 blob bytes)**,
the file import **11 documents (760 bytes)**; live chunks are identical. A day of minute heart rate (about 1,440 events)
would make about 1,440 chunk documents and blobs whose sizes add up quadratically (a few MB per stream per day), synced to
every device. Pointer: `packages/companion/src/home/broker.ts` `queueImport` (one `ingestLumen` call per WAL entry) and
`src/biometrics/store/docStore.ts` (no pruning of superseded chunks). Suggested fix: import the WAL entries waiting in the
queue as one batch (Lumen sends history in bursts), and drop superseded chunk blobs after sync. Owner: server ingest.

### Q9-5 · high · A browser that gets ring data by sync shows no scores (night view, body signals stay empty). Status: fixed (three causes: one unreadable day aborted the whole rescore, E33 572dc87; a chunk merged during an upload run was never uploaded, 70000ef; no catch-up rescore at start, 3b37fc0; plus the correction card, fb31d14). Q9 J4 on oci-arm 14/14
Repro: profile paired with q9-a; the records arrived from the broker by sync → `bio.scores` returns `results: []` for
2026-09-20…2026-10-03, also after a correction on Today schedules a rescore; the profile that imported the same events
from a file has results. Progress shows "No body signals yet" and the night view (on a sleep score's detail) cannot be
opened. Scores are derived per device (`bioScores` not synced, `src/store/collections.ts`). Partial fix (Q9): records and
corrections that arrive by sync now schedule a rescore (`rescoreOnRemoteBio` in `src/commands/bio/runtime.ts`, test
`src/commands/bio/__tests__/remoteRescore.test.ts`); the browser check still shows 0 results, so the rescore itself yields
nothing for synced records. Cause not found; start at `runRescore` in `src/commands/bio/exec.ts` with a profile fed by sync.

### Q9-6 · blocker for the phone · The oci-arm broker stopped answering CONNECT. Status: closed: not seen again after the orchestrator's redeploys (0.4.0-8699492, 0.4.0-70000ef, 0.4.0-51cf6be); Q9 J1 9/9 and J2 12/12 connected on oci-arm. The likely cause is the starved process of E34 (person workers spinning on Node 24's shared Web Locks), fixed in 51cf6be; not proven for this stall
From about 16:03 IST every MQTT connection to `wss://vitals.example.ts.net:8443/mqtt` timed out waiting for CONNACK
(logins of q9-a and a brand-new q9-c), while `/health` and the HTTP routes answered. The journal shows no broker line
after 16:02:27. The service had restarted between 15:50 and 15:55 (pid 1463 → 7592; not by Q9). The last broker traffic
from Q9 before it: two raw MQTT sessions that published three QoS 1 messages each and dropped the socket (journey 2,
`qa/scripts/Q9/j2-replay.mjs` step 2). The same pattern against a local server from this build does not stall
(`qa/scripts/Q9/repro-connack.mjs`, 3/3), so the tailnet proxy in front (`tailscale serve`) is a suspect. Ask: restart
`vitals-server` on oci-arm, then `node qa/scripts/Q9/setup.mjs a && node qa/scripts/Q9/j1-live.mjs`; if CONNACK still
times out, look at `journalctl --user -u vitals-server` around 16:03.

### Q9-4 · ops · oci-arm went offline during the run (ssh and HTTPS timed out, Tailscale ping 100 % loss) from about 15:05 IST. Status: fixed: same incident as Q8-06; memory caps (E32, 7a92bb3) and the cause (E34, 51cf6be: idle person workers spinning on Node 24's shared Web Locks; per-thread lock manager, Node 26 pinned)
Not caused by a request we can see: the last calls were MQTT publishes of three heart-rate events and a status read. Worth a
look at the host (memory: Q8 and Q9 had several persons open at once; docs/wp/E25.md measured about 140 MiB RSS for one open person).

The sync groups the QA browser profiles created on the oci-arm relay stay there (removing relay owners needs the admin
token, which QA does not use); they hold only synthetic data.

## v0.4 · Q8 (website + server journeys against oci-arm, 2026-10-03)

| ID | Severity | Finding | Repro | Pointer | Status |
|---|---|---|---|---|---|
| Q8-01 | high | `vitals-server keys …`, `siwc import/login/status/logout` and `agent-token …` (docs/SERVER.md "Admin CLI", the owner's migration step 6) were wired only into `vitals-companion`; `vitals-server` printed its help instead. The ChatGPT move and the key move could not be done on oci-arm as documented. | `ssh vitals-server 'node ~/vitals-server/current/bin/vitals-server.mjs keys list <person>'` → help text (J2) | `packages/companion/src/home/serverCli.ts` | **fixed** (merged 1939955; `serverMain` runs `runServerAiCli` first, on the server's `dataDir`; help lists them); test `home/cliWiring.test.ts`. Deployed; Q8 J2 25/25 on oci-arm |
| Q8-02 | medium | A token revoked with `vitals-server devices revoke` kept working on the running server for 20 s (until the next 60 s `lastSeenAt` flush rebuilt the token index); an agent token made with `agent-token create` was unknown to the running server until such a rebuild (on an idle server: until restart). | J7: CLI revoke, then poll `/v1/pair/status` → 401 only after 20 s | `packages/companion/src/home/devices.ts` `loadIndex` | **fixed** (merged 1939955; index rebuilt when any `devices.json` changes size or time); test `home/cliWiring.test.ts`. Deployed; Q8 J7 33/33 on oci-arm |
| Q8-03 | low | The server has no base-URL override for `nim`/`opencode-zen` (only tests pass `upstreams`), so a scripted stand-in cannot be run behind the deployed server. The Coach journeys with the stand-in ran against this branch's server on this PC instead (J3). | — | `packages/companion/src/proxy.ts` `UPSTREAMS`, `server.ts` `upstreams` option | open (low, test-only need; a `server.json` `upstreams` entry for QA would be the smallest change). Not needed for the release: J3 ran on a local server copy |
| Q8-04 | medium | A refused NVIDIA key is not named as such. NVIDIA lists models without checking the key, so "Load the model list" says "80 models listed" and the server's probe says `ready: true` with a fake key; Test connection then shows "The AI service answered with an error. Try again in a moment." (upstream 401/403/410 all map to `upstream_error`). Trying again will not help; the person should replace the key. | J2 with a fake `nvapi-…` key | `packages/companion/src/providers.ts` (probe, upstream mapping), `src/features/settings/ai/ServerProviders.tsx` `serverErrorText` | **fixed** (E33 9be38ef: upstream 401/403 → `key_refused`, the screen says the provider refused the key on your server; tests `providers.keyRefused.test.ts`, `serverErrorText.test.ts`). Q8 J2 25/25 on oci-arm |
| Q8-05 | medium | A Coach error sentence still named the Companion ("…use the Vitals Companion or another provider.", shown when a provider does not answer a web page); the guard scanned only `src/features` and `src/app`. | grep `dist/` (J6) | `src/ai/coach/adapter.ts` `COACH_TEXT.cors` | **fixed** on wp/Q8 (same advice as Settings: a provider through your server); guard now scans `src/ai/**` too |
| Q8-06 | blocker (ops) | oci-arm froze at 15:00:41 IST: the last server log line is Q8's J5 person "opened in 9176 ms" (a slow open), then no tailnet reply, ssh or :8443 until the host was rebooted at about 15:47 (not by Q8). At that time several person workers were open: Q8 had created 11 `q8-` persons over reruns (about 5 with sync groups), and another package's person had a broker login. Each worker is about 100–140 MiB; R18 §6 recorded swap 99 % used before. After the reboot: 11.9 GB RAM, swap empty. The cause is not confirmed (no kernel log access). | — | `packages/companion/src/home/workers.ts` (`IDLE_CLOSE_MS` 15 min, no cap on open persons) | **fixed**: cap of 4 open persons, worker heap limits, request timeouts and unit memory limits (E32, 7a92bb3); the cause (E34, 51cf6be): on Node 24 every person worker's pending Web Lock woke the others, three open persons saturated the CPU and native memory grew 17–45 MB/s; each worker now has its own lock manager and the deploy pins Node 26.10.0. Proof on the real service: 3/3 runs, `today_get` 32 ms, growth ≤ 123 MB per run (`qa/results/E34-mem-remote-real.json`) |
| Q8-07 | low | Pairing, device and MQTT routes answer 401 with the message "Pair this device with the server first" instead of the §14.3 sentence; the website maps by code, so the screen is right. | J7 | `packages/companion/src/home/home.ts` | open (low; the screen is right) |
| Q8-08 | low | QA sync groups stay on the relay after `persons remove` (`ownerCount` went from 9 to 23 over the day, also from other packages); the data is encrypted and unreadable to the server, but it is never cleaned up. | `/health` `ownerCount` | relay owner store | open (low; known limitation of v0.4.0: 37 relay owners on oci-arm at the Q11 check, synthetic data only); all 18 `q8-` persons were removed (no directory left) |
| Q8-09 | low | Settings › Server code help names `vitals-server devices code`; the docs and `--help` use `pair code` (both work). | — | `src/features/settings/server/copy.ts` `codeHelp` | open (low; both commands work) |
| Q8-10 | medium | The first `log_steps` call over MCP right after the person's worker opened hung until the MCP client's 60 s timeout in 2 of 5 J5 runs (15:00 IST, the person had opened in 9.2 s, followed by the host freeze; 15:59 IST, opened in 1.1 s). In the other runs the same call applied in milliseconds. `today_get` just before it answered. | `node qa/scripts/Q8/j5-agents.mjs` (intermittent) | `packages/companion/src/home/aiMount.ts` `agentCall`, `personProgram.ts` (a first write before the group's documents arrive, I3 open item) | **fixed** with Q8-06 (E34, 51cf6be: the hang was a starved worker on Node 24). Guard tests `home/firstWrite.test.ts` (E33); Q8 J5 20/20 on oci-arm after the deploy |

## v0.4 · Q11 (release gate and acceptance walk, 2026-10-03)

Build: `wp/Q11` (main after E34 and 5f596b9). Q6 visual pass of the screens changed since Q10 with
`qa/scripts/Q10/srv-visual.mjs` (local server, preview :5288, https proxy :5289), 390/768/1440 px, light and dark;
evidence `qa/results/Q6/shots.json` (`srv-*` entries), `qa/screenshots/Q6/srv-*`, `qa/results/Q10-srv-seed.json`.

| ID | Severity | What | Repro | Pointer | Status |
|---|---|---|---|---|---|
| Q11-01 | medium | Coach at 390 px still scrolled sideways by 24 px with a correction proposal: the composer's grid track took the min-content width of a long prompt chip ("The plan assumed 7000 steps; J-Style 2301 measured …"), so the send key was cut off at the right edge | server profile with a staged Coach correction → /coach at 390 px | `src/features/living/components/coachComposer.css` `.lv-composer` | **fixed** (dc03a61): one `minmax(0, 1fr)` column, chips can shrink and ellipsise; test `coach/__tests__/composerOverflow.test.ts`; srv-coach 390 light/dark 0 px |
| Q11-02 | low | The revoke dialog for an agent key on Settings › Server was titled "Remove QA Claude Code from your server?" above "Revoke key" | Settings › Server › Devices › Revoke on an agent key | `src/features/settings/server/ServerSection.tsx`, `copy.ts` | **fixed** (e1d6c40): "Revoke the agent key QA Claude Code?"; test in `ServerSection.test.tsx` |
| Q11-03 | medium | The Devices card's "today" line showed raw metric ids: "vendor: bp_sys_estimate 1 · vendor: bp_dia_estimate 1 · vendor: vascular_age 1" | MQTT stream with vendor metrics → Settings › Devices | `src/features/settings/devices/copy.ts` `streamName` | **fixed** (ea77a9a): plain names, unknown keys with spaces; test `copy.test.ts` |
| Q11-04 | low | The same card mixed "Oct 3, 07:28 PM" (last event, last connected) with "19:28" (battery line) | same | `src/features/settings/devices/MqttCard.tsx` `when` | **fixed** (ea77a9a): the card uses the battery line's `whenText` ("19:28", "yesterday 19:28", "28 Sep 19:28") |
| Q11-05 | script | `qa/scripts/Q6/seed-full.mjs` waited for "Mark lunch as planned", which a plan day without a lunch slot does not offer | seed on a day whose plan has other meal names | `qa/scripts/Q6/seed-full.mjs` | **fixed** (c27d123): marks the first two meals offered |
| Q11-08 | script | Q3 J6's sync leg timed out waiting for the 24 words: the oci-arm server (home role since v0.4) answers browsers only from `https://vitals.creative.desi`, so a page on `http://127.0.0.1:5287` was refused by CORS, and on the mapped origin by Chrome's Local Network Access check. The app said so correctly ("No answer from that address") | `BASE=http://127.0.0.1:5287 node qa/scripts/Q3/j6-settings.mjs` | `qa/scripts/Q3/lib.mjs` `fresh`, `j6-settings.mjs` | **fixed** (script): `fresh(vp, { site })` serves the local build under the allowed origin (as Q8/Q9 do), the shared launch has the brief's LNA flags; J6 72/72 re-run alone |
| Q11-06 | note | `srv-progress-corrected` at 768/1440 px reports 15–16 "overlaps": every one is the inline link "sleep index" or "sleep regularity" wrapping across two lines in the "more:" list, whose bounding box spans the line; nothing overlaps on screen (checked in the screenshots) | — | `qa/scripts/Q6/measure.mjs` overlap check | no change (harness false positive, as in Q10's shots) |
| Q11-07 | note | Set-aside (dead-letter) reasons on the Devices card are not in this pass's shots: the seeded stream has no rejected events. They were shot by Q9 (`qa/screenshots/Q9-see-why-1440.png`) and tested in `MqttCard.test.tsx` | — | — | covered elsewhere |

