# Planner domain layer (`src/engine/planner/domain`) — WP-P

Integrates the engine-agnostic optimiser (`../optim`, dossier 18) with the Vitals engine (MODEL_SPEC §10): lever and
building-block registry, skeleton grammar, decoder/repair to the engine `Schedule`, the `PlanModel` that calls
`runEngine` in planner mode, goal construction from the ranked list, explanations and the result assembly. The worker
binding lives in `src/workers/planner*.ts` (the only place worker globals are used).

## Planner v2: the plan ladder (docs/PLANNER_V2_SPEC.md, 2026-10-01)

```ts
import { planLadder, resumeLadder, hasCheckpoint, discardCheckpoint, replan, cancelPlanning } from '@/workers/plannerClient';
import { runLadderPlanner, toV1Result, toV1Progress } from '@/engine/planner';   // Node / tests: in-thread
const r: PlannerResultV2 = await planLadder(request, { onProgress, signal, tier: 'S' | 'M' | 'L' | 'X', ideal: true, limitCosts: true });
```

- **Result** (`PlannerResultV2`, types.ts "Planner v2"): `rungs.hard | medium | easy` (`RungPlan`: everything a v1 option carried,
  Hard-relative fields, `genome`, composed `sessions` with a training profile, and a `summary: RungSummary` — title, measurable
  subtitle, `difficulty` (seven burdens, D), `outcomes` (holdout P50, P10-P90 band, verdict, time to target per rung, vs Hard),
  weekly training minutes, mean eating window, hunger, fasting verdict, `bindingLimits`, `equipment` (things to buy), safety);
  `ladder` (`collapsed[]` with reason and sentence for every missing rung, distinctness `checks`, the attainment-difficulty
  `frontier`); `ideal` (`IdealPlanV2`: practical limits removed, safety and opt-ins kept, never startable; `relaxed`, advised-only
  items, `limitCosts` with the "Adopt some of these limits" patch, `gapVsHard`, `interactionRemainder`, `nothingBinds`);
  `convergence[]`; provenance with `plannerVersion: 2`, tier, holdout gap and difficulty weights.
- **Pipeline** (`ladderPlanner.ts`): calibration probes → one optimiser run with the difficulty axis (race, ε-lexicographic stages,
  D-binned QD archive, Easy/Medium ε-constraint solves, selection-ensemble chance constraints, holdout-ensemble numbers;
  `optim/README.md`) → time to target (R-TTT routes; per rung: own crossing, else `rungReach` — the route family at the intensity α whose
  12-week D fits the rung (≤ 6 bisection steps), clamped Easy ≥ Medium ≥ Hard ≥ fastest-safe; own-pace extrapolation only without a route family,
  never shorter than a harder rung) → one fasting-rival search shared by all rungs (an easier rung's rival that only loses on
  effort is reported as `difficulty`) → rung assembly (equipment composition before the Simulator-mode run) → the Ideal
  (`EvalVariant { kind: 'ideal' }` = `idealRequest`, 60 % of the P6 share, warm-started from the rungs) and one shadow-price run
  per binding limit group (`{ kind: 'limit', group }` = `relaxGroup`, ≤ 4 groups on S/M).
- **Tier X** (desktop, explicit action): checkpoints in IndexedDB (`src/workers/planner.checkpoints.ts`, key
  `checkpointKeyOf(request)`), `resumeLadder(key)`, `hasCheckpoint(request)` (or `{ stale: true }` for an older goal set),
  a Web Lock while running, up to 16 evaluators.
- **v1 compatibility** (§9.6, removed in 0.3.0): `planRegimes` / `runDomainPlanner` return the v1 `PlannerResult` with options =
  rungs in order and FIXED ids (hard 'A', medium 'B', easy 'C'), the v2 result attached as `v2`; `toV1Result` / `toV1Progress`
  (compat.ts) make the same views for the stores and commands that still hold v1 results. No user-visible text uses A/B/C.
- **Re-plan** (§7): `replan(req)` (worker client, in the engine worker) → `domain/replan.ts`; see "Re-plan (living plan)" below.

## Public API for the Planner UI (v1, kept for the deprecated wrapper)

### 1. The call (browser, main thread)

```ts
import { planRegimes, cancelPlanning } from '@/workers/plannerClient';
import type { PlannerRequest, PlannerResult, PlannerProgressInfo } from '@/engine/planner';

const ctrl = new AbortController();
const result: PlannerResult = await planRegimes(request, {
  onProgress: (p: PlannerProgressInfo) => { /* ≤ 4 Hz; p.fraction 0..1, p.stage, p.provisional (anytime options) */ },
  signal: ctrl.signal,     // abort = cooperative stop: resolves with the best result so far (result.complete === false)
  // tier?: 'S' | 'M' | 'L'  (default: chosen from device calibration)   workers?: number (default from hardwareConcurrency)
});
ctrl.abort();              // anytime stop
cancelPlanning();          // hard stop: terminates all planner workers; the pending promise rejects with AbortError
```

- Pool: `N = clamp(hardwareConcurrency − 1, 1, 8)` evaluator workers (≤ 3 on phones) + the existing engine worker as
  coordinator. Results are bitwise identical for any worker count (same browser engine).
- Budget: one calibration simulation per worker → ms per evaluation → tier S (≈ 3k EU), M (≈ 12k) or L (≈ 40k) for a
  ≈ 10 s desktop / 20 s phone target (`budgetForDevice`). Override with `request.budget` or `options.tier`.
- Progress: `stage` (`S0`…`S6`, `ttt` for time-to-target runs), `fraction`, `euUsed/euBudget`, `score` (utility of
  the current best plan, ≈ 0..1, null before one exists), and from the end of the first priority stage
  `provisional: [{ structureId, name, percentOfAchievable[], schedule }]` (option A first; A/B/C from the start of the
  diversity stage S4 — after the priority stages, ≈ 50-60 % of the budget — refreshed every quarter of the S4 budget,
  never fewer options than before; release check 2026-10-01). Provisional schedules open unchanged in the Simulator.
  Only pure progress ticks are throttled (≤ 4 Hz): an event whose option set is new or changed is always delivered
  (**`optionsChanged: true`**), once A/B/C exist every later event keeps carrying all of them, and the late stages
  (`ttt`, `S6` option assembly) repeat the last options instead of an empty list (`progress.ts`, QA item 8). Verified
  through `planRegimes` in the browser (31 evaluators, request (a), tier S, 10.5 s): B at 53 %, C at 64 %.

Node / tests (no workers): `runDomainPlanner(request, { onProgress, signal })` from `@/engine/planner`.

### 2. `PlannerRequest` (`types.ts`)

| Field | Type | Notes |
|---|---|---|
| `profile` | `PersonProfile` | engine profile (Your body + habits) |
| `goals` | `RankedGoal[]` (1-6, most important first) | `{ metric: MetricId, direction: 'target' \| 'maximise' \| 'minimise', target?, targetKind?: 'absolute' \| 'change', functional?: 'end' \| 'mean', tolerance? }` — metric must be goal-eligible (`SERIES[i].goal !== 'none'`). Goals are honoured lexicographically with tolerances (goal 1 may lose ≤ 5 % of its achievable range, goal 2 ≤ 10 %, others ≤ 15 %; × 0.5/1/2 by `strictness`). `scaleWeight` goals are evaluated on trend (tissue) weight, never raw scale weight (18 §4.5). |
| `horizonDays` | 28-183 | |
| `startDate?` | ISO date | default profile start date |
| `constraints?` | `PracticalConstraints` | training days/week range, allowed weekdays, training time, max session min, cardio days range and modality, eating window earliest/latest, meals/day range, steps range, `excludedLevers` (lever or block ids, e.g. `'waterFast'`, `'fastDay24'`, `'refeedDay'`, `'L7'`, `'B2'`), `fasting: 'none'`, `prefersFasting`, `sleepFixed`, `hungerTolerance`, and the user's own limits **`maxFastHours`** (longest acceptable fast, meal to meal; only lowers the tier limit), **`proteinFloorGPerKg`** (g/kg reference weight) and **`carbFloorGPerDay`** (net carbohydrate). The older form — `safety.plannerLocks` entries `max-fast` / `protein-floor` / `carb-floor` tagged `reasons: [{ rule: 'user' }]` — is still accepted and gives the same caps (tested); the stricter value always wins. |
| `safety?` | `PlannerSafetyInput` | pass the onboarding `ScreeningOutcome` plus the user's `SafetyOptIns` as `{ ...outcome, optIns }` — the shape is re-declared structurally here (`plannerAccess`, `mode`, `restrictions`, `plannerLocks: {id, value?}[]`, `fasting: {maxFastHours, maxEligibleTier, optInTiers, shortWindowAvailable}`, `flags`, `optIns: {fastingTier, shortEatingWindow, levers}`). Profile-derived 17 §2 bounds are applied even without it; the stricter value always wins. |
| `strictness?` | `'strict' \| 'balanced' \| 'flexible'` | |
| `seed?`, `budget?` | | reproducibility / `{ tier, totalEU, ensembleSize }` |

### 3. `PlannerResult` (`types.ts`)

- `status`: `'ok'` · `'noSafePlan'` (with `noSafePlanReasons[]`) · `'blocked'` (safety gate; `message`) · `'invalid'` (request problems in `message`).
- `options: PlanOption[]` (0-3, A = best under your priorities). Each option:
  `schedule` (engine `Schedule`, opens in the Simulator), `simulation` (nominal `SimulationResult`, all daily series),
  `scorecard: GoalScore[]` (start, value, change, target, **% of achievable**, % of target, met, **`verdict`**
  (`'reached' | 'kept' | 'notReached' | null` — one word for scorecard, titles and tooltips), **`keepTolerance`** (keep
  goals: a tenth of the keep scale, ≥ 0.05; a keep goal within it is `met`/'kept' and shows 100 % of achievable), cost vs
  A, P10/P50/P90 band and P(target met) when the ensemble ran), `hunger` (mean/peak index, days above tolerance, adherence %, rating
  and text), `complexity`, `phases: PhaseExplanation[]` (measurable summary + plain-language "why"), `explanation[]`,
  `notes[]` (conflict/synergy lines touching this option), `safetyNotes[]` (plain text) and **`safetyItems[]`**
  (`{ text, severity: 'info' | 'caution' | 'danger', rule? }`, danger first; includes the simulation's caution/danger
  warnings), **`fasting`** (`FastingVerdict` `{ used, kind, longestFastH, text, rival? }`: why a fast was or was not used;
  an option without a fast, when fasting was offered, carries `rival` — the plan with a fast it was compared with and
  why that one lost, see "Fasting explanations" below), **`bands`** (`{ draws, series }`: daily
  P10/P50/P90, index 0 = t = 0, for the goal metrics plus scale weight, fat mass, lean tissue, body fat and hunger, from
  the robustness ensemble; change-from-baseline metrics are banded on the change), `bindingConstraints[]`,
  `confidence` (lowest evidence grade), `contributions` (top lever ablations), `aBeatsThisShare`.
  (`safetyItems`, `fasting`, `bands` and progress `score` are always filled; they are optional in the types only so
  older fixtures keep compiling.) Phase summaries state energy as "% of your maintenance with this plan's training and
  steps" (ruling R-MAINT) with the resolved kcal from the option's own run, and name phases by measurable composition
  ("Deficit 13 % · protein 2.1 g/kg", "Surplus 4 % · protein 1.8 g/kg"); option names follow the true balance and read
  the % exactly as the phase names do (the option's own run, merged phases, same rounding), so a title never says +5 %
  where its phase says 4 %.
  `contributions[]` also carry **`deltaGoal1Metric`** (plan − variant in goal 1's units) and **`safe`** (the neutralised
  variant met every margin; only safe variants feed the "What moves goal 1 most" sentence).
- The option's `simulation` is run in the Simulator's own mode (`simulate`: warnings, hormone extras), so its curves and
  its caution/danger warnings (listed in `safetyItems` with their `rule`) are exactly what the Simulator shows
  (R-PLAN-SAFETY).
- `feasibility: GoalFeasibility[]` per goal: `attainable | unattainable | attainableAloneNotJointly | metAtBaseline |
  notImprovable | directional`, best achievable value, nearest attainable target, and for unattainable targets the
  **time-to-target** (`requiredWeeks`) with a plain-language `text`. Ruling R-TTT: for body-composition goals (fat mass,
  body fat %, waist, visceral/liver fat, trend weight; skeletal muscle, lean tissue, weight gain) it comes from the
  fastest-safe-rate search `targetReach` (section 5) — the function the Goals screen calls before the run — and the
  answer is attached as **`reach`**; `searchedWeeks` is then 104. Other metrics keep the extended-horizon search
  (T_ext = min(max(2T, T + 56), 365) days, then 365 days warm-started from the best plan; **`estimatedWeeks`** is an
  extrapolation labelled as such). Beyond two years no week count is claimed: **`beyondTwoYears`** and "more than two
  years at the safe rate". **`beyondSafetyLimits`**: the target lies past the body-fat floor, BMI 19 or the 20 %
  total-loss cap of one plan (no horizon helps). A "keep" goal is reported by option A's verdict ("kept (option A
  ±0.0 kg; kept means within 0.12 kg of the start)" — status `attainable`), never "not reachable" when it is held.
- `relations: string[]` — goal conflict/synergy messages (18 §4.13).
- **`fasting: { offered, reason, servedGoal, tierMaxH }`** — whether fasting levers were considered at all, and why; the
  goal fasting would serve (index) and the longest fast the tiers and the user's limits allow (see below).
- `stubModules: string[]` — physiology modules still running as stubs (their outputs are placeholders; show a banner).
- `provenance` (seed, tier, EU, registry hash, engine and library versions).

### 4. Other exports (catalogue / explanations)

`BLOCKS` (13 §4C B0-B22 as measurable data), `LEVERS` (18 §4.4.1 registry incl. 21 §4J L1-L19 with
`plannerUsable`/`unsupportedReason`), `compileSafetyCaps`, `HC` (17 §2.5 constants), `validatePlan` (independent
validator), `goalEligibleMetrics()`, `keepTolerance`, `EA_FLOOR` / `eaFloorMargin` (R-EA-PLANNER), and the reach API
of section 5 (`estimateTargets`, `targetReach`, `fastestSafeRoute`, `routeKind`, `beyondSafetyLimits`,
`ROUTE_MAX_WEEKS`, `clearReachCache`).

### 5. Fastest-safe-rate search (`reach.ts`, ruling R-TTT) — the Goals screen's pre-run estimate

```ts
import { estimateTargetsAsync } from '@/workers/plannerClient';          // browser: off the main thread (planner.reach.worker.ts)
import { estimateTargets, targetReach, type TargetReach } from '@/engine/planner';   // Node / tests: synchronous
const est: TargetReach[] = await estimateTargetsAsync(request);  // per goal, index-aligned with request.goals (same request as the run)
// est[i]: { supported, kind: 'loss'|'gain', start, target, valueAtHorizon, changeAtHorizon, reachableInHorizon,
//           weeks (to the target; null past two years or a floor), beyondTwoYears, beyondSafetyLimits, ratePerWeek, text }
```

One function for both call sites: the pre-run hint ("reachable in this horizon: ≈ X"; "Extend to N weeks") and the
planner's time-to-target (`feasibility[i].requiredWeeks`, `.reach`, the sentence) — they cannot disagree. The route is a
canonical plan on the real engine (planner mode): loss — deficit blocks of ≤ 12 weeks with a 1-week maintenance break
(HC-E7), the planner's resistance training, protein at the block's top, no cardio beyond the user's minimum, steps at
the top of the user's range; gain — the productive training maximum with the largest allowed surplus. The energy of
every 4-week check-in block is steered (≤ 5 engine passes of ≤ 2 years) to the edge of the planner's own margins with
its nominal headroom: kcal floor, deficit cap (and the user's), energy availability ≥ 30 kcal/kg FFM on training days in
a deficit (R-EA-PLANNER), rate of loss (HC-E5), fat-store limit (W-13-ALPERT); for gains the lean-gain rate by training
status, 0.5 %BW/week, HC-E8 and W-S03. State floors (20 % total loss, BMI 19 / the BMI caution, the body-fat floor / its
caution) end the route. Crossing uses the planner's end functional (7-day mean), so "reachable in the horizon" and
"attainable" mean the same thing; the main search is warm-started from the same canonical plans (`canonicalSeeds`).
Cost ≈ 0.1-0.3 s per route (Node; ≈ 1 s for the first call in a dev-mode browser worker), cached per (profile, limits,
safety, goal metric + kind) in the long-lived reach worker: editing only the target amount or the horizon is a lookup
(measured 0-1 ms). Reproduction (88-kg man, 3 sessions): 10 kg of fat → 26 weeks (≈ 5.1 kg in 12 weeks, ≈ 0.5 %BW a
week); +2 kg skeletal muscle → 97 weeks; +2 kg lean tissue → 54 weeks; +8 kg skeletal muscle → more than two years;
−30 kg fat → past the body-fat floor.

## Rules the layer enforces

- R-EA-PLANNER (release check 2026-10-01): the energy-availability floor is dossier 17's 30 kcal/kg FFM (HC-E4/W-E08),
  held with ≈ 1 kcal of headroom (0.25 margin units: ≈ 31) and only where the Simulator's EA rules apply — training in
  the trailing week and a deficit > 5 % — read from the engine's own W-E07 margin series (`eaFloorMargin`; margin 2
  HC-E4 at P90 with the calibrated cushion, margin 12 on the nominal run, guarding W-E08 and W-E20). 35 is the "adequate"
  band edge, not a constraint: a fat-loss plan for someone who trains may sit at 30-35 for weeks and then carries W-E07
  ("Staying near 30 for weeks …") as a listed caution. For the 88-kg man this lifts the deficit from ≈ 6-11 % to
  18-25 % (≈ 0.45-0.5 %BW a week; the 25 % deficit cap binds before the 0.75 % rate cap). Since R-FAST-GATE the engine's
  EA_7 is the mean of the last seven non-fast days (searched back through 28 days) when a planned fast-event day lies in
  the trailing week, and is not evaluated on fast-event days — a fast no longer drags the eating days below the floor.
- R-PLAN-SAFETY: finalists are re-run in the Simulator's mode inside the S5 validator; a plan may carry only the cautions
  its regime brings by choice (opted-in fasting tiers W-F02/F03/F10/F13, W-20-FAST-LEAN; very-low-carbohydrate W-M09/M24;
  W-E07 in a deficit with training, R-EA-PLANNER; women's W-E18 in any deficit with training; screening context W-P*,
  W-U02) and they are listed in `safetyItems`; any other caution or danger rejects the finalist. The search avoids them
  with margins at the Simulator's thresholds plus headroom (`model.ts` `MARGIN_IDS` 11-15: `gainRate`, `W-E07` slot =
  the EA floor above, `W-M06` fat ≥ 15 %E and 30 g, `W-05-KETO-FED` proxy, `W-S03` surplus ≤ 5 % at WHtR ≥ 0.5 — judged
  on the nominal run with 0.25 units of headroom, not at P90), input-side headroom (protein ≤ 2.9 g/kg FFM against W-M04's 3.1; fat
  ≥ 17 %E planned; sodium 2.5 g on fast-touched days, ≥ 3 g on very-low-carbohydrate days and ≥ 2 g on B11 low-energy
  days (W-M12: with protein kept up they are very low in carbohydrate; exposed once R-EA-PLANNER made B11 feasible); surplus phases ≤ 104.5 %
  at WHtR ≥ 0.5), and the calibrated prior cushion now uses only probes near each bound (lower median).
- R-T4CAP: HC-F2 as the engine's `spacingViolation` (eating gap 24 h, 7 d around a T3 fast, 28 d around a T4 fast; counts
  by resume time) and the 108 h / 7 calendar days cap over T0-T3 fasts only; a single expert-tier fast follows its own
  tier rule and locked refeed days. Repair (`firstSpacingViolation`), the independent validator and the decoder (24-h
  fasts give way to a multi-day fast) agree; `fastSpacing.test.ts` checks the planner against the engine on random
  sequences.
- Prescriptions (QA item 9): resistance training in the productive range for the ranked goals (`rtPrescription`: muscle
  goals ≥ 2-3 sessions and 10-20 hard sets per muscle group a week; strength ≥ 3 sessions, 6-16 sets at ≈ 82 % 1RM; fat
  loss keeps ≥ 2 sessions and ≥ 6 sets), protein ≥ 1.6 g/kg with training and a muscle goal or an energy-changing block,
  surplus ≤ +500 kcal/d (11 §9), gain rate ≤ 0.5 %BW/wk (≤ 0.25 % for > 3 training years, 13 B21), a small training-time
  regulariser so cardio and steps are kept only where they help, meals on a 15-minute grid ≥ 3 h apart, and sessions
  placed on the grid with no meal inside them and, where possible, a meal before and after.
- Goals: "keep X" (a target of zero change) is a `keep` goal that stays active when the baseline already keeps it (it
  was skipped as "met at baseline"); an unreached target's floor tolerance is δ of the achievable range (not of the
  distance to the target); a reached target is kept by option A, and alternatives may fall δ_k of the distance short of
  it (`optim/goals.ts` `setFloorFrom`; before, Δ = 0 left no alternative when one plan family alone reached the target); floors never ask for more precision than the ensemble can resolve (`minTolerance` = ½ of the
  P10-P90 half-width measured on the probe plans).
- Blocks added to the 13 §4C library: **B23** small surplus with training (103-110 %) and **B24** mild continuous deficit
  (85-95 %) — the grammar had nothing between maintenance and a 10-20 % surplus or a 15-25 % deficit.

- Safety: three layers (18 §4.4.6) — tier/consent gating at enumeration, decoder clamps + `repair` (17 HC-E2, HC-M1…M12,
  HC-F1…F5, HC-X1…X5, logged as `RepairEntry`), and an independent validator (`validate.ts`, separate code path) on every
  returned plan; state-space bounds (HC-E1/E3/E4/E5/E6/E8, HC-P4/P5, hunger cap) are margins on the simulated trajectory.
- No diet brand names; blocks are energy %, g/kg, timing and durations. Sequencing earns no credit (MODEL_SPEC R-SEQ);
  explanations never claim it. Fasting levers follow the R-FAST-GATE gate below.
- Fasting (ruling 2026-09-30 18:10): a fast event's `durationH` is meal to meal (last intake at `startH`, first intake
  `durationH` later). Fasts at a tier the user opted into are governed by the tier rules — ≤ 24 h default (T1), 24-72 h
  opt-in (T2/T3), 3-7 days expert mode with attestation (T4, `safety.expertMode` + `optIns.fastingTier: 'T4'`; the UI
  keeps it off), > 7 days never — with spacing (T1 ≤ 3/wk; T2 ≤ 2-3/wk; 48 h ≤ 1 per 14 d; 72 h ≤ 1 per 30 d; T4 ≤ 1 per
  12 weeks), locked refeed/recovery days and the cumulative cap (108 h per 7 d over T0-T3 fasts; a T4 fast is alone in its
  28-day window with 28 days of eating on both sides, ruling R-T4CAP). The rolling 7-day deficit cap and kcal floor
  apply to non-fast days; every 28-day window must meet the kcal floor (planned-energy proxies in repair/validator; the engine's own margins with the same semantics are authoritative).
- **Fasting gate (ruling R-FAST-GATE, 2026-10-01; PLANNER_V2_SPEC §3.1; `context.ts` `fastingGate`).** Zero-intake
  levers enter the structure set when fasting is not refused, the effective longest fast (tier cap ∩ the user's longest
  fast ∩ locks) is ≥ 24 h, a fasting tier is held — the default 24-h tier counts, so an autophagy- or ketosis-first user
  without an opt-in keeps the 24-h fasts; opt-ins only widen which fasts (48-72 h, zero days) are built — a goal exists
  that fasting can serve (`FASTING_SERVED`: transient markers, fat loss as a deficit-delivery pattern, glycaemia,
  triglycerides / blood pressure, hunger and adherence; with "I prefer fasting" the top goal), and no muscle goal ranks
  above that goal. The old "never with a muscle goal in the top two" rule (no dossier source) is gone. Offered is not
  used: at equal weekly energy a fast gives the same fat loss with a lean cost and higher hunger peaks, so fat-loss-first
  plans keep the no-fast result by search (golden a, diversity r1) and say why. The 24-h fast overlay may sit in B0, B1,
  B2, B3, B6, B22 and B24 (`OVERLAY_HOSTS`; was B1/B3/B6): the 7-day cap and floor are on non-fast days (ruling 18:10),
  the decoder raises the host phase's eating days so the 28-day mean keeps the intake floor, and the 28-day tissue-rate
  cap and the tier rules govern the fast days. Surplus phases never carry fasts; refeed days stay deficit-only and out of
  B2. B12 patterns exist when the served goal is fat loss or a transient marker. `safety.expertMode` now reaches the
  planner from the app (`features/planner/request.ts` `toSafetyInput`; the app flag stays off).
  Two guards keep fasts from being a loophole (they are evaluated on non-fast days only): the planner margin `HC-E3.28`
  (`MARGIN_IDS` 26) holds the 28-day mean deficit, fast days included, within the deficit cap whenever a fast-event day
  lies in the trailing 28 days (20 §4C: a fast is a delivery pattern of the same deficit), and multi-day events are not
  enumerated for plans made only of B11 phases (two low-energy days a week leave no room for the span and its locked
  recovery, so those skeletons decoded to no fast). The best plan with a fast (`groupBest.fast`) is offered to the S5
  shortlist when it is safe and meets the relaxed floors (the archive can lose it). `placeTraining` searches the whole
  waking day when no meal-free slot exists near the preferred time (resistance training plus cardio inside a 6-h window
  sat over a meal).
- **Fasting explanations (R-FAST-GATE; PLANNER_V2_SPEC §3.6; `fastingExplain.ts`).** The optimiser keeps the best nominal
  plan that actually contains a fast (`PlannerProblem.group`, judged on the evaluated plan's features, since a
  skeleton's fast can fail to fit) as `groupBest.fast`. For an option without a fast the rival is option A's own plan
  with fasts added at the same weekly energy (its eating days raised by the energy the fasts remove; ≤ 4 nominal
  evaluations, the comparison dossier 20 makes) when A has no fast, else the search's best plan with a fast, else the
  closest fasting structures with A's genome. It is re-run in the Simulator's mode, validated, and (when otherwise safe)
  checked against the P90 chance constraint over the run's ensemble. Reasons, in precedence: `validator`, `safetyMargin`
  (EA states the value and day), `chance`, `goalLoss` (first goal, in priority order, whose level ⌊d̃/q_k⌋ differs;
  q_k = max(0.01, the goal's ensemble resolution)), `shortlist`, `noGoalGain`; an alternative (B, C) that the rival
  beats is explained by the rival's loss to option A, or `alternative` when A itself fasts. Deviations from the spec,
  reported to the orchestrator: the equal-energy twin is preferred over the search's best fasting plan (it answers "why
  not the same plan with a fast"); `shortlist` and `alternative` are added reasons; `kind` / `longestFastH` are optional
  in the type (always filled) so older fixtures compile. An option with a fast says what it buys (its "without the
  N-hour fasts" ablation, in the units of the goal fasting serves).
- VLED/PSMF blocks (13 B4/B5/B7/B17) stay simulate-only (V tier).

## Files

| File | Role |
|---|---|
| `types.ts` | `PlannerRequest`, `PlannerResult`, `PlanOption`, `GoalScore`, `GoalFeasibility`, `PlannerSafetyInput`, progress |
| `safety.ts` | 17 §2.5 constants (`HC`), `compileSafetyCaps` (profile ∩ screening outcome), fasting tiers |
| `registry/blocks.ts`, `registry/levers.ts` | 13 §4C B0-B22 and the 18 §4.4.1 lever registry (incl. 21 §4J L1-L19), registration check |
| `context.ts` | request compilation (practical constraints with defaults, goal classes, the R-FAST-GATE fasting gate) |
| `fastingExplain.ts` | fasting verdicts: the rival comparison of an option without a fast, what a fast buys (R-FAST-GATE) |
| `skeleton.ts` | `SkeletonStructure`, block grammar enumeration, gene layouts, prior order, structural moves, genome transfer |
| `decode.ts` | genome → plan → engine `Schedule` (check-in blocks, `energyReference: 'blockStart'`, fast events with locked recovery) |
| `repair.ts` | user constraints + 17 input-space rules, logged as `RepairEntry` |
| `validate.ts` | independent validator (separate code path) |
| `model.ts` | `EnginePlanModel` (`runEngine` planner mode, ensemble via `quantilesToParams`, margins, regulariser, cost) |
| `goalSpecs.ts`, `features.ts`, `explain.ts` | goal functionals, descriptors/Gower features/complexity, explanation templates |
| `reach.ts` | fastest-safe-rate search (R-TTT): canonical routes on the engine, `targetReach` / `estimateTargets`, warm-start seeds, `beyondSafetyLimits` |
| `evaluatorHost.ts`, `planner.ts` | evaluator side (per problem variant) and coordinator (`runDomainPlanner`) |
| `src/workers/planner.pool.ts` | port protocol (`attachEvaluator`, `EvaluatorPort`), pool size, budget tier |
| `src/workers/planner.coordinator.ts` | calibration, pooled evaluator, cancel / pause (runs in the engine worker) |
| `src/workers/planner.evaluator.worker.ts`, `src/workers/plannerClient.ts` | evaluator worker entry; main-thread `planRegimes` / `cancelPlanning` / `estimateTargetsAsync` |
| `src/workers/planner.reach.worker.ts` | fastest-safe-rate worker for the Goals screen's pre-run estimate (R-TTT) |

Engine-worker API (Comlink): `plan(request, ports, { tier?, totalEU?, mobile?, timeToTarget? }, onProgress?)`,
`cancelPlan()`, `pausePlan(paused)`. With no ports the planner evaluates inside the engine worker.

## Tests

`pnpm vitest run src/engine/planner src/workers` (≈ 3 min; the eight M-budget files — diversity r1-r3 and the golden
plans a-e — dominate and run in parallel). Golden-plan regression tests (`golden.*.test.ts`, requests in
`golden.requests.ts`, assertions in `golden.ts`) pin plan properties for the five owner requests: ≥ 2 distinct options,
independent validation, the Simulator agreeing with the plan's safety notes (R-PLAN-SAFETY), prescription ranges per
phase (true energy balance from the R-MAINT series, protein g/kg, sessions and hard sets per muscle group, eating
window, fasts only where ruled), meals on the 15-minute grid, sessions off meals, stable weekly rhythm, honest phase
texts, the priority order of the scorecard, label consistency (title % = phase %, one keep verdict), option A's loss rate
(request a: deficit ≥ 15 %, ≥ 0.4 %BW a week) and the time-to-target equal to the pre-run estimate, and determinism for
1 and 3 evaluators. Also: `ttt.test.ts` (R-TTT: the reproduction's 25-40 weeks from one function before and after the
run, +2 kg skeletal muscle finite at dossier 09 rates, past the body-fat floor, more than two years, the two-year cap of
the search text), `fastSpacing.test.ts` (R-T4CAP, property test against the engine), `progress.test.ts` and the pool test
(anytime A/B/C), plus decoder properties (18 §7.1.1-7.1.5, incl. opted-in 72-h and expert 3-7-day fasts),
safety fuzzing with the independent validator (§7.4.1; 1,500 random persons × goals × constraints × screening outcomes
in CI, 4 × 3,000 run locally), registry and 17-cap checks, worker-pool determinism for 1/2/4 evaluators (§7.3.7),
progress/anytime cancellation/pause, end-to-end runs on the real `runEngine` (assertions needing real physiology use
`itPhysio`, skipped while the modules they need are stubs), and the §7.5 overhead benchmark.

## Performance (this machine, 2026-10-02, shipped hybrid algorithm)

One evaluation of a 180-day plan: planner domain ≈ 2.6 ms, engine run ≈ 12 ms. Main search: the **hybrid** (`optim/hybrid.ts`,
default; `'v2'` selectable via `localStorage['vitals.dev.plannerAlgorithm']`): the frozen v1 search runs the tier budget and
its option A is Hard; the v2 pipeline builds Medium/Easy on top (QD + ladder + robust shares ≈ +37 % EU); the Ideal and the
limit costs run on top of that (`idealBudgetEU`). Why: on the held-out benchmark neither v2 alone nor a budget-neutral split
was non-inferior to v1 on goal-1 quality for full requests (docs/PLANNER_BENCHMARK.md). Full app runs (ladder, Ideal, limit
costs, time to target) on 8 evaluator threads: see the timing table in docs/PLANNER_BENCHMARK.md (tier M ≈ 25-35 s on the
reference requests, inside the ≈ 40 s interactive budget). The serial parts are the prior-cushion probes (≈ 150 runs), the
S5 validator's Simulator-mode run per finalist and the final options' Simulator-mode runs and bands.

## Diversity (real engine, tier M)

Three realistic requests return 2-3 distinct options (`diversity.r*.test.ts`). The fixes behind it: the S4 archive
re-ranks every S1-S3 record under the final comparator (it used to keep provisional cell winners only); S5 finalists
are pre-selected with half of D_min before near-duplicates fill the remaining slots; the nominal search keeps a
prior chance cushion on the physiology-sensitive margins, calibrated before the run as 1.25 × the P50−P10 spread of
12 probe plans (block defaults and the deficit/surplus corners; ≥ 0.25 units, ≤ 2; ≈ 150 extra runs), so finalists
pass the P90 chance constraint without the small S5 repair budget (the ensemble is judged on raw margins); structural
moves may swap a block while dropping an incompatible overlay; genome transfer maps segments by position; lever
families (fasts, refeeds) count in the Gower "block families" set; HC-E7 breaks follow the engine's trailing
7-day deficit definition.

## Known gaps

- Energy availability (R-EA-PLANNER): fat-loss plans for people who train now carry the Simulator's W-E07 caution
  (30-35 kcal/kg FFM for more than two weeks) as a listed item; the planner keeps the 30 floor. The 88-kg man: ≈ 4.7-5.0
  kg of fat in 12 weeks (route 5.1), 10 kg in ≈ 26 weeks.
- W-S03 (a surplus above 5 % with a waist-to-height ratio ≥ 0.5 is a caution) caps lean-gain surpluses at ≈ 4 % for
  such people; with the engine's lean-gain rates "+2 kg skeletal muscle" takes ≈ 97 weeks for the 88-kg man.
- The fastest-safe-rate route is a canonical plan, not an optimiser run: the search can occasionally beat it by a
  fraction (the feasibility text then says the route reaches the target "on its own"); options that also serve lower
  goals usually reach 90-95 % of the route's 12-week value.
- Training volume is held in the productive range by `rtPrescription` (dossier 09); inside it the engine's response to
  more sets is shallow, so the optimiser's choice there carries little weight.
- The W-05-KETO-FED guard matches the engine rule (R-FAST-GATE): not evaluated for people without diabetes (the rule
  does not apply to them); otherwise a proxy (daily mean BHB ≤ 2.5 mmol/L on eating days, ≤ 5 in the 72-h refeed phase
  after a fast); finalists are still checked against
  the Simulator's own run. Planned-energy proxies in repair and the validator use TDEE0; the R-MAINT-resolved intake is
  checked by the state-space and Simulator-warning margins.
- Options can be close variants when one lever dominates a goal (request c: all three use weekly refeed days, which
  lower hunger, the second-ranked goal).

Adaptive evaluator retirement (latency > 1.6 × calibration), Morris/OAT sensitivity, the realistic-adherence
projection and maintenance tail (18 §4.9, §4.5), tier-L SAA polish, counterfactual user-constraint relaxations,
horizon bisection for joint feasibility (18 §4.14.2/4) and "by week n" goal deadlines are not implemented. Intake's
per-run caches live in its constants (CONTRACT_REQUESTS 18:45); `engineModules.ts` adapts it until A2 moves them.

## Equipment-aware prescription (`equipment.ts`, PLANNER_V2_SPEC §8)

Reads `request.training` (E8 `TrainingProfile`, `PlannerRequestV2`). **Without it every hook is a no-op** (envelope
null, caps Infinity, 82 % 1RM kept, `equipmentFor` returns the schedule object unchanged), so v1 runs are bitwise as
before. E8 owns the composer, the envelope, the shopping list and the stimulus mapping (`docs/CATALOGUES.md`); this
module only puts them into planner terms.

| Export | What |
|---|---|
| `equipmentEnvelope(ctx, { ideal?, catalogue? }) → EquipmentBounds \| null` | §8.2 envelope: max effective sets per region per session, uncovered regions, best region, max %1RM and `heavyReachable` (≥ 80 %), cardio modalities, patterns. Rungs: owned ∪ access ∪ purchasable within the allowance; the Ideal and a shadow-price run relaxing `equipment` (`relaxedGroups`): full catalogue. Cached per context / request. |
| `equipmentSetsCap(ctx, sessions, loadPct?)`, `equipmentRegionCap(ctx, region, loadPct?)`, `equipmentHeavyOk(ctx)` | The P0 bounds. `skeleton.buildLayout` caps the `rt.sets` gene (weekly counted sets the best-equipped region can take); `decode.sessionsFor` writes min(uniform dose, region cap) per region (0 for a region nothing trains directly); `rtPrescription` keeps 82 % 1RM / heavy compound for strength goals only when `heavyOk`. |
| `equipmentFor(ctx, schedule, { ideal, goalDelta?, catalogue?, vo2max?, benefitTop? }) → Promise<{ schedule, sessions, required, optional, text, infeasible }>` | §8.3 composition + §8.5 shopping list (below). |
| `purchaseBurden(items)` | §8.4: 0.05 per required item with price tier > 0 (input to the difficulty's habit-distance component). |
| `toShoppingItemV2(ctx, e8Row, { ideal, required?, benefit? })` | E8 `ShoppingItem` → `ShoppingItemV2` (bundle in the additive `equipmentIds`, R3 price tier 0-4), with the plain sentence. |
| `goalSense`, `catalogueWeekday`, `effectiveFactor`, `vo2maxEstimate`, `stimulusContext`, `equipmentPhrase` | Helpers (planner weekday 0 = Monday → catalogue 0 = Sunday). |

**`equipmentFor`.** Training days are grouped into slots (weekday × session list); each slot's sessions become E8
prescriptions (counted sets × f_RIR·f_load·f_rest → effective sets, limited per region to the envelope; cardio keeps
modality, minutes and %VO2max) and are composed in order of first appearance with the sessions of the previous 14 days
as rotation history (`composeSession`, deterministic). The composed engine sessions (delivered counted sets, session
RIR / load / rest, `met` = the items' time-weighted MET via the additive `ResistanceSession.met?`, hybrid cardio parts)
replace the day's sessions back to back from the planned start: on a program copy per distinct composition (the first
reuses the program) or in the day's override when it already sets `exercise`. **Feasible** means: per region and
calendar week the delivered effective sets fall short of the target by at most max(10 %, 0.5 per session that trains the
region) and every cardio session reaches full equivalence credit; otherwise `infeasible` is a plain sentence. A rung
with a purchase allowance that is infeasible with what the person has retries with E8's best restoring bundle, which is
then its one `required` item; a rung without an allowance never requires a paid item (free household items may be
suggested); the Ideal requires the bundle E8 finds restores its dose and lists all items. Shopping rows are ranked by E8
(ΔU/(tier + 1), ΔU < 0.05 omitted, required first) on the planner's full targets, so items that would cover a region the
person cannot train yet are valued. With `goalDelta` the top 3 rows are re-run: benefit = goalDelta(with) −
goalDelta(without) per goal ("without": the rung as delivered, or what the person has now for the Ideal and the
required row); re-run optional rows that improve no goal in its direction are dropped. Texts: "Uses only what you
have.", "To make this plan work you'd need a long loop power band (adds 0.3 kg skeletal muscle).", "Worth buying: …",
"You could also use …", "Nothing you have trains the upper back directly, so the plan has less work for them.";
all pass `leak()`.

**Lead integration (rung assembly).** For each rung and the Ideal, after the plan is chosen and before the final
Simulator-mode run: `const eq = await equipmentFor(ctx, schedule, { ideal: kind === 'ideal', goalDelta })` with the
rung's (or Ideal's) own context; simulate and summarise `eq.schedule` (not the decoded one); `summary.equipment =
{ required: eq.required, optional: eq.optional, text: eq.text }`, `payload.sessions = eq.sessions`; pass
`purchaseBurden(eq.required)` to the difficulty; treat `eq.infeasible` like an infeasible rung (collapse reason
`'infeasible'` or keep it with the sentence). `goalDelta(s)` returns per-goal P50 values (nominal + holdout) for a
schedule; for a rung whose targets the equipment covers, the "without" schedule is `eq.schedule` itself, so a cache
keyed by schedule identity serves the final run. Cost on this machine: 0.1-0.3 s per call without `goalDelta`.

Open points: the optimiser's runs see the per-region capped uniform dose, not the composed one (composition happens
once at rung assembly; delivered loads are often below the planned %1RM with RIR 1-2, and session minutes are the
composer's); the envelope is the union over weekdays (a gym reachable on some weekdays only is judged at composition);
custom catalogues reach the decoder only through the seed catalogue (`catalogue` option of `equipmentFor` for the rest).

## Difficulty, limits and the Ideal (`difficulty.ts`, `limits.ts`, `ideal.ts`; PLANNER_V2_SPEC §1.1, §2)

**Difficulty D** (`difficulty.ts`). Seven burdens c_i = clamp((v_i − h_i)/(ℓ_i − h_i), 0, 1), c_i = 0 when
ℓ_i − h_i < ε_i (`DIFFICULTY_EPS`), D = mean, D_max = max. h_i is v_i of the status-quo plan on its own nominal
planner-mode run (one engine run per context, cached), so D(baseline) = 0 exactly (a 1e-9 dead zone absorbs snapshot
noise). v_i: (1) mean max(0, 1 − %/100) of the run's `inEnergyPctMaint` on non-fast eating days, ℓ = deficit cap;
(2) mean normalised hunger + 0.5 × share of days above h_tol, ℓ = h_tol + 0.40; (3) weekly RT + cardio minutes + extra
steps/100, ℓ = rtDays.max × maxSessionMin + cardioDays.max × min(90, maxSessionMin) + (steps.max − habit)/100;
(4) b₃, ℓ = `maxFastingPattern(ctx)` (closed form; a 24-h fast counts as a fully fasted day); (5) mean max(0, W_hab − W_d)
on non-fast eating days, ℓ = W_hab − min window; (6) `complexityPenalty` + 0.02 × (meals off the habit + supplement
doses) per day, ℓ = `complexityCeiling(ctx)`; (7) Gower distance of `lifeFeatures` (features.ts, 12 lifestyle
features, circular for clocks) from the habit's over `lifeRanges(ctx)` — fixed per request from the limits' gene
bounds ∪ the habit — plus 0.05 per required purchase. API: `difficultyD(ctx, schedule, sim, purchases = 0,
purchaseBurden = 0)` (no strings; ≈ 0.04 ms per 180-day evaluation on top of the cached schedule facts; pass either the
item count or `equipment.ts` `purchaseBurden(required)`), `difficulty(ctx, schedule, sim, { purchases?, purchaseBurden? })`
→ `DifficultyBreakdown` with plain rows ("4.5 h a week of training and extra walking, 2.5 h more than now", "11 h, 1 h
shorter than now"; a component without room reads "no room to change here — your limit is where you are now"),
`difficultyFrame`, `maxFastingPattern`, `complexityCeiling`, `lifeRanges`. `EnginePlanModel.descriptors(schedule, sim)`
returns `[D, b₁, b₃, b₄]`; `features()` / `FEATURE_SCHEMA` keep b₁..b₄. D is meaningful on the nominal run (draw −1):
an ensemble draw's descriptors use that draw's hunger and intake.

**Limits and the Ideal** (`limits.ts`). `LIMIT_CLASS` classes every field of `PracticalConstraints`, `ConstraintDraft`,
`PlannerSafetyInput` (incl. `fasting.*`, `optIns.*`), onboarding `SafetyOptIns`, `TrainingProfile` and the request
(`FieldClass`, `LimitGroupId`; `refused`/`capacities` are kept as values, `injuries`/`cleared`/`skill` as safety).
`idealRequest(req) → { request, relaxed }` sets every practical/preference field to its §2.1 value (training and cardio
days [0, 6], any weekday, no clock, sessions ≤ 90 min, window from 30 min after the earliest wake to 3 h before the latest
bed the sleep genes allow — never narrower than the user's own —, 2-5 meals, steps 4 000-12 000, sleep not fixed, high
hunger tolerance, no user fast limit, refusal, exclusions, fasting preference or food floors) and marks `ideal: true`,
`relaxedGroups: all`; safety (screening locks, flags, tiers), consent, goals, horizon, strictness, start date are
untouched. User-tagged `max-fast` / `protein-floor` / `carb-floor` locks (reasons all `rule: 'user'`) are the older form
of the user limits and are relaxed with them. `relaxGroup(req, group)` relaxes one group (`relaxedGroups: [group]`);
excluded options are cleared with the fasting group. `limitText(group, req, relaxedReq)` → label, current, relaxedTo
and the `adopt` patch; `bindingLimits(ctx, structure, x, schedule, log, margins, { equipment? })` applies the §2.4 test
(log share ≥ 20 % for the `user.*` rules and user food floors; genes within 2 % of a bound the group sets and the Ideal
would move; the hunger-cap margin ≤ 0.25; sleep fixed outside 7.5-8.5 h; the plan fasting up to the user's own longest
fast). `ADVISED_IDEAL` (sleep timing, training before bed, caffeine, light/temperature), `gMinMetric(ctx, k)` (§1.3; null
→ 10 % of the achievable range).

**Ideal-only genes** (`ideal.ts`; present when `request.ideal` or the group is in `relaxedGroups`): `sleep.durationH`
[7, 8.5] default 8 and `sleep.midpointH` (habitual midpoint ± 1 h, moved ≤ 2 h toward 02:30-04:30), both written as
quarter-hour `sleep.bedH/wakeH` on every template, replacing the sleep-extension lever; `train.clockH` (15-minute grid
inside the waking day, placement ±45 min around it, off meals, ending ≥ 1.5 h before bed); `cardio.modality` (integer
over the modalities HC-X4/X5 allow, intensity within the chosen modality's band). The context resolves the Ideal values
(training days up to 6 with the rest day and the novice cap of 3 kept). Repair (`idealGeneRules`) keeps the night at
7-8.5 h and every session ≥ 1 h before bed. Structure ids are the same as for the ordinary request (the sleep-lever
variants `[sl]` do not exist in the Ideal); `transferGenome` maps shared genes by path, the new genes start at their
defaults. Tests: `difficulty.test.ts`, `limits.test.ts`.

## Re-plan (living plan) (`replan.ts`, `sensitivities.ts`, `replanTypes.ts`; PLANNER_V2_SPEC §7, §8.6, §9.3)

**Contracts** (`replanTypes.ts`, re-exported by `src/living/plannerContract.ts`): `ActivePlanRecord` (kind = rung or
`'custom'` for scenario-started plans; `provenance.replanFrame = { offset, horizonDays, weightKg }` says where the genome
decodes: decoded day i = plan day offset + i), `ConfirmedState`, `LoggedDay`, `ItemOutcome`, `BlockAdherence`,
`ReplanRequest` / `ReplanResult` (`forecast.bands` from `fromDay` = today; `realisticBands` alongside),
`ForecastGoalOutcome` (the living plan's `GoalOutcome`), `PlanSensitivities`, `PLAN_ITEM_TYPES`.

**Start bridge.** `toActivePlan(rung, request, { planId, startDate?, schedule? })` freezes `'change'` targets as
absolute values from the rung's scorecard start values, anchors the schedule to the start weekday (or takes the caller's
anchored schedule) and records the frame offset (−skipped days). `toActivePlanFromScenario(schedule, request, …)` gives
kind `'custom'` with no genome.

**`replan(req, { signal, onProgress, evaluatorFor, tier, totalEU })`.**
- Forward model (`ForwardModel`): the whole plan schedule (day 0 = start) run from the confirmed day-stamped snapshot
  with δ as `intakeOffsetKcal`; days before today are the logged days (`LoggedDay.inputs`; a prescribed fast on a logged
  day stays unless its fast item was skipped). The run records `REPLAY_SERIES` (the snapshot key includes the mask);
  goals on other series, or a snapshot that does not restore, switch to a day-0 run re-anchored to the snapshot's tissue
  mass at the anchor day. 1 EU ≈ 1.3 ms per simulated day (Simulator mode, all modules).
- Margins judge from today on (`futureView` masks earlier days; rolling windows keep the logged past). Violations the
  habitual future (maintenance, usual activity, no fasts) also has are carried over from the logs: the margins judge from
  the first day it clears them (`judgeFrom`), and a margin it never clears is judged relative to it (no worse than eating
  at maintenance). Fasting spacing (HC-F2, multi-day spacing) is checked over logged past + future
  (`futureSpacingViolation`, pairwise against every earlier fast so a conflict inside the past cannot hide one).
- Lock window: today and tomorrow come from the active plan unless kind `'user'` or "safety first" (the current plan
  breaks a margin, the validator, a Simulator warning or the δ ± 1.28 sd band from here: then the lock opens, a light
  re-plan looks at the whole horizon and the churn limits do not hold the fix back). `light` may move tomorrow's energy
  by ≤ ±10 % (same energy kind, scaled).
- Search: `runPlanner` (problems without `ladder`) over a frame — `light`: the active structure only, σ₀ 0.05, 1 000 EU,
  days [today+2, today+7) only; `weekly`: the structure and its grammar neighbours (all structures when none is safe),
  σ₀ 0.10, 1 500 EU; `event`/`user`/no genome: every structure in a frame decoded from today (≥ 28 days decoded, the days
  left used), tier budget, warm start = the active genome shifted (elapsed segments dropped, current one shortened,
  `transferGenome`). Every nominal evaluation is recorded by an evaluator wrapper; the current plan ("keep") is always a
  candidate with C = 0.
- Selection key (v_S, v_L, −⌊(G − G_keep)/q_G⌋, λ_S·C + R, −G) with q_G = 0.01, λ_S = 1, a 0.01 hysteresis for keep;
  G = ROC-weighted desirability (0 = habitual future, 1 = the absolute target or the best safe value seen), evaluated on
  the realistic projection for weekly/event/user. v_L = the light/weekly hard limits (next-7-day energy ±10 %, sessions ±1,
  no new fast ≥ 24 h, no new day type). Finalists (≤ 6, key order) pass the Simulator-mode re-run (unlistable warnings
  from `judgeFrom`), as-prescribed margins and the δ band; a materially identical future reverts to keep.
- Status: `unchanged` (keep; the same record), `ok` (lowers load or only request changes), `proposal` (`loadChange`
  finds a deeper deficit or surplus, more training, a new or longer fast or more steps; one proposal row with
  `raisesLoad`), `noSafePlan` (nothing passes; the plan is returned unchanged with plain reasons). Diff rows (next 28
  days) carry plain before/after and a reason per trigger; forecasts as prescribed and realistic with goal dates.
- Workers: `ReplanEvaluatorHost(init)` rebuilds the problem from `{ request, spec }` and answers batches in order.

**`sensitivities.ts`.** `computePlanSensitivities(plan, state)`: 28-day window from the anchor; J = ROC-weighted goal
functionals normalised by plan vs habitual; item weight = J(plan) − J(type omitted), floor 0.02, nine types summing to 1
(`floorWeights`); α per session type from finite differences (sets +20 %, load 85 %, cardio minutes +20 % net of their
energy, the same energy off intake), R3 goal-class defaults when unresolved; ≈ 13 runs, ≈ 0.2-0.3 s for 21 simulated
days. `benefitRetained(plan, date, itemId, performed, state?)`: c = clamp((J(actual) − J(omit)) / (J(plan) − J(omit)))
per goal the item moves measurably (else the dose ratio); 2-3 runs, ≈ 20 ms. `projectRealistic(plan, state, adherence)`:
as prescribed vs each item at E[c] = a/(a + b) (prior Beta(6, 2) for unobserved types; deficit depth, protein, sets,
minutes, steps scaled; fasts kept when E[c] ≥ 0.5), bands from δ ± 1.28 sd and the trend-weight sd; 2-6 runs.

Tests: `__tests__/replan.test.ts` (past immutable, lock window, absolute targets, churn limits, proposals, fasting spacing
across the logged past, light = 7 days, determinism, scenario plans, plain texts) and `replanSensitivities.test.ts`.

## Evidence-coverage audit (PLANNER_V2_SPEC §6)

- `evidenceGraph.ts`: `EvidenceEdge` (§6.1 shape) generated from the lever/block registries joined with hand-entered
  mechanism channels (`CHANNELS`, `LEVER_CHANNELS`, `BLOCK_CHANNELS`), `INFO_ONLY_EDGES` for unusable levers and
  `catalogueEdges(SEED_CATALOGUE)` (outcome → metric map `CATALOGUE_OUTCOME_METRICS`; null-effect outcomes are not
  edges). Module = series owner (composition for scale weight / body fat, the planner reads tissue mass); signals from
  `SIGNAL_DEFS`; topic from the metric's sources. Helpers `edgesTo`, `edgesFrom`, `servesFasting(metric, 'up'|'down')`.
- `gates.ts`: `GateDef` registry (37 gates) and `gateOn(ctx, id)`; `PlanningContext.disabledGates` (copied by
  `compileRequest` from `withGatesDisabled` / `withGatesDisabledSync`, audit only). Safety and consent gates stay on
  outside `{ audit: true }`. Hooks: `skeleton.ts` (blockUsable, leverUsable, phaseFeasible, eventFeasible,
  segmentSequenceOk, enumerateStructures) and `context.ts` (fastingGate, resolvePractical novice cap). Decoder clamps
  are registered but not switchable; the overlay-host gates also live in `decode.ts` (not switchable there).
- Fast checks (`pnpm test`): `__tests__/audit.static.test.ts` (graph well-formed, FASTING_SERVED vs graph, gate sites,
  1a, 1b), `audit.fields.test.ts` (check 4, imports the app mapping on purpose), `audit.liveness.test.ts` (check 2
  reduced, check 3), `audit.honesty.test.ts` (check 6). Known findings are listed in the tests with their reason.
- Slow audit: `pnpm audit:planner` = `src/engine/planner/audit/part.*.audit.ts` in parallel (static, full liveness with
  the ensemble floor, 6 planner-run parts for 1c and gate cost) then `report.audit.ts` → `docs/PLANNER_COVERAGE.md`,
  `public/validation/planner-coverage.json`. Wired into `release` after `test:release`.
