# Planner v2 specification: plan ladder, Ideal plan, fasting, algorithm, benchmark, coverage audit, living re-plan

**Package:** A2 (PLAN items 7, 8, 17; hooks into 6, 11, 13, 14). **Date:** 2026-10-01. **Status:** normative for E6
(planner engineering), with interfaces for E2, E5, E8, E13 and E15.
**Inputs:** `plan/01-after-launch/PLAN.md` items 6-8, 11, 13, 14, 17 (with the item 8 diagnosis and decision list);
`research/R6-planner-algorithms.md` (landed 19:14, settles the algorithm), `R11-living-plan.md`, `R5-evidence-policy.md`,
`R3-exercise-equipment.md` and `R3-catalogue-seed.json`; `docs/QA_FINDINGS.md` rulings R-EA-PLANNER, R-TTT, R-PLAN-SAFETY, R-T4CAP; MODEL_SPEC §7.2-7.3,
§10; the planner READMEs and code as of 2026-10-01.

**Labels.** `[R6]` decision taken from R6 (settled). `[PLAN-8.n]` decision n of the item 8 list (settled by the
orchestrator). `[PROPOSED]` constant or rule set by this spec; tuned only through the benchmark harness (§5) on its
training split. `[BENCH]` kept only if the harness shows it beats the baseline. `[OPEN]` product question for the owner.
"MUST/SHOULD/MAY" are normative.

**Concurrency with E2.** E2 is fixing the two fasting safety bugs, the fasting gate, the tie-break penalty and the
preflight hints in code right now. §3 is the acceptance contract for that work. E6 builds on E2's result and does not
re-implement it. Any deviation E2 makes is recorded in `src/engine/planner/domain/README.md` and reported to the
orchestrator, who updates this file.

**Invariants carried over unchanged** (each has tests today; v2 MUST keep them green): three safety layers (tier
gating, decoder clamps and repair, independent validator); R-PLAN-SAFETY (finalists re-run in Simulator mode; only
listable cautions survive); R-EA-PLANNER (EA floor 30 kcal/kg FFM, ≈ 31 with headroom, only where the Simulator's EA rules
apply); R-T4CAP; R-TTT (one fastest-safe-rate function before and after the run, 104-week cap); R-MAINT energy %
semantics; determinism for any worker count; item 5 (no dossier numbers, `§`, ruling ids, WP ids or spec names in any
user-visible string); item 14 / R5 (evidence grades never gate, order, prune or weight anything in the search).

---

## 0. Terms

| Term | Meaning |
|---|---|
| Rung | One plan of the ladder: `hard`, `medium`, `easy`. |
| Ideal | The fourth plan: same goals, practical limits removed, safety and consent kept (§2). |
| Practical limit | A user limit on how they live (training days, window, steps, sleep, longest fast, equipment). |
| Safety rule | Dossier 17 caps, screening locks, flags, fasting-tier eligibility. Never relaxed. |
| Consent | Opt-ins (fasting tiers T2-T4, short window, opt-in levers). Never relaxed (owner assumption, R6 §4.4). |
| d̃_k | Desirability of goal k (0 = baseline, 1 = target or best achievable), as in `optim/goals.ts`. |
| G | Goal score: ROC-weighted Σ_k w_k·min(1, d̃_k) over active goals, *without* the regulariser. |
| R, U | Regulariser (hunger, complexity, terminal, training burden; `regulariserOf`); U = G − R, tie-breaking only. |
| D | Difficulty ∈ [0,1] (§1.1). |
| EU | Evaluation unit = one horizon simulation (aborted runs < 1). |

---

## 1. Plan ladder (item 7)

### 1.1 Difficulty axis [R6]

D is an explicit, explainable effort score. Each component c_i ∈ [0,1] is

```
c_i = clamp((v_i − h_i) / (ℓ_i − h_i), 0, 1)     h_i = v_i of the baseline (status-quo, habitual) plan,
                                                  ℓ_i = the user's stated limit (or the safety cap when none is given)
if ℓ_i − h_i < ε_i the component is inactive: c_i = 0 (the user's limits leave no room on it)
D = (1/7) Σ_i c_i          (equal weights, R6 §4.1; refit from logged adherence later, §1.7)
D_max = max_i c_i          (reported beside D)
```

| i | Component | v_i (plan value) | h_i | ℓ_i | Data |
|---|---|---|---|---|---|
| 1 | Deficit depth | mean over non-fast eating days of max(0, 1 − EI_d / M_d), M_d = the R-MAINT maintenance of the nominal run | 0 (baseline) | `caps.deficitCapPct`/100 (includes any screening `deficit-cap` lock) | schedule + nominal run |
| 2 | Hunger | mean normalised hunger index + 0.5 × share of days with index > h_tol | baseline | (h_tol + 0.15) + 0.25 [PROPOSED] | nominal run `hunger` |
| 3 | Training time | weekly minutes of RT sessions + cardio + max(0, mean steps − habitual steps)/100 | baseline (habitual sessions and steps) | rtDays.max × maxSessionMin + cardioDays.max × min(90, maxSessionMin) + max(0, steps.max − habitual)/100 | schedule |
| 4 | Fasting load | b₃ (mean of max(0, fasted h − 10)/14; zero-intake day = 1) | baseline | b₃ of `maxFastingPattern(ctx)`: the most fasting-heavy pattern the caps and consent allow (closed form, see below) | schedule |
| 5 | Window tightness | mean over eating days of max(0, W_hab − W_d) hours | 0 (baseline) | W_hab − `caps.minWindowH` | schedule |
| 6 | Daily decisions | `complexityPenalty(counts)` + 0.02 × mean daily (meals off the habitual count + supplement doses) | baseline (≈ 0) | `complexityCeiling(ctx)`: the same formula at 4 day-types per phase, 3 phases, max events, 2 training clock times, week-repeat share 0.5 [PROPOSED] | schedule |
| 7 | Departure from habitual life | Gower distance between φ_life(plan) and φ_life(baseline) | 0 (baseline) | 1 | schedule |

- `maxFastingPattern(ctx)`: if zero-intake levers are not offered (§3.1), the minimum window every day; else the
  heaviest of {two 24-h fasts per week; B12 at 3 zero days per week; one longest-allowed event per its spacing period}
  that `compileSafetyCaps` permits. Pure function of the context; no engine runs.
- φ_life (lifestyle subset of the Gower features): window start (circular), window length, meals/day, mean steps, RT
  sessions/week, cardio min/week, training clock time (circular), bed and wake time (circular), mean energy % of
  habitual intake, protein g/kg, carbohydrate share. Ranges R_k are **fixed per request** from the gene bounds the
  limits allow (not archive ranges), so D is identical for a plan whatever else was evaluated.
- Properties (tested): D(baseline) = 0; D is non-decreasing in every v_i; D depends only on (context, schedule,
  nominal run), so it is deterministic and cacheable with the evaluation; one D per plan (components 2 and 1 read the
  nominal run, never an ensemble draw).
- Code: `features.ts` gains `difficulty(ctx, schedule, sim): DifficultyBreakdown`; `descriptors()` returns
  `[D, b₁, b₃, b₄]` (b₂ carbohydrate share stays a Gower feature only, R6 P4).

```ts
export type DifficultyComponentId =
  | 'deficit' | 'hunger' | 'trainingTime' | 'fastingLoad' | 'windowTightness' | 'decisions' | 'habitDistance';
export interface DifficultyComponent {
  id: DifficultyComponentId; value: number;           // c_i ∈ [0,1]
  raw: number; habit: number; limit: number;          // v_i, h_i, ℓ_i in the component's own unit (e.g. 240 min/wk)
  active: boolean;                                    // ℓ_i − h_i ≥ ε_i
  label: string; text: string;                        // "Training time", "4 h a week, 2 h more than now"
}
export interface DifficultyBreakdown { D: number; Dmax: number; components: DifficultyComponent[] }
```

### 1.2 Difficulty in the archive [R6]

- Descriptor vector `[D, b₁ energy cycling, b₃ fasting load, b₄ exercise mode]`. D is always active; the style
  descriptors use the existing "range ≥ 0.1 across the first samples" rule.
- Geometry: D is the first, explicitly binned axis (10 bins on tier S, 20 on M/L/X, uniform on [0, 1]); inside each D
  bin a CVT over the active style descriptors (S 6, M 5, L 8, X 16 cells per bin) [PROPOSED]. Every evaluation of the
  race, the stages and the QD stage is offered to the archive.
- Insertion key: the final key with relaxed floors (§4.3). Low-D bins therefore hold the best attainment *at that
  effort*; the **archive staircase** best_{D ≤ D̄} is the attainment-difficulty frontier F(D̄) for free.
- Race diversity guard (P2, §4.2): keep ≥ 1 structure per occupied D tercile among survivors.

### 1.3 Rung selection [R6]

```
HARD   = the ε-lexicographic winner of the stages (P3), within every limit.          g_H = d̃_1(HARD), D_H = D(HARD)
         Hard is defined by results, not effort: among plans tied on goals (§4.3 quantum) it is the least burdensome.
EASY   = argmin D(x)  s.t.  safe, chance-feasible, validated,  d̃_1(x) ≥ max(0.5·g_H, g_min)
         then, among plans with D ≤ D_E* + q_D, goals 2..K ε-lexicographically (their ladder tolerances δ_k)
MEDIUM = knee of F between EASY and HARD: normalise x = (D − D_E)/(D_H − D_E), y = (g − g_E)/(g_H − g_E) over the
         frontier points with D_E < D < D_H; knee = argmax (y − x)/√2.  If that distance < 0.05 (no knee):
         MEDIUM = argmin D s.t. d̃_1 ≥ 0.8·g_H (same constraints and tie rule as EASY)
q_D = 0.02 [PROPOSED]
```

- g_min = the goal's minimal meaningful change, converted to d̃ through the goal's scale [PROPOSED]: fat mass 1 kg;
  trend weight 1 kg; body fat 1 %-point; waist 1 cm; visceral fat 0.1 kg; skeletal muscle or lean tissue 0.3 kg;
  strength 5 %; every other metric 10 % of its achievable range. If g_H < g_min, EASY = HARD (collapse, below).
- Goals 2..K inside Easy/Medium: d̃_j ≥ min(ρ·d̃_j(HARD), d̃_j(HARD)) − δ_j with ρ = 0.5 (Easy) / 0.8 (Medium) for
  targets and maximise/minimise goals; "keep" goals stay kept within 2 × `keepTolerance`. No rung may be worse than
  baseline on any active goal (d̃_j ≥ 0) unless Hard is.
- Solving: the archive staircase gives initial points; then one ε-constraint CMA-ES solve per rung, warm-started from
  the staircase elite of the nearest D bin, with the ladder key of §4.3. Robust check, validator and Simulator-mode run
  as for Hard (P7-P8). All numbers shown come from the holdout ensemble (§4.7).
- **Distinctness** (checked every run, reported in `ladder.checks`): D_H − D_M ≥ 0.15; D_M − D_E ≥ 0.15; pairwise
  Gower ≥ 0.20; d̃_1 ordered H ≥ M ≥ E; D ordered H ≥ M ≥ E. Failure handling, in order: drop Medium; if
  D_H − D_E < 0.15 or Gower(H, E) < 0.20, return Hard only. **Batch 02 (§12.8):** when Easy stands, Medium uses its own
  smaller margins (effort ≥ 0.08 and Gower ≥ max(0.10, Gower(H, E)/3) from each neighbour); the 0.15 / 0.20 above stay
  for Hard-Easy and for a Medium without Easy. Never pad with near-duplicates. Each collapse carries a
  reason code and a sentence ("Easy already reaches 95 % of Hard's fat loss; a harder plan buys little.").
- Hard infeasible within the limits → `status: 'noSafePlan'` exactly as today; Ideal (§2) still runs when the safety
  rules alone admit a plan, so the user sees which limit blocks.

### 1.4 Time to target per rung [R6]

- If the rung's own run crosses the target inside the horizon: TTT = first crossing (7-day end functional), weeks.
- Else: `rungReach(ctx, goal, D_rung)`: the R-TTT canonical route family parameterised by intensity α ∈ [0, 1]
  (route levers interpolated between the baseline habit at α = 0 and the fastest-safe values at α = 1), bisection on α
  (≤ 6 steps) so that the route's D over its first 12 weeks ≤ D_rung. Same 104-week cap and wording as R-TTT.
- Consistency (tested): weeks(Hard) ≥ fastest-safe `targetReach` weeks; weeks(E) ≥ weeks(M) ≥ weeks(H) up to one week
  of rounding; Hard's text equals the pre-run hint when Hard sits at the safe rate.

### 1.5 Presentation data (side by side)

Every rung and the Ideal carry a `RungSummary`; the comparison view is rows × {Hard, Medium, Easy, Ideal}.

```ts
export type RungId = 'hard' | 'medium' | 'easy';
export type PlanKind = RungId | 'ideal';
export interface GoalOutcome {
  goal: number; metric: MetricId; label: string; unit: string;
  p50: number; band: { p10: number; p90: number };     // holdout ensemble, functional value
  change: number;                                        // p50 − start
  pTargetMet: number | null;
  percentOfAchievable: number; verdict: 'reached' | 'kept' | 'notReached' | null;
  weeksToTarget: number | null; beyondTwoYears: boolean; tttSource: 'ownRun' | 'route';
  vsHard: number;                                        // this − Hard, metric units (0 for Hard)
}
export interface LimitBinding { group: LimitGroupId; label: string; share: number; text: string } // binding on ≥ 20 % of days or at gene bound
export interface RungSummary {
  kind: PlanKind;
  title: string;                       // "Hard", "Medium", "Easy", "Ideal"
  subtitle: string;                    // measurable name, e.g. "Deficit 18 % · 4 sessions · 24-h fast weekly"
  difficulty: DifficultyBreakdown;
  outcomes: GoalOutcome[];
  weeklyTrainingMin: number; meanWindowH: number; hunger: HungerAssessment;
  fasting: FastingVerdict;             // §3.6
  bindingLimits: LimitBinding[];       // which of the user's limits this plan presses against
  equipment: { required: ShoppingItem[]; optional: ShoppingItem[] };   // §8.5
  safetyItems: SafetyNote[];
}
```

Comparison rows, in order: Effort (D as 0-100 plus component bars); one row per goal (P50, band, verdict); time to
target per target goal; hunger; weekly training time; eating window; fasting; things to buy; limits this plan presses
against; safety notes. The Ideal column adds "What your limits cost" (§2.4). Units follow Settings › Units.

### 1.6 Naming: Hard / Medium / Easy / Ideal replace A / B / C everywhere

- Engine: `PlanOption.id` becomes `kind: PlanKind`; A-relative fields become Hard-relative (§9.2); sentences say "the
  Hard plan" where they say "option A" today (`planner.ts` `feasibilityReport`, `explain.ts`).
- UI and exports: rung cards, comparison table, provisional slots (`plannerStore.found` keyed by rung), Simulator
  scenario names ("Hard plan · Deficit 18 % …"), `PrintPrescription.tsx`, `planFacts.ts`, progress copy. Labels "Hard",
  "Medium", "Easy", "Ideal (scientific ceiling)" [PROPOSED wording; D1/E13 may refine]; measurable subtitles as today.

### 1.7 Difficulty weights later

Equal weights now. Once logged adherence exists (item 6), fit w by non-negative least squares of the daily adherence
score on the c_i, shrunk towards equal weights; or earlier, a pairwise "which plan is harder?" judgement set fitted by
Bradley-Terry [OPEN, R6 q4]. Weights are versioned in provenance; a weight change re-labels rungs only on re-plan.

---

## 2. Ideal plan

### 2.1 Which constraints the Ideal drops

The Ideal is the same solver (P2-P3, then P7-P8) on a transformed request `idealRequest(req)`. Every input field is
classed; only `practical` and `preference` fields change.

| Field | Class | Ideal value |
|---|---|---|
| `trainingDaysPerWeek`, `allowedTrainingWeekdays` | practical | [0, 6], all weekdays (HC rest day and HC-X2 novice cap stay: safety) |
| `trainingTimeH`, `maxSessionMin` | practical | training clock becomes a gene (§2.2); session ≤ 90 min |
| `cardioDaysPerWeek`, `cardioModality` | practical | [0, 6]; modality gene over modalities the safety caps allow (HC-X4/X5) |
| `eatingWindow`, `mealsPerDay` | practical | earliest = wake + 0.5 h, latest = bed − 3 h (L19); meals 2-5 |
| `steps` | practical | [4 000, 12 000] (lever L1 evidence range) |
| `sleepFixed` | practical | false; sleep genes of §2.2 |
| `hungerTolerance` | practical | 'high' (h_tol 0.70); the hunger cap margin stays |
| `maxFastHours` (user) | practical | the consented tier's maximum |
| `fasting: 'none'`, `excludedLevers`, `prefersFasting` | preference | cleared (tier consent still applies, so without an opt-in only ≤ 24 h fasts) |
| `proteinFloorGPerKg`, `carbFloorGPerDay` (user) | preference | removed (HC-M1 floors and screening `carb-floor` locks stay) |
| equipment and access (E8, §8) | practical | the whole catalogue available; purchases listed |
| diet pattern, allergies, religious or ethical exclusions (E7) | value | kept |
| `safety` (screening, locks, flags, tiers), consent opt-ins | safety / consent | kept |
| goals, horizon, strictness, start date | request | kept |

`LIMIT_CLASS` (a table in `context.ts`) maps every `PracticalConstraints` field, every `ConstraintDraft` field and
every E7/E8 intake field to a class and a `LimitGroupId`. The coverage audit (§6.3 check 4) fails on any unclassed field.

### 2.2 Evidence-based optima the Ideal may use

Each lever is **credited** (it has an engine channel, so it moves the numbers) or **advised** (mechanism known, no
channel yet; shown as advice, never claimed in the numbers, per R5's `info-only` status).

| Domain | Ideal rule | Status | Basis |
|---|---|---|---|
| Sleep duration | gene `sleep.durationH` ∈ [7.0, 8.5], default 8 (h_ref 7.5, band 7-8; extension toward 7.5-8.5) | credited (sleep-debt states: intake, hunger, P-ratio, Si, MPS, testosterone) | dossier 16 §4.1.1-4.1.11 |
| Sleep regularity | same bed and wake time 7 days a week | credited only through duration (weekend catch-up does not repair Si) | 16 §4.1.10 |
| Sleep timing | midpoint gene within ±1 h of the habitual midpoint, moved ≤ 2 h toward 02:30-04:30 when outside it; shift work → a regular day schedule "if your work allowed it" | advised (the engine credits only the shift-work flag and the meal clock relative to wake) [PROPOSED] | 16 §4.1.9 |
| Meal timing | window starts within 0.5-2 h after wake; last meal ≥ 3 h before bed; earlier windows preferred | credited (meal-clock glucose multiplier relative to wake; late-eating hunger shift) | 07 §4.7, A4; L19 |
| Protein distribution | ≥ 3 feedings ≥ 3 h apart on eating days | credited where the muscle module reads per-meal protein | 08 §4.15; `MIN_MEAL_SPACING_H` |
| Training placement | sessions on the 15-min grid inside waking hours; vigorous sessions end ≥ 1 h before bed; RT and cardio days free | credited (training) / advised (sleep-quality index is a UI heuristic) | 09, 10; 16 §4.2.6 |
| Steps | up to 12 000/day, raised ≤ 1 000/week | credited | 21 L1 |
| Caffeine | none within 6 h of bed | advised | 16 §4.2.1 |
| Alcohol | none | by construction (HC-M10) | 17 |
| Light, temperature, environment | listed as advice only | advised | — |

New genes exist only in Ideal structures: `sleep.durationH`, `sleep.midpointH` (both 0.25 h grid), `train.clockH`
(0.25 h grid), `cardio.modality` (categorical, CatCMA-style integer coding). The decoder writes `sleep.bedH/wakeH`
(both registered Schedule fields).

### 2.3 Run and status

- Budget: 60 % of the P6 share (§4.8), warm-started from Hard's genome (transferred by path to the relaxed bounds) and
  the Hard archive elites; the rest goes to limit costs (§2.4).
- Labelled "Ideal (scientific ceiling): the best plan for your goals if none of your practical limits applied. Safety
  rules and your opt-ins still apply." It cannot be started as it is: "Start" opens "Adopt some of these limits", the
  user picks limit groups to relax, and the planner re-runs (warm-started) to produce a startable ladder.
- If the Ideal beats Hard on no goal beyond the quantum (§4.3): "Your limits cost nothing measurable for these goals."

### 2.4 What each limit costs [R6]

- Binding test per limit group on Hard (and on each rung for `bindingLimits`): the repair log clamped a rule of the
  group on ≥ 20 % of days, or a gene whose bound comes from the group sits within 2 % of that bound, or a margin tied to
  the group is active (≤ 0.25 units).
- Shadow price of group ℓ: re-solve with only ℓ relaxed to its Ideal value, warm-started from Hard; budget
  min(5 % of the tier, remaining P6 / number of binding groups); at most 4 groups on S/M (strongest binding first), all
  binding groups on L/X.
- Report Δ = relaxed − Hard per goal in metric units, ΔD, and the sentence: "Allowing 5 training days instead of 3 would
  add 0.6 kg of fat loss by week 12." Sorted lexicographically by quantised goal deltas in priority order; top 3 shown,
  all in data. Non-binding groups have Δ = 0 by construction and are not run.
- Ideal gap = Ideal − Hard per goal. Shadow prices need not add up to it; the remainder is shown as "together, through
  interactions". Tier X MAY add leave-one-out from the Ideal and report the two-point Shapley mean [BENCH].

```ts
export type LimitGroupId =
  | 'trainingDays' | 'sessionTime' | 'cardio' | 'eatingWindow' | 'steps' | 'sleep'
  | 'fasting' | 'foodFloors' | 'hunger' | 'equipment';
export interface LimitCost {
  group: LimitGroupId; label: string;
  current: string; relaxedTo: string;           // "3 training days", "5 training days"
  deltas: Array<{ goal: number; delta: number; unit: string }>;
  deltaD: number; text: string; euSpent: number;
}
export interface IdealExtras {                             // joined with the plan payload in §9.2 (IdealPlanV2)
  relaxed: Array<{ field: string; from: string; to: string; group: LimitGroupId }>;
  advised: Array<{ domain: string; text: string }>;       // advised-only items of §2.2
  limitCosts: LimitCost[];
  gapVsHard: Array<{ goal: number; delta: number; unit: string }>;
  interactionRemainder: Array<{ goal: number; delta: number; unit: string }>;
}
```

---

## 3. Fasting (item 8)

### 3.1 Gate [PLAN-8.3]

The gate decides whether zero-intake levers (24-h fasts, zero days, multi-day fasts) enter the structure set. It
replaces the `fastingRelevant` rule in `context.ts` (`compileRequest`) and the "never with a muscle goal in the top two"
rule, which has no dossier source.

```
servesFasting(goal)  = the evidence graph (§6.1) has an edge from a zero-intake lever to goal.metric with
                       status ≠ 'infoOnly' and a sign that helps the goal's direction (or sign 0 = condition-dependent)
servedGoal           = the highest-ranked goal with servesFasting, or, when prefersFasting is set (dossier 20 allows
                       adherence as a reason), the highest-ranked goal of any class
tierHeld             = caps.fastTierAllowed.T1 (the default tier; no consent needed unless screening excludes it)
                       OR an opted-in tier T2-T4 that the screening allows
fastingOffered       = ¬ fastingRefused
                       ∧ effective maxFastH ≥ 24   (min of tier cap, user longest fast, locks)
                       ∧ tierHeld
                       ∧ servedGoal exists
                       ∧ no muscle-class goal ranks above servedGoal
```

"A tier is opted in" (PLAN-8.3) is read as "a tier ≥ 24 h is held", T1 included: otherwise a transient-first user
without an opt-in would lose the 24-h fasts the planner offers today (a regression). Opt-ins widen *which* fasts
(48-72 h, zero days) enter the grammar; they are not a precondition for any fast.

- Offered means the grammar builds fasting structures; the optimiser rejects fasts that bring no gain (fat loss,
  insulin sensitivity and hunger at equal weekly energy: the evidence-backed no-fast result is kept by the search,
  not by the gate).
- `PlannerResult.fasting = { offered, reason, servedGoal, tierMaxH }`; reasons are plain sentences (no internal refs).
- `expertMode` MUST be passed through `toSafetyInput` from the app flag (the flag stays off; the T4 path becomes
  reachable in tests).
- Grammar changes in `skeleton.ts` `enumerateStructures` (or its v2 grammar, §4.4): the `fastDay24` overlay is allowed
  inside B0, B1, B2, B3, B6, B22 and B24 (today only B1, B3, B6); multi-day events keep today's rule (any phase except
  B12, B21, B23); B12 patterns exist whenever fasting is offered and servedGoal is fat-loss or transient class; surplus
  phases (B21, B23) never carry fasts (20 §4C, unchanged); the refeed overlay stays deficit-only.

Truth-table tests (`context.fastingGate.test.ts`): autophagy #1 + T3 → offered; ketosis #1 + T2 → offered; fat loss #1,
muscle #2 + T3 → offered (served = fat loss); muscle #1, autophagy #2 + T3 → not offered ("muscle ranks above");
autophagy #1 + longest fast 20 h → not offered with the longest-fast reason; autophagy #1, no opt-in → offered with
24-h fasts only; screening excludes T1 (e.g. pregnancy) → not offered with the screening reason; `fasting: 'none'` →
refused.

### 3.2 Energy availability over non-fast days [PLAN-8.1] (E2 implements in engine safety; planner reads it)

```
fastDay[i]     = the engine's fast-event-day flag (MODEL_SPEC §7.2: ≥ 12 h in a planned span > T0, or a graded-refeed day)
N7(d)          = { i ∈ [d−6, d] : fastDay[i] = 0 }
EA_eff(d)      = Σ_{i ∈ N7(d)} (EI_i − EEE_i) / (|N7(d)| · FFM_d)              if |N7(d)| ≥ 4
               = Σ_{i ∈ N28(d)} (EI_i − EEE_i) / (|N28(d)| · FFM_d)            otherwise (N28 = non-fast days of [d−27, d])
applicability  unchanged: session exercise in the trailing 7 days (all days) AND deficitPct7 > 5 (non-fast days)
fast-event days themselves: EA rules not evaluated (margin NaN); the day is governed by the fasting-tier rules
```

- `SafetyTrace.ea7` takes this definition; W-E07/E08/E09/E20 and the EA legs of W-E18/E19 use it; the planner's
  `eaFloorMargin` reads the engine's W-E07 margin series, so both sides agree by construction. The trace fallback in
  `eaFloorMargin` MUST use the same definition.
- The HC-E1 kcal floor keeps min(EI_7 over non-fast days, EI_28): fasting cannot dodge the energy floor.
- Tests: (a) inserting a 24-h fast into a week with 3 RT sessions at a 20 % eating-day deficit leaves EA_eff unchanged
  on every non-fast day; (b) property test over random fast placements: planner EA margin ≥ 0 ⇔ the Simulator raises no
  W-E08; (c) existing R-EA-PLANNER golden assertions still pass.

### 3.3 Ketones while eating [PLAN-8.2] (E2 implements)

- W-05-KETO-FED (danger) applies only when `type1Diabetes` or `diabetesMedication ∈ {insulin, sulfonylurea, sglt2}`
  [PROPOSED scope; E2 confirms against dossier 05 §9 and 17]. For everyone else it does not fire.
- Independently, for everyone, the whole graded refeed after a planned fast > T0 gets today's first-24-h treatment
  (only BHB > 6 mmol/L counts there).
- Planner: margin index 14 (`W-05-KETO-FED` proxy in `model.ts`) is `MARGIN_NA` for out-of-scope profiles; in scope it
  stays as defence in depth (these profiles are already excluded from keto blocks and from fasts above T0).
- Dependency: QA engine item 2 (BHB over-read at 60-140 g/d net carbohydrate) is an engine fix, not a planner one;
  the regressions of §3.8 must hold before and after it.

### 3.4 Penalty as a true tie-breaker [PLAN-8.4, R6 Fix 1]

The regulariser may only decide between plans whose quantised goal levels are equal. Keys in §4.3. Golden request (d)
(0.728 vs 0.715 on goals) MUST then pick the 72-h-fast plan unless a goal or safety reason says otherwise.

### 3.5 Classification of fasting use (golden (d) fix)

```ts
export type FastingKind = 'none' | 'eatingWindow' | 'fast24' | 'zeroDays' | 'multiDay';
// multiDay: an event > 24 h (meal to meal); zeroDays: B12 zero-intake days; fast24: events of 20-24 h;
// eatingWindow: no zero-intake span but some day's window ≤ 8 h (time-restricted eating); none otherwise.
export function fastingKind(s: Schedule): FastingKind;   // precedence multiDay > zeroDays > fast24 > eatingWindow > none
export const usesFast = (k: FastingKind) => k === 'fast24' || k === 'zeroDays' || k === 'multiDay';
```

A short eating window is reported as "time-restricted eating", never as "a fast". `golden.d.test.ts` today counts
`windowH ≤ 8` as fasting used; it MUST use `usesFast(fastingKind(...))`.

### 3.6 Explanation contract: "a fast was considered and rejected because …" [PLAN-8.5]

Every rung and the Ideal carry a `FastingVerdict`. When `fasting.offered` and the plan has no fast, it MUST carry a
`rival`: the best evaluated plan that does have one.

```ts
export type FastingRejectReason =
  | 'goalLoss'        // rival worse on the first goal (priority order) whose quantised level differs
  | 'noGoalGain'      // tied on every goal; lost on hunger / complexity / training time (name which)
  | 'safetyMargin'    // rival breaks a state-space margin (which, by how much, on which day)
  | 'chance'          // rival fails the P90 chance constraint
  | 'validator'       // independent validator or Simulator-mode run rejected it
  | 'difficulty'      // rival is better on goals but above this rung's difficulty
  | 'notEvaluated';   // allowed only on tier S after the rival search below found nothing
export interface FastingVerdict {
  used: boolean; kind: FastingKind; longestFastH: number;
  text: string;                           // plain language, numbers in user units, no internal references
  rival?: {
    kind: FastingKind; longestFastH: number; structureId: string;
    reason: FastingRejectReason;
    goalDeltas: Array<{ goal: number; delta: number; unit: string }>;   // rival − this
    hungerPeakDelta: number | null; leanTissueDeltaKg: number | null; deltaD: number;
    detail: string;                       // e.g. "energy availability 28 kcal per kg lean mass on day 23"
  };
}
```

- Rival search: among all evaluated records whose structure has a zero-intake lever, the best safe one by the final
  key (relaxed floors); if none is safe, the least infeasible (Deb order) to state the safety reason. If no fasting
  structure was evaluated, spend ≤ 150 EU on the top-prior fasting structure warm-started by genome transfer from the
  rung. The rival's goal numbers come from the same ensemble as the rung's.
- Reason precedence: validator, safetyMargin, chance (rival unsafe) > goalLoss > difficulty > noGoalGain.
- Templates (examples; E1's copy rules apply):
  - goalLoss: "A plan with a 72-hour fast was considered. It raised the autophagy signal by 0.08 but cost 0.6 kg more
    fat loss, which you ranked higher."
  - safetyMargin: "A plan with weekly 24-hour fasts was considered, but on training weeks it would take energy
    availability below the safe floor (28 kcal per kg lean mass on day 23)."
  - noGoalGain: "A plan with 24-hour fasts gave the same fat loss within 0.1 kg, with higher hunger peaks (+12 points)
    and 1.3 kg more lean-tissue loss, so this plan was kept."
  - difficulty: "A plan with a 48-hour fast reaches 0.4 kg more fat loss but is harder than Easy allows; see Hard."
- When fasting is not offered: one sentence from the gate reason ("Fasting was not considered: muscle gain ranks above
  your autophagy goal.").
- The forbidden-pattern scanner of item 5 runs over these texts for every golden request.

### 3.7 Preflight hints [PLAN-8.6] (`src/features/planner/preflight.ts`, E2)

| id | Condition | Severity | Copy (title / body) | Action |
|---|---|---|---|---|
| `fasting-short-longest` | opted tier T2/T3 and longest fast < tier max | info | "You've opted in to fasts up to 72 h, but your longest fast is set to 24 h." / "Plans can't use 48- or 72-hour fasts." | `{ kind: 'set-longest-fast', hours: 48 \| 72 }` |
| `fasting-muscle-above` | tier opted or prefers fasting, gate false because a muscle goal ranks above servedGoal | info | "With muscle ranked above {goal}, plans won't use fasting." / "Long gaps without protein slow muscle gain." | none |
| `fasting-no-goal` | tier T2+ opted, no goal served, no preference | info | "None of your goals gains from fasting, so plans won't include fasts." | none |
| `transient-no-fast` | (exists) | info | unchanged | unchanged |

- `HintAction` gains `{ kind: 'set-longest-fast'; hours: 48 | 72; label: string }`.
- Default: while the user has never set `longestFastH`, it follows the opted-in tier (T2 → 48, T3 → 72), else 24.
- The existing `fasting-muscle` hint ("top two") is replaced by `fasting-muscle-above`.

### 3.8 Regression tests (MUST)

1. `fasting.autophagyFirst.test.ts`: autophagy index #1, fat mass #2, T3 opted in, longest fast 72 h, training 2-4
   days, tier M → `status 'ok'`, ≥ 1 rung with `usesFast`; the same with 0 training days; ketosis-first with T2 → ≥ 1
   rung with `usesFast`.
2. Golden (d): ≥ 1 rung `usesFast` (the diagnosis' 72-h plan wins on goals once §3.4 lands); every rung without a fast
   has a rival whose reason is not `notEvaluated`.
3. Fat loss #1, muscle #2, T3 opted in: `fasting.offered === true`; any rung without a fast names goalLoss or
   noGoalGain with lean-tissue or hunger numbers.
4. Gate truth table (§3.1), EA invariance (§3.2), keto-fed scope (§3.3), classification (§3.5), preflight hints (§3.7),
   `expertMode` pass-through (`request.test.ts`).

### 3.9 Modelling gaps [PLAN-8.7] (engine follow-up, not E6)

Hunger relief during multi-day fasts (dossier 20; 05 and 12 disagree on the ketone hunger factor) and a lower lean cost
of 24-h fasts at higher body fat are engine questions. If they change, the numbers in §3.6 texts change; the tests
assert structure (reasons, presence of fasts), not magnitudes.

---

## 4. Algorithm v2 (item 17)

R6 turns into a contract here. The problem is a sequence of constrained single-objective problems (ε-lexicographic),
so CMA-ES stays the core; structure search becomes a grammar enumerator plus successive halving; the ladder (attainment
vs D) is solved by ε-constraint on a QD archive with D as its first axis; robustness uses separate selection and holdout
ensembles. Rejected with reasons in R6 §2: NSGA-II/III and MOEA/D as primary, Bayesian optimisation and surrogate EAs,
exact DP/MILP over the grammar, reinforcement learning, WebGPU for the engine.

### 4.1 Problem

x = (s, z): s a structure, z ∈ [0,1]^{n(s)} (n ≈ 15-35; integer genes with the CMA-ES margin), evaluated on the nominal
θ and on ensemble draws (common random numbers). ≈ 12 ms engine + 2.6 ms domain per 180-day evaluation; ≈ 330 EU/s on
8 Node workers including serial parts (R6 §1).

### 4.2 Pipeline [R6 §3.1]

| Stage | Purpose | Output |
|---|---|---|
| P0 | calibrate (ms/EU), compile request, enumerate 𝒮 (§4.4), baseline run, selection and holdout ensembles, `maxFastingPattern`, `complexityCeiling`, φ_life ranges | context, structures, ensembles |
| P1 | seeds: canonical routes (`reach.ts` `canonicalSeeds`), block defaults; k-NN warm-start library [BENCH] | seed records |
| P2 | structure race: successive halving over 𝒮 on the stage-1 key (§4.5) | survivors (diversity-guarded) |
| P3 | ε-lexicographic stages k = 1..K on survivors, quantised stage key (§4.3) | Hard (provisional), floors |
| P4 | QD: CMA-MAE [BENCH; baseline CMA-ME] over `[D, b₁, b₃, b₄]`; structural emitter kept | archive, staircase F(D̄) |
| P5 | ladder: Easy and Medium ε-constraint solves (§1.3) | rungs (provisional) |
| P6 | Ideal on the relaxed request, warm-started from Hard; limit shadow prices (§2) | Ideal, limit costs |
| P7 | robust: SAA polish (L/X), chance-constraint repair, holdout ensemble, ranking and selection among ties (OCBA) | robust rungs |
| P8 | verify and explain: independent validator, Simulator-mode run, ablations, conflicts, fasting rivals (§3.6), per-rung time to target (§1.4), session composition and shopping lists (§8) | `PlannerResultV2` |

Anytime: provisional Hard after P3 stage 1; provisional Easy/Medium from the staircase as soon as their constraints are
met; provisional Ideal after its stage 1. Events whose rung set changed are never throttled (QA item 8 rule, kept).

### 4.3 Keys (lexicographic, smaller is better) [R6 Fix 1, PLAN-8.4]

```
q_k   = max(0.01, ½ × P10-P90 half-width of d̃_k over the P0 probe plans)       (per goal; replaces PROVISIONAL_QUANTUM for keys)
q_G   = max(0.01, ½ × P10-P90 half-width of G over the probe plans)
stageKey_k   = ( v_S, v_L(j<k), −⌊d̃_k / q_k⌋, R + α·box, −d̃_k )
anchorKey_k  = unchanged (single goal, no regulariser)
finalKey     = ( v_S, v_L(all; relaxed for alternatives), −⌊G / q_G⌋, R + α·box, −G )
archiveKey   = finalKey with relaxed floors
ladderKey    = ( v_S, max(0, thr_1 − d̃_1) + Σ_{j≥2} 2^{−j}·max(0, thr_j − d̃_j), ⌊D / q_D⌋, −⌊d̃_2/q_2⌋, …, −⌊d̃_K/q_K⌋, R + α·box )
               thr_j = the rung's goal constraints of §1.3
robust final = as finalKey with d̃ replaced by: P(target met) for target goals (tie-broken by mean shortfall),
               ensemble-mean d̃ for maximise/minimise goals; CVaR₀.₂ instead of the mean when strictness = 'strict' [PROPOSED mapping]
```

- The η·R term disappears from inside the goal term; R acts only between plans with equal quantised levels.
- Floors from stage winners stay lower bounds (R6 Fix 2): tier X re-runs each stage from its incumbent and recomputes
  floors; the harness reports how often a cheaper tier's floor sits more than δ_k/2 below X's.
- Goals 5-6 on tier S enter only G unless the budget allows a stage [BENCH, R6 §2.1].

### 4.4 Structure enumeration (grammar) [R6 §3.2]

- Generate from `Plan := Segment{1..P_max}` (P_max = 3; 4 on L/X when the horizon ≥ 20 weeks [PROPOSED]),
  `Segment := Phase(block) | Cycle(on, B8)`, plus ≤ 1 overlay family and ≤ 1 event family, plus supplement and sleep
  flags. Transitions come from registry data (`BlockDef.entryFrom` / `exitTo`, new fields encoding today's 13 §4C
  sequencing rules), not from a hand-written pattern list.
- Gates per §6.2 only: tiers and consent, user limits, energy-envelope feasibility, horizon fit, the fasting gate
  (§3.1). Every gate is registered.
- Canonicalise and drop symmetric or dominated forms (adjacent identical phases merge; a cycle with zero off-weeks is a
  phase; overlays outside allowed blocks dropped).
- The prior score only orders the race; it never truncates, except the ≤ 60 cap on tier S (the harness reports the regret
  that cap costs). The evidence-grade term is removed from the prior (R5 §7).
- Structure ids are canonical strings; all orderings tie-break on id, so enumeration order is deterministic.

### 4.5 Structure race (successive halving) [R6]

```
round r: every surviving s runs warm CMA-ES (σ0 0.25; from x0 or the best seed mapped to s) for b_r EU on the stage-1 key
keep the top ⌈|𝒮_r| / η⌉, η = 3; b_{r+1} = η · b_r
diversity guard: keep ≥ 2 structures per goal class present and ≥ 1 per occupied D tercile
instances interleave round-robin per generation in structure-id order (fills workers; deterministic)
```

Round budgets per tier in §4.8. Tier X "continue": a further round over the top 5 with 3× budget until the best key has
not improved for two rounds (the stopping rule shown in the UI).

### 4.6 Quality diversity

CMA-MAE [BENCH] replaces CMA-ME only if the harness gate (§5.4) passes on T4 and R2 (QD-score, staircase hypervolume,
ladder distinctness pass rate). Until then CMA-ME with the new descriptors and keys. MO-CMA-ES and NSGA-II run in the
harness only, as comparators on the ladder frontier (T4).

### 4.7 Robust evaluation [R6 §2.3]

- Search on the nominal model (P2-P5); robustness at P7: chance constraints (every margin's P10 ≥ 0) with
  tighten-and-repolish (unchanged), SAA polish on the CRN-mean key (M_s 8 on L, 16 on X).
- Two ensembles per request: **selection** (stream `ensemble/selection`) and **holdout** (stream `ensemble/holdout`).
  Scorecards, bands, P(target met) and every number shown come from the holdout; provenance stores the selection-minus-
  holdout gap per goal.
- Ranking and selection: finalists within the practically-tied band get extra selection draws (OCBA-style) before the
  final pick, instead of a flat M.
- Ensemble sizes, selection / holdout: S 16 / 32, M 32 / 64, L 64 / 64, X 128 / 128.

### 4.8 Budgets and tiers [R6 §3.3]

| Tier | EU | Desktop / phone | P2 race | P3 stages | P4 QD | P5 ladder | P6 Ideal + limit costs | P7-P8 | CMA |
|---|---|---|---|---|---|---|---|---|---|
| S | 3k | ≈ 10 s / ≈ 50 s | 20 % (≤ 60 structures; rounds 10 → 30 EU) | 30 % | 10 % | 12 % | 13 % | 15 % | sep, IPOP |
| M | 12k | ≈ 40 s / — | 20 % (all; 3 rounds) | 30 % | 15 % | 10 % | 12 % | 13 % | full, IPOP |
| L | 40k | ≈ 2 min / — | 25 % (all; 4 rounds) | 25 % | 15 % | 10 % | 10 % | 15 % | full, IPOP |
| X | 0.3-1 M, open | 15-60 min, desktop only | 45 % (rounds 300 → 900 → 2.7k → 8.1k EU per survivor) | 15 % (re-run from incumbent, BIPOP) | 15 % | 8 % | 7 % | 10 % | full, BIPOP |

- Phones are offered S by default and M on request; L and X are desktop only. The device calibration still picks the
  default tier for a ≈ 10 s target.
- Unused share of a stage rolls forward to the next stage in table order; P7-P8 may borrow from P6 (safety outranks
  explanations).

### 4.9 Exhaustive tier X

- Starts only from an explicit user action ("Find the best possible plan"), shows estimated time from calibration,
  holds a Web Lock while running, keeps running while the user uses the rest of the app, and pauses when the page is
  hidden (as today).
- **Checkpoint** every 60 s and at every stage end to the local store (IndexedDB through A1's store API), key =
  hash(canonical request, engine version, registry hash, library version, planner version):

```ts
export interface PlannerCheckpoint {
  key: string; version: 1; createdAt: string; euUsed: number; stage: string;
  rng: Record<string, [number, number, number, number]>;        // named-stream states (xoshiro128**)
  race: { round: number; survivors: string[]; budgets: Record<string, number> };
  cma: Array<{ structureId: string; mean: number[]; sigma: number; C: number[] | null; diagC: number[] | null;
               pc: number[]; ps: number[]; gen: number; restarts: number; lambda: number }>;
  archive: Array<{ cell: number; structureId: string; x: number[]; out: SerializedEvalOutput }>;   // EvalOutput, typed arrays as number[]
  floors: number[]; incumbents: Record<string, { structureId: string; x: number[] }>;
  curve: ConvergencePoint[];
}
export interface ConvergencePoint { eu: number; wallMs: number; stage: string; keyHard: number[]; G: number; hvLadder: number }
```

- A resumed run is bitwise identical to an uninterrupted one (harness test, §5). A checkpoint whose key differs from
  the current request is discarded with a message, never merged.
- The UI streams `ConvergencePoint`s (best G and ladder hypervolume against EU and wall time) so the wait is visible.

### 4.10 Parallelism

- Workers: N = clamp(cores − 1, 1, 8) on S/M/L, ≤ 3 on phones; tier X MAY use clamp(cores − 1, 1, 16). λ stays a tier
  quantum (S 3, M/L/X 8), never the worker count; outputs are assembled by request index, so results are bitwise
  identical for any N (existing tests extend to X).
- The race fills workers with many independent CMA-ES instances; generations are synchronous across instances.
- No WebGPU for the engine (no f64; would break bit-identical Simulator/Planner agreement) [R6]; a GPU ensemble
  pre-screen is revisited only if the harness shows ensemble cost dominating tier X. A phase-boundary prefix cache
  (snapshot reuse for identical genome prefixes) comes first [BENCH].

### 4.11 Determinism and seeding

- Request seed: `request.seed` if given, else `req-` + FNV-1a of the canonical request (as `seedOf` today) +
  engine version + registry hash.
- Named streams (`Rng.fork(label)` derives from the key, not the parent state), fixed labels:
  `ensemble/selection`, `ensemble/holdout`, `race/<structureId>/<round>`, `stage/<k>`, `qd/<emitter>/<i>`,
  `ladder/<rung>`, `ideal/stage/<k>`, `limit/<group>`, `rival/<rung>`, `replan/<date>/<kind>`. Adding a stage never
  changes the draws of another.
- Determinism tests: 1/2/4/8 workers bitwise; tier X resume equals uninterrupted; same request twice equals itself;
  `registryHash` and engine version differences refuse comparison (MODEL_SPEC §10.4).

### 4.12 BENCH items (enter only through the gate of §5.4)

CMA-MAE vs CMA-ME; ε-level and augmented-Lagrangian constraint handling vs Deb's rules (expected to matter where fasts
and training interact with the EA floor); lq-CMA-ES on the goal-1 stage; k-NN warm-start library (offline tier X on a
synthetic corpus; 1-5 MB, unverified); MO-CMA-ES and NSGA-II as ladder comparators; prefix cache; the K ≥ 4 cut-off on
tier S; Shapley limit attribution on tier X.

---

## 5. Benchmark harness

Must exist and produce a v1 baseline before any v2 algorithm change merges (R6 §6).

### 5.1 Layout and commands

- Code: `src/engine/planner/bench/` (`suites/`, `metrics.ts`, `stats.ts`, `runner.ts`, `report.ts`), owned by E6.
- `pnpm bench:planner` (selection by env: `BENCH_SUITE=T2,R1 BENCH_TIER=S BENCH_SEEDS=31 BENCH_SPLIT=train`) runs a vitest config
  (`vitest.bench.config.ts`) in Node with `worker_threads` running the browser pool code. Outputs
  `bench-results/<date>-<run-id>.json` and regenerates `docs/PLANNER_BENCHMARK.md` plus
  `docs/planner-benchmark.json` (summary only).
- `pnpm test` runs a smoke subset (≤ 60 s): T1 sphere, one T2, one T3 and one R1 micro space at 3 seeds, asserting the
  metrics pipeline and that v2 is not worse than the stored baseline summary by more than the non-inferiority margin.
- The v1 planner is frozen behind an adapter (`bench/baselines/v1.ts`) so every v2 change is measured against it and
  against the previous v2 release.

### 5.2 Suites [R6 §6.1]

| Suite | Construction | Ground truth |
|---|---|---|
| T1 continuous | sphere, ellipsoids, Rosenbrock, Rastrigin at n = 10/20/40 (existing toys) | analytic |
| T2 planted lexicographic | K = 2-4 goals on a mixed (s, z) space; goal 1 a shifted ellipsoid with a plateau of optima; goal 2 defined on the plateau; integer genes; 2 linear constraints active at the optimum | analytic lex optimum and floors |
| T3 needle in structure | 50-400 structures; the optimum lies in one structure with poor random probes; decoys probe well | known |
| T4 ladder frontier | bi-objective (attainment, D) with convex, concave and disconnected fronts | analytic front |
| T5 noisy | T2 with θ-dependent shifts and M draws | exact 𝔼, CVaR, P(met) on 10⁴ draws |
| R1 micro plan spaces | golden requests a-e plus autophagy-first restricted to 1-3 structures and 4-6 genes on their friendly grids (5k-30k plans each) | exhaustive enumeration under the same comparator; ensemble truth at M = 256 for the top 50; cached per engine version + registry hash |
| R2 full requests | golden a-e, autophagy-first, 20 seeded fuzzed requests (training split 10, holdout 10) | best ever found (all tiers, all seeds, tier X) stored in `bench/reference/<engine hash>.json` |

### 5.3 Metrics [R6 §6.2]

- Lexicographic regret r_k = d̃_k(x*) − d̃_k(x̂); **lex-success** = P(r₁ ≤ δ₁/2 and, if so, r₂ ≤ δ₂/2, …); first
  failing stage.
- Goal-1 regret in physical units (kg, cm) for user-facing claims.
- Time to quality: EU and wall time to first reach {50, 80, 90, 95, 99 %} of the reference attainment; ECDF over
  (problem, target); ERT with restarts; area under the ECDF as the anytime score.
- Ladder: 2-D hypervolume of {(g, 1 − D)} for the returned rungs and for the staircase (reference point (0, 0)); IGD⁺
  against the reference front; distinctness pass rate; monotonicity violations.
- QD: QD-score and archive coverage. Robustness: selection-minus-holdout gap; P90 safety satisfaction on a fresh 256-draw
  ensemble (must be ≥ 0.9 for every margin of every returned plan); decision stability.
- Fasting: on R2 requests with a fasting-served goal, the share of runs with ≥ 1 rung using a fast or a non-`notEvaluated`
  rival.
- Cost: wall time on the reference desktop (8 cores) and a phone profile, EU, peak memory. Safety violations: must be 0.

### 5.4 Statistical protocol and acceptance gate [R6 §6.3]

- ≥ 31 paired seeds per (algorithm, problem) on T-suites and R1; 15 on R2. Pairing: the same seed drives the same
  ensembles and LHS (common random numbers).
- Paired Wilcoxon signed-rank per problem; Holm-Bonferroni across problems; Vargha-Delaney Â₁₂ (0.56 / 0.64 / 0.71 =
  small / medium / large); Friedman with post-hoc only for ≥ 3 algorithms over many problems; bootstrap 95 % CIs
  (10⁴ resamples) for ERT and medians.
- **Gate:** (1) non-inferior on every suite: median lex-success not lower by more than 2 points and goal-1 regret not
  worse by more than 1 % (one-sided, α = 0.05); (2) superior on ≥ 1 suite (Holm-adjusted p < 0.05 and Â₁₂ ≥ 0.56) or
  equal quality at ≥ 20 % less wall time; (3) every safety, golden, fasting-regression and audit test passes; (4) bitwise determinism
  across worker counts and resume.
- Constants are tuned only on the training split; the gate runs on the versioned holdout split, which is never tuned on.

### 5.5 Publishing (E15)

- `docs/PLANNER_BENCHMARK.md` is bundled like `docs/VALIDATION_REPORT.md` (`import.meta.glob` raw import in
  `src/features/evidence/validationReport.ts` or a sibling loader) and shown as a "Planner" section of
  Evidence › Validation: headline table (lex-success, goal-1 regret, time to 95 %, ladder hypervolume, coverage audit
  summary), ECDF and convergence plots rendered from `docs/planner-benchmark.json`, machine and date, engine hash.
- The report text follows item 5 (topic names, no dossier numbers); it states plainly what is and is not proven
  ("returned plans are within X of the best plan found by exhaustive search on small spaces").

---

## 6. Evidence-coverage audit

### 6.1 Evidence graph: attachment metadata [R6 §7.1, R5]

`src/engine/planner/domain/evidenceGraph.ts` (data plus generators). Generated where possible from the lever registry,
block registry, module contracts and the E8 catalogue mappings; the rest hand-entered from the dossiers.

```ts
export type MechanismStatus = 'modelled' | 'mapped' | 'infoOnly';  // R5: reaches engine state directly / via a mapping / not
export interface EvidenceEdge {
  id: string;                                         // stable, e.g. 'fastDay24>autophagy.signal>autophagyIdx'
  from: { kind: 'lever' | 'block' | 'catalogue' | 'input'; id: string; params?: Record<string, number> };
  mechanism: { module: string; paramIds: readonly string[]; signals: readonly string[]; series: readonly SeriesId[] };
                                                      // engine module, registry params and bus signals on the path, observable series
  metric: MetricId;                                   // goal metric reached
  sign: 1 | -1 | 0;                                   // effect on the metric; 0 = condition-dependent
  condition?: EdgeConditionId;                        // machine-checkable: 'deficit' | 'rtPresent' | 'muscleGoal' | 'lowBodyFat' | …
  status: MechanismStatus;
  certainty: EvidenceGrade;                           // recorded, never used to drop or weight an edge
  source: { topic: string; refs: readonly string[] }; // user-facing structured reference (item 5)
  maintainerRef: string;                              // e.g. '20 §4C' — code and docs only, never rendered
  probe?: { persona: 'man88' | 'woman78' | 'leanTrained'; base: ProbePlanId; toggle: ProbeToggle };
  noiseFloor?: number;                                // metric units; default = ½ P10-P90 half-width on the probe
}
```

Uses: the fasting gate's `servesFasting` (§3.1); the explanation "why" sentences; the Evidence library's "what moves this
metric" lists; the audit below. `infoOnly` edges are listed in Evidence as "known mechanism, not yet in the model".

### 6.2 Gate registry

Every `if` that removes structures, levers or gene range MUST be a registered gate.

```ts
export interface GateDef {
  id: string;                                  // 'fasting.offered', 'surplus.noFasts', 'refeed.deficitOnly', …
  where: string;                               // file and function
  removes: 'structures' | 'levers' | 'geneRange';
  predicate: string;                           // plain description
  source: { topic: string; refs: readonly string[] } | null;   // null fails the audit
  maintainerRef: string;
  kind: 'safety' | 'consent' | 'userLimit' | 'evidence' | 'feasibility';
}
```

### 6.3 Checks [R6 §7.2]

| # | Check | Pass criterion | Runs in |
|---|---|---|---|
| 1a | Lever reachability (static) | every `plannerUsable` lever and phase/overlay/event block appears in ≥ 1 enumerated structure over the coverage corpus (all goal classes × opt-in combinations × typical limits, ≈ 200 seeded requests) | `pnpm test` |
| 1b | Gene range | decoding gene corners 0 and 1 reaches the registry's min and max engine inputs; a gene repaired on > 50 % of LHS samples is reported (effectively fixed) | `pnpm test` |
| 1c | Dynamic reachability | for each lever ℓ with an edge that helps a ranked goal in some corpus request, the final archive holds a feasible plan using ℓ, or the explanation names ℓ as considered and rejected with its numbers | `pnpm audit:planner` |
| 2 | Mechanism liveness | each `modelled`/`mapped` edge: toggling `from` on its probe moves the metric by > noise floor with the stated sign (under its condition); stubbing the module kills the effect; an engine effect above the noise floor with no edge is reported as "undocumented mechanism" | reduced probe set (3 personas, nominal runs, ≈ 300 runs) in `pnpm test`; full set in `pnpm audit:planner` |
| 3 | Goal evaluator completeness | the planner functional of every goal metric reads the series its edges touch (`plannerSeries` ⊇ edge series); Simulator-mode and planner-mode goal values agree on 50 random plans within 1e-9 relative | `pnpm test` |
| 4 | Dead-field test (opt-ins and limits end to end) | for every field of `ConstraintDraft`, `SafetyOptIns`, `PracticalConstraints`, `PlannerSafetyInput` and the E7/E8 intake: classed in `LIMIT_CLASS`; traced UI state → request → caps/context → structure set and gene bounds → validator; relaxing it enlarges and tightening it shrinks the reachable set for ≥ 1 corpus request (metamorphic) | `pnpm test` (decode-level, no engine) |
| 5 | Gate cost | each registered gate is removed in turn and the corpus re-planned at tier S; a safe plan that improves a ranked goal by > δ_k is flagged for review with numbers; an unsourced gate fails | `pnpm audit:planner` |
| 6 | Explanation honesty | every claimed lever contribution re-verifies by ablation (existing), every fasting rival's numbers re-verify | `pnpm test` (golden) |

- Check 4 would have caught the `longestFastH` default and the missing `expertMode` pass-through; check 5 the
  "muscle goal in the top two" rule.
- `pnpm audit:planner` (≈ 10-20 min, local) runs before every release: E6 adds it to the `release` script chain
  after `test:release`. There is no CI; `pnpm test` is the always-on gate.
- Output: `docs/PLANNER_COVERAGE.md` and a JSON summary (levers reachable %, edges live %, dead fields, flagged gates,
  undocumented mechanisms), published with the benchmark (§5.5).

---

## 7. Receding-horizon re-plan for the living plan (item 6; E5 owns lifecycle, logs and state estimation)

### 7.1 Inputs

```ts
export interface ActivePlanRecord {                 // stored by E5 (A1's plan lifecycle); the planner reads it
  planId: string; version: number; kind: RungId;    // the rung the user started (never 'ideal')
  request: PlannerRequestV2;                        // goals with targets frozen as ABSOLUTE values at plan start
  startDate: string; endDate: string;
  structureId: string; genome: number[]; schedule: Schedule;
  provenance: PlannerResultV2['provenance'];        // seed, engine/registry/library/planner versions, difficulty weights
}
export interface ConfirmedState {                   // produced by E5 at a check-in (R11 §3.3)
  anchorDate: string;
  snapshot: EngineSnapshot;                         // nominal engine state at the anchor (RunOptions.initialSnapshot)
  particles?: { weights: number[]; snapshots?: EngineSnapshot[] };   // R6 §5 reweighted selection ensemble; uniform if absent
  energyBiasKcal: { mean: number; sd: number };     // R11 δ, applied as an intake offset in every forward run
  trendWeight: { kg: number; sd: number };
}
export interface LoggedDay { date: string; inputs: DayTemplate; items: ItemOutcome[]; coverage: number }
export interface ItemOutcome { itemId: string; type: PlanItemType; status: 'done' | 'partial' | 'skipped' | 'unknown';
                               credit: number | null; performed?: StimulusVector }
export interface BlockAdherence { type: PlanItemType; weekday?: Weekday; a: number; b: number; opportunities: number }
export type ReplanKind = 'light' | 'weekly' | 'event' | 'user';
export type ReplanTrigger = 'nudge' | 'checkin' | 'absence' | 'missedBlocks' | 'lowAdherence' | 'outOfBand'
  | 'requestChange' | 'safetyAhead' | 'user';                   // §7.5
export interface ReplanRequest {
  kind: ReplanKind; today: string; plan: ActivePlanRecord; state: ConfirmedState;
  logs: LoggedDay[];                                // since the anchor
  adherence: BlockAdherence[];                      // Beta posteriors, half-life 21 d, prior Beta(6, 2) (R11 §4.3)
  trigger: ReplanTrigger;
  changes?: Partial<Pick<PlannerRequestV2, 'goals' | 'constraints' | 'safety' | 'horizonDays'>>;  // user edits
}
```

### 7.2 What may change

- Days before `today` are immutable (they are logs). Days from the anchor to yesterday are replayed with logged inputs
  from the confirmed snapshot; the forecast starts today.
- Lock window: today and tomorrow keep their prescription unless a safety margin would break or the user asks
  (`light` re-plans MAY adjust tomorrow's energy by ≤ ±10 %, R11 §4.4).
- Horizon: shrinking to `endDate` (the minimum horizon drops from 28 to 7 days in re-plan mode); goals keep their
  absolute targets ("lose 10 kg" stays measured from the plan start). In the last 7 days the horizon grows to
  `today + 7`, and every re-plan there (including one that keeps the schedule) returns the grown record as status `ok`
  (a new version), so the end date does not depend on whether the search changed anything.
- `light` (daily, only when the logged day departed from the prescription): next 7 days only; structure and rung
  fixed; continuous genes within the churn limits of §7.4; budget ≈ 1k EU; σ₀ 0.05.
- `weekly`: remaining horizon; structure may change only to a grammar neighbour (§4.4 moves) unless infeasible; rung
  kept unless it became infeasible or another rung now dominates it (then proposed, not applied).
- `event` and `user`: full v2 pipeline at the user's tier on the remaining horizon; a new ladder MAY be offered.
- Safety: re-plans run the same three safety layers and R-PLAN-SAFETY on the remaining horizon, with fasting-tier
  spacing counted across the logged past (a fast logged 10 days ago constrains the next one).

### 7.3 Warm start

Shift the active genome by the elapsed days (segment weeks shortened; elapsed segments frozen and dropped from the
genome), transfer by gene path (`transferGenome`), seed the archive with the shifted plan and its rung neighbours, and
start CMA-ES at σ₀ 0.05 (light) or 0.10 (weekly).

### 7.4 Stability (no churn)

- Churn distance C(new, old) = Gower distance over the next 14 days' features (§1.1 φ_life plus day-level energy,
  sessions and fasts).
- Keys: churn enters only inside the practical-tie band, `( v_S, v_L, −⌊G/q_G⌋, λ_S·C + R, −G )`, λ_S = 1 [PROPOSED]:
  a re-plan never trades goal progress for stability, and never changes the plan for noise.
- Hard limits for `light` and `weekly` [PROPOSED]: next-7-day mean energy within ±10 %; sessions ±1 per week; no new
  fast ≥ 24 h within 7 days unless the user asks; no new day-type in the next 7 days.
- Automatic changes may only lower load (R11 §4.3); raising load, adding a fast or moving up a rung needs consent and is
  returned as a proposal.

### 7.5 Triggers and cadence (R6 §5 and R11 §4.4 reconciled)

| Trigger | Re-plan |
|---|---|
| Each logged day | E5 replays and updates the filter; if the day departed from the prescription (skipped item, energy off by > 10 %), `light`; otherwise nothing |
| Weekly check-in (≥ 4 weigh-ins in 7 d or ≥ 10 in 14 d; R11) | anchor move by E5, then `weekly` |
| Declared absence, illness, travel ("no training for 3 days") | `event` immediately, with the goal impact stated |
| ≥ 3 consecutive missed items of one block type, or 7-day adherence < 70 with ≥ 4 scored days | `event` (load-lowering swaps auto, others proposed) |
| Trend outside the holdout P10-P90 band on ≥ 3 consecutive weigh-in days | flags the next `weekly` as full (structure moves allowed); the goal date moves only when outside the band at two check-ins running (R11) |
| Goal, limit, opt-in or safety-answer change | `event` |
| A safety margin predicted to bind within 7 days | `event`, safety first, bypasses the lock window |
| Rate changes < 0.4 kg/week within 14 days | never a trigger (undetectable, R11 §3) |

### 7.6 Revealed adherence in the forward model

- Realistic projection: each prescribed item is simulated at the expected credit E[c] = a/(a + b) of its type's posterior (engine
  inputs scaled by credit: sets, minutes, deficit depth; fasts kept with probability E[c]); the as-prescribed curve stays
  the target. Both curves are reported.
- The objective of `weekly`/`event` re-plans is evaluated on the realistic projection, so the optimiser prefers what the
  user actually does ("stop prescribing it").
- Swap rule (R11 §4.3): after ≥ 8 opportunities, E[c_b] < 0.5 and the 80 % upper bound < 0.7 → propose the
  nearest-equivalent easier prescription (same stimulus class, lower D component); auto-apply only when it lowers load.
  Weekday rule: c < 0.4 on ≥ 3 of the last 4 occurrences of a weekday → move the block.
- Ladder interaction: a rung whose realistic projection falls below the next-lower rung's as-prescribed result is
  flagged; the proposal is "move to Medium/Easy".

```ts
export interface ReplanResult {
  status: 'ok' | 'unchanged' | 'proposal' | 'noSafePlan';
  plan: ActivePlanRecord;                           // new version (or the same when unchanged)
  diff: Array<{ date: string; field: string; before: string; after: string; why: string }>;
  forecast: { asPrescribed: GoalOutcome[]; realistic: GoalOutcome[]; bands: Partial<Record<SeriesId, DailyBand>> };
  goalDates: Array<{ goal: number; before: string | null; after: string | null; range: [string, string] | null }>;
  proposals: Array<{ id: string; text: string; raisesLoad: boolean; apply: ReplanRequest['changes'] }>;
  explanation: string[];
  euUsed: number;
}
```

---

## 8. Equipment-aware prescription (item 11; E8 owns catalogues and stimulus mapping)

`R3-exercise-equipment.md` (landed 19:17) settles the stimulus currency, the bodyweight/odd-object load mapping
(L_eq = 100/(1 + R_f/30)), hybrid compilation, the equivalence score and the availability weights; this section fixes
how the planner uses them. `[R3]` marks values taken from it.

### 8.1 Catalogue contracts (aligned with `R3-catalogue-seed.json` schema R3-0.1)

```ts
export interface EquipmentItem { id: string; name: string; category: string; loadRangeKg?: [number, number];
  adjustable: boolean; enablesPatterns: MovementPattern[]; priceTier: 0 | 1 | 2 | 3 | 4 | 5; space: 'small' | 'medium' | 'large' }
export interface ExerciseRecord {
  id: string; name: string; tradition: string;            // 'gym' | 'home' | 'indian' | …
  equipmentAnyOf: string[][];                              // alternatives; each inner list is needed together
  pattern: MovementPattern;                                // R3 vocabulary: 'squat' | 'hinge' | 'horizontalPush' | …
  regions: Partial<Record<TrainingRegion, number>>;         // hard-set credit per region
  loadType: 'external' | 'bodyweight' | 'band' | 'club' | 'mace' | 'machine' | 'none';
  intensityScale: 'pct1RM' | 'rpe' | 'met'; defaultDose: { sets: number; reps?: number; durationSec?: number; rir?: number; restSec?: number };
  secPerRep?: number; energy: { metGross: number; metRange: [number, number] };
  cardioModality: CardioModality | null; hybridCardioShare: number;
  skill: 1 | 2 | 3 | 4 | 5; injuryRisk: 1 | 2 | 3 | 4 | 5; contraTags: string[];
  mechanism: string; status: MechanismStatus; certainty: EvidenceGrade;
  loadFactor?: { min: number; mode: number; max: number };  // R5 mapping τ for mapped items (e.g. gada 0.45/0.8/1.0)
}
export interface TrainingProfile {                         // E7 intake
  owned: string[]; access: Array<{ place: 'home' | 'gym' | 'park' | 'other'; equipment: string[]; weekdays: Weekday[] }>;
  refused: string[]; liked: string[]; injuries: string[]; skill: 1 | 2 | 3 | 4 | 5;
  purchaseAllowance: { maxPriceTier: 0 | 1 | 2 | 3 | 4 | 5; maxItems: number };   // default {0, 0} [OPEN]
}
```

### 8.2 Dose envelope: equipment as a practical limit

`trainingEnvelope(profile, catalogue, caps): TrainingEnvelope` (E8) gives, from available ∪ purchasable-within-allowance
equipment and willing, injury-safe exercises: per region the maximum deliverable effective sets per session and the
highest load (%1RM; bodyweight, band and odd-object work via R3's L_eq from reps to failure); the cardio modalities;
patterns coverable. The planner (P0) bounds its genes by it: `rt.sets` per region, `loadPct1RM` (strength goals
82 % only if some region set can reach ≥ 80 %), `cardio.modality` options. The envelope belongs to limit group
`equipment`; the Ideal uses the full-catalogue envelope, which is what makes shopping lists (§8.5) principled.

### 8.3 Session composer (`composeSessions`, E8; deterministic)

Input per session: `{ date, startH, maxMin, setsByRegion (effective), loadPct1RM, rir, style }` or
`{ modality, minutes, pctVo2max }`, plus the profile, the catalogue and the previous 14 days of composed sessions.

1. Candidates: catalogue ∩ available that day (owned ∪ access place for that weekday ∪ items in the plan's purchase
   list) ∩ not refused ∩ no `contraTags` ∩ injuries ∩ skill ≤ user skill + 1 ∩ impact allowed by HC-X4/X5.
2. Utility per slot [R3 §6]: U = 3·avail + 1·enjoy + 2·cover_s(e) − 0.5·minutes/10 − 0.5·(injuryRisk − 1)
   − 0.3·skillGap; avail = 1 owned, 0.8 access (0.5 outside the user's time window), 0.5 in the plan's allowed purchase
   list [PROPOSED; R3 uses 0 for "must buy" because it has no allowance], cover = S_hyp or S_card of e against the slot.
3. Greedy fill per slot so each weekly region target is met at the lowest time cost: sets n ≤ 5 per exercise; ≤ 2
   exercises per pattern per session; stop when every region is within 0.5 effective set of target or the time cap is
   reached. Time = warm-up 5 min + Σ sets × (reps × secPerRep + restSec)/60. Hybrid and ballistic items (mudgar, gada,
   kettlebell swing, kushti-cadence baithak) compile into a resistance part and a cardio part by `hybridCardioShare`,
   ballistic sets counting 0.5 [R3 §3.3]; this needs the additive engine field `ResistanceSession.met?` (engine owner).
4. One pass of 1-swap improvement; ties broken by exercise id.
5. Loads: reps from %1RM and RIR (09 tables); bodyweight and club/mace work by progression variant; energy from the
   catalogue MET × body mass × minutes.

Output: `ConcreteSession { items: Array<{ exerciseId; sets; reps?; durationSec?; load?; variant?; rir; restSec; kcal }>;
delivered: StimulusVector; shortfall: ShortfallNote[] }`. Tolerance: ±0.5 effective set per region per session and
±10 % per week. A dose the composer cannot deliver within tolerance is outside the envelope; the planner treats it as
infeasible (never prescribes what cannot be done with what the user has). The Simulator schedule written by the planner
carries the composed sessions' delivered `setsByRegion`, so the numbers match what the user is told to do.

### 8.4 Availability scoring in the planner

The plan's equipment burden enters D through component 7 (habit distance: new equipment and new places count as
changes) and through the purchase list (each required purchase adds 0.05 to c₇ [PROPOSED]); no separate objective.

### 8.5 Shopping list

```ts
export interface ShoppingItem {
  equipmentId: string; name: string; priceTier: number;
  required: boolean;                         // the rung's dose cannot be delivered without it
  unlocks: string[];                         // patterns, regions, modalities
  benefit: Array<{ goal: number; delta: number; unit: string }>;   // with − without, holdout P50
  text: string;                              // "To make this plan work you'd need resistance bands (adds 0.3 kg muscle)."
}
```

Per rung and for the Ideal [R3 §6]: for each not-owned item k, ΔU_k = U*(owned ∪ {k}) − U*(owned) (summed slot
coverage minus time cost); rank by ΔU_k / (priceTier_k + 1); omit ΔU_k < 0.05; re-run the rung schedule with the
recomposed dose for the top 3 (nominal + holdout draws) to state the benefit in goal units. Required items (the rung's
dose cannot be delivered without them) come first. With `purchaseAllowance` 0, rungs never require purchases and only
the Ideal lists them ("Your limits cost: no pull-up bar, less back work, −0.4 kg muscle").

### 8.6 Equivalence credit (consumed by E5's adherence score and by E8's swap UI)

```ts
export interface StimulusVector {                                  // R3 §5.1 σ
  effectiveSetsByRegion: Partial<Record<TrainingRegion, number>>;   // E: e_set × region weight (direct 1, indirect 0.5)
  pattern: MovementPattern; loadClass: 'heavy' | 'moderate' | 'light' | 'veryLight';   // ≥ 80 / 60-80 / 35-60 / < 35 %1RM
  netKcal: number; mem: number; hiMinutes: number;                  // cardio: engine memWeight × min; minutes at x ≥ 0.85
  mobilityMinutes: Record<string, number>;
  tauSd?: number;                                                   // R5 mapping uncertainty for mapped items
}
export interface StimulusIntent { hyp: number; str: number; card: number; kcal: number; mob: number }   // sums to 1
export interface PlanSensitivities {                                // computed by the planner per plan version (R11 §4.1)
  planVersion: string;
  itemWeights: Record<PlanItemType, number>;                        // w_i: share of the weighted goal score, ≥ 0.02 floor
  intentByItem: Record<string, StimulusIntent>;                    // α per prescribed item (below)
}
export type StimulusTermId = 'hyp' | 'str' | 'card' | 'kcal' | 'mob';
export interface ShortfallNote { term: StimulusTermId; missing: number; text: string }   // text: "lighter load: add 1 set"
export interface EquivalenceResult { credit: number; parity: boolean; perTerm: Array<{ term: StimulusTermId; ratio: number }>;
                                     shortfall: ShortfallNote[] }
export function stimulusEquivalence(prescribed: StimulusVector, performed: StimulusVector, alpha: StimulusIntent): EquivalenceResult;
export function benefitRetained(plan: ActivePlanRecord, date: string, itemId: string, performed: StimulusVector | DayTemplate): number;
```

- `stimulusEquivalence` [R3 §5]: S = Σ_k α_k·S_k over S_hyp, S_str, S_card, S_kcal, S_mob (R3's component formulas;
  over-delivery capped per component, no cross-component credit). Bands: S ≥ 0.90 full credit (parity), 0.60-0.90
  partial with the largest-deficit fix ("add 1 set", "8 more minutes"), < 0.60 "different stimulus", credited for what
  it trains. Nothing is rejected, and the engine always simulates the logged stimulus; S is the adherence credit only.
- Intent α per prescribed item: from the plan's sensitivities (∂G with respect to each component on that item,
  normalised) when computed; otherwise R3's goal-class defaults (muscle {0.6, 0.15, 0, 0.25, 0}, strength
  {0.3, 0.6, 0, 0.1, 0}, fat loss {0.4, 0.1, 0.2, 0.3, 0}, VO2max {0, 0, 0.7, 0.3, 0}, mobility {0, 0, 0, 0, 1}).
- `benefitRetained` (engine level, R11 §4.1): c = clamp((J(actual) − J(omit)) / (J(plan) − J(omit)), 0, 1) on a 28-day
  forward run from the confirmed state; E5 uses it for the daily score when time allows and falls back to
  `stimulusEquivalence`. The planner computes `PlanSensitivities` at every plan or re-plan (finite differences per item
  type, cached by type, not date).
- Unknown exercises are resolved to a `StimulusVector` by E8 (or the AI through E8's tool) and added to the user's
  catalogue with `status: 'mapped'` and a wider τ; they are never rejected.

---

## 9. Interfaces and migration

### 9.1 E6 work map (owns `src/engine/planner/{optim,domain,bench}` and `src/workers/planner*`)

| Area | Files | Change |
|---|---|---|
| Keys | `optim/goals.ts` | `stageKey`, `finalKey` per §4.3; `ladderKey`; per-goal quanta `q_k`, `q_G` |
| Race, BIPOP, MAE, checkpoint | `optim/pipeline.ts` (split into `pipeline/` modules), `optim/cmaes.ts`, `optim/archive.ts`, new `optim/race.ts`, `optim/checkpoint.ts` | §4.2-4.11 |
| Robust | `optim/robust.ts` | holdout ensemble, P(met) key, OCBA, SAA polish |
| Grammar | `domain/skeleton.ts` → `domain/grammar.ts`; `registry/blocks.ts` (`entryFrom`, `exitTo`) | §4.4, §3.1 grammar changes, Ideal genes |
| Difficulty | `domain/features.ts` | §1.1, descriptors `[D, b₁, b₃, b₄]` |
| Ladder, Ideal, limit costs | new `domain/ladder.ts`, `domain/ideal.ts`, `context.ts` (`LIMIT_CLASS`, `idealRequest`) | §1.3-1.5, §2 |
| Fasting | `context.ts` gate, `explain.ts` verdicts, `planner.ts` rival search | §3 (on top of E2) |
| Reach | `domain/reach.ts` | `rungReach` (§1.4) |
| Re-plan | new `domain/replan.ts`, `domain/sensitivities.ts` | §7, §8.6 |
| Evidence | new `domain/evidenceGraph.ts`, `domain/gates.ts` | §6 |
| Bench | new `src/engine/planner/bench/**`, `vitest.bench.config.ts`, `package.json` scripts `bench:planner`, `audit:planner` | §5, §6 |
| Workers | `src/workers/plannerClient.ts`, `planner.coordinator.ts`, `planner.pool.ts` | `planLadder`, `replan`, checkpoints, X-tier pool size |

### 9.2 Public API

```ts
// src/workers/plannerClient.ts (browser) — Node/tests: runLadderPlanner(request, opts) from '@/engine/planner'
export function planLadder(request: PlannerRequestV2, options?: PlanLadderOptions): Promise<PlannerResultV2>;
export function resumeLadder(checkpointKey: string, options?: PlanLadderOptions): Promise<PlannerResultV2>;   // tier X
export function replan(req: ReplanRequest, options?: { signal?: AbortSignal; onProgress?: (p: PlannerProgressV2) => void }): Promise<ReplanResult>;
export function estimateTargetsAsync(request: PlannerRequestV2): Promise<TargetReach[]>;                     // unchanged (R-TTT)
export function cancelPlanning(): void;                                                                       // unchanged

export interface PlanLadderOptions {
  onProgress?: (p: PlannerProgressV2) => void; signal?: AbortSignal; tier?: 'S' | 'M' | 'L' | 'X'; workers?: number;
  ideal?: boolean; limitCosts?: boolean;             // both default true
}
export interface PlannerRequestV2 extends PlannerRequest {
  training?: TrainingProfile;      // §8.1 (absent: the v1 dose model without composition)
  ladder?: { easyShare?: number; mediumFallbackShare?: number };   // defaults 0.5 / 0.8 [OPEN: user setting?]
}
/** Everything a v1 PlanOption carried, minus `id`; A-relative fields renamed to Hard-relative ones. */
export type GoalScoreV2 = Omit<GoalScore, 'costVsA'> & { costVsHard: number };
export type PlanPayload = Omit<PlanOption, 'id' | 'aBeatsThisShare' | 'fasting' | 'scorecard'> & {
  scorecard: GoalScoreV2[]; genome: { structureId: string; x: number[] };
  hardBeatsThisShare: number | null;
  sessions?: ConcreteSession[];    // §8.3, one per training session of the horizon
};
export interface RungPlan extends PlanPayload { kind: RungId; summary: RungSummary }
export interface IdealPlanV2 extends PlanPayload, IdealExtras { kind: 'ideal'; summary: RungSummary }
export interface PlannerResultV2 {
  status: 'ok' | 'noSafePlan' | 'blocked' | 'invalid';
  complete: boolean; stoppedAt: string | null;
  rungs: Partial<Record<RungId, RungPlan>>;          // hard always present when status 'ok'
  ladder: { collapsed: Array<{ rung: RungId; reason: 'tooClose' | 'notDistinct' | 'belowMinimal' | 'infeasible'; text: string }>;
            checks: { dHM: number; dME: number; gowerMin: number; ordered: boolean } };
  ideal: IdealPlanV2 | null;                          // null when switched off or no safe plan exists even without limits
  feasibility: GoalFeasibility[];                     // texts say "the Hard plan"
  relations: string[]; noSafePlanReasons: string[]; message: string | null; stubModules: string[];
  fasting: { offered: boolean; reason: string; servedGoal: number | null; tierMaxH: number };
  convergence: ConvergencePoint[];
  provenance: Omit<PlannerResult['provenance'], 'tier'> & { plannerVersion: 2; tier: 'S' | 'M' | 'L' | 'X'; holdoutGap: number[];
                                               difficultyWeights: number[]; checkpointKey?: string };
}
export interface PlannerProgressV2 {
  stage: string; fraction: number; euUsed: number; euBudget: number; score: number | null;
  provisional: Partial<Record<PlanKind, { structureId: string; title: string; D: number; percentOfAchievable: number[]; schedule: Schedule }>>;
  changed: boolean;                                   // rung set or any rung changed: never throttled
  convergence?: ConvergencePoint;                     // tier X (and L) stream
}
```

### 9.3 E5 (living plan) consumes

`replan` (§7), `ActivePlanRecord` produced from a `RungPlan` at "Start" (`toActivePlan(result, kind, request)`, which
freezes change targets as absolute values), `PlanSensitivities` via `computePlanSensitivities(plan, state)`,
`benefitRetained` and `stimulusEquivalence` (§8.6), `projectRealistic(plan, state, adherence)` (§7.6), and the
`PlanItemType` vocabulary (`energy`, `protein`, `window`, `fast`, `rtSession`, `cardioSession`, `steps`, `sleep`,
`supplement`). E5 produces `ConfirmedState`, `LoggedDay`, `BlockAdherence` and the triggers of §7.5. The particle
reweighting of R6 §5 and the Kalman trend of R11 §3.2 are E5's; the planner accepts weights when present.

### 9.4 E8 (catalogues) provides

`EquipmentItem`, `ExerciseRecord`, `TrainingProfile` types (§8.1); `trainingEnvelope`, `composeSessions`,
`resolveStimulus(log): StimulusVector`, `stimulusEquivalence` (§8.2-8.6); evidence-graph edges for every catalogue
item (`from.kind: 'catalogue'`, status `mapped` with R5's τ); food and supplement mappings later use the same edge form.
Supplement levers (creatine, omega-3, viscous fibre) keep their registry ids; E8's supplement catalogue maps onto them.

### 9.5 E13 (UI) uses

- Ladder view: three rung cards (title, subtitle, D as 0-100 with component bars, goal outcomes with bands, time to
  target, fasting line, things to buy), the comparison table of §1.5, the Ideal card set apart ("scientific ceiling",
  not startable as is; "Adopt some of these limits"), "What your limits cost" (top 3 `LimitCost`, rest on demand),
  collapse sentences when a rung is missing.
- Run view: provisional rungs as they appear (`PlannerProgressV2.provisional`), the convergence chart, tier X controls
  (start, continue, resume, estimated time).
- Preflight: hints of §3.7 with the new action. Start: from a rung only.
- Copy: Hard / Medium / Easy / Ideal; no A/B/C anywhere; all engine text already free of internal references.

### 9.6 Migration from `planRegimes`

1. v0.2.0 ships `planLadder`; `planRegimes` stays one minor release as a deprecated wrapper that calls `planLadder`
   with `ideal: false, limitCosts: false` and returns the v1 shape (options = hard, medium, easy in that order, ids
   'A'/'B'/'C') for any remaining caller. Removed in 0.3.0. No new code may call it (lint rule).
2. Types: `PlanOption.id` is removed; `GoalScore.costVsA` → `costVsHard`, `aBeatsThisShare` → `hardBeatsThisShare`;
   `PlanOption.fasting` → `FastingVerdict`; `PlannerProgressInfo.provisional[]` → keyed record; `PlannerResult.options`
   → `rungs` + `ideal`.
3. State: `plannerStore.found` becomes `Partial<Record<PlanKind, FoundSlot>>` (results are not persisted, so no data
   migration); the persisted goal set and limits are unchanged; `ConstraintDraft` gains nothing in v2.0 except via E7.
4. Simulator scenarios already created keep their names ("Plan A · …" is user data); new ones: "Hard plan · …".
5. Files to update: `ResultsView.tsx`, `RunView.tsx`, `PlannerPage.tsx`, `components/{ResultTabs,PlanParts,DaysTab,
   PrintPrescription}.tsx`, `planFacts.ts`, `openInSimulator.ts`, `relations.ts` copy, `__tests__/{fixtures,labels,
   page,ranklist}`, `domain/__tests__/{golden*,progress,diversity*,planner.e2e}`, `src/workers/planner.pool.test.ts`.
6. Golden assertions: "≥ 2 distinct options" becomes "ladder distinctness passes or each collapse carries a reason";
   the R-TTT, R-PLAN-SAFETY, prescription-range, honest-text and label-consistency assertions apply to every rung;
   determinism tests cover rungs and Ideal.

### 9.7 Test plan

| Layer | Tests (new unless noted) |
|---|---|
| Difficulty | D(baseline) = 0; monotone per component; per-component golden values on 3 personas; φ_life ranges fixed per request |
| Keys | tie-break only inside the quantum (property: R never overturns a quantised goal difference); golden (d) picks the fast plan |
| Ladder | ordering and distinctness on golden a-e; collapse reasons; Easy ≥ g_min; knee fallback; rung TTT monotone and ≥ fastest-safe weeks |
| Ideal | `idealRequest` changes only practical/preference fields (table-driven from `LIMIT_CLASS`); safety and consent unchanged; Ideal ≥ Hard on G within noise; shadow prices zero for non-binding groups |
| Fasting | §3.8 list |
| Grammar | every structure of the v1 pattern list is still enumerated (superset); canonical ids stable; no truncation except tier S |
| Race / QD / robust | T-suite regressions; holdout numbers differ from selection numbers by the reported gap; OCBA allocation deterministic |
| Tier X | checkpoint round trip; resume bitwise equal; key mismatch discards |
| Determinism | 1/2/4/8 workers bitwise for S, M and X-short (30k EU) |
| Re-plan | past immutable; lock window; absolute targets preserved; churn limits; load-raising changes only as proposals; fasting spacing across the logged past; light re-plan touches 7 days only |
| Equipment | composer delivers within tolerance; refused and contraindicated exercises never appear; deterministic; shopping items' benefit sign; R3 worked examples (dand for DB bench → full credit; mudgar for a treadmill run with VO2max intent → different stimulus; baithak for back squat → partial); owner example (same-stimulus swap → day score 100) |
| Audit | §6.3 checks 1a, 1b, 2 (reduced), 3, 4, 6 in `pnpm test`; 1c, 2 (full), 5 in `pnpm audit:planner` |
| Benchmark | smoke subset in `pnpm test`; full gate before merging any algorithm change |
| Copy | item 5 forbidden-pattern scanner over rung titles, summaries, fasting verdicts, limit-cost texts, shopping texts, re-plan explanations |

### 9.8 Batch 02 status (I2, 2026-10-02)

Plan 02's "§9 Rung stability and the Easy search" is §12 of this file; its implementation status is **§12.7** (E21,
`docs/wp/E21.md`). This note records the batch-02 changes to the interfaces of this section.

| Topic | Status |
|---|---|
| Ladder (E21, §12) | Easy shown in 13 / 12 / 13 of the 17 test requests (quick / standard / exhaustive; before 5 / 10 / 11); Medium 3 / 6 / 4 (before 2 / 6 / 4); Hard 17 / 17 / 17; 0 of 204 audit cells fail the §12.6 rules (24 before). `PlannerRequestV2.previous` (genomes `{structureId, x}` of the shown Medium and Easy) is a new request field, ignored by the checkpoint key. Medium stays rare because of the §1.3 pairwise rule (open for A3, see §12.7) |
| Lab locks (E20, SUITE_SPEC §13.5.3) | Blood-marker `cap` rules are merged into `PlannerSafetyInput` locks; the strictest of lab and screening locks wins. Applied by the search: `deficit-cap`, `max-fast`, `protein-cap`, `carb-floor`, `creatine-cap` (0 = the planner adds no creatine; the person's own use is not refused) and `surplus-cap` (a % of maintenance); eGFR < 60 or ACR ≥ 30 sets the existing `kidney-disease` flag. Display-only (`LAB_LOCKS_DISPLAY_ONLY` in `domain/safety.ts`: `fat-cap`, `satfat-cap`, `alcohol-cap`, `added-sugar-cap`, `caffeine-cap`, `potassium-supp-cap`): a reason line on the plan and the Food-tab chips; the planner has no genes for them |
| Request fields (E20) | Optional `markerWarnings` (the `MarkerNote`s shown before the ladder and on the rungs they touch; the search does not read them) and `preferLevers: Array<{lever, weight ≤ 0.02, rule?}>` (the ranking bias of `prefer` rules, regulariser only). `preferLevers` is recorded on the request but **not read by the search yet**. `planner.find` returns `precondition_failed` with `markerReask` while a diabetes, kidney, gout or food-allergy re-ask is pending |
| Goal suggestion (E19, SUITE_SPEC §13.4) | When the goals came from an applied suggestion (`goals/me.suggested`), the ladder shows "Goals based on your answers." or "Goals based on your answers, suggested by the Coach." (`basedOnAnswersLine` in `src/features/planner/ladder.ts`, rendered in `ResultsView.tsx`) |

---

## 10. Provisional decisions and open questions

R6 landed and settles: the core (CMA-ES, ε-lexicographic), the structure race, the ladder construction, D's components
and equal weights, Ideal with safety and consent kept, shadow prices, tiers and budgets, separate holdout ensemble,
benchmark and audit design, and the MPC shape of the living plan. Still provisional:

1. **[BENCH] items of §4.12** (CMA-MAE, constraint handling, lq-CMA-ES, k-NN warm starts, prefix cache, K ≥ 4 cut-off,
   Shapley attribution): v2.0 ships the baseline variant of each until the harness gate passes.
2. **[PROPOSED] constants**: hunger component limit, decisions ceiling, D-bin and CVT cell counts, q_D, g_min table,
   ρ = 0.5/0.8 for goals 2..K, distinctness thresholds 0.15 / 0.20, λ_S and the re-plan churn limits, the purchase-list
   availability 0.5, the purchase D increment, the strict → CVaR mapping, P_max = 4 on L/X. Tuned on the harness
   training split.
3. **[OPEN] owner**: Easy's "acceptable result" share (50 % of Hard's goal-1 progress) and whether it is a user
   setting; tier X UX (desktop only, ≈ 25 min, background with a progress chip); an early pairwise calibration of
   difficulty weights with the owner; default `purchaseAllowance` (assumed none); the Ideal keeping safety and opt-ins
   (assumed yes, PLAN open question); sleep-timing advice (midpoint toward 02:30-04:30) as advice only.
4. **Engine dependencies**: W-05-KETO-FED scope confirmed by E2 against dossiers 05 and 17; the BHB over-read (QA
   engine item 2); hunger relief in multi-day fasts and the lean cost of 24-h fasts (PLAN-8.7); correlated parameters
   in the ensemble (dossier 18 §11.5); whether 12 ms per run reflects the release build (tier wall times scale with it).
5. **Scale**: once items 11-12 add exercise and food levers the grammar may exceed 2,000 structures; tier M then needs
   the k-NN prior to order the race (R6 q5).

---

## 11. Implementation status (E6, 2026-10-02)

Shipped: §1 ladder (difficulty D, D-first archive, rung selection with distinctness and collapse sentences, side-by-side
`RungSummary`; per-rung time to target with `rungReach`, §1.4), §2 Ideal and limit costs (never startable; "Adopt some of
these limits"; the Ideal never scores below Hard; its budget comes on top of the run), §3 on top of E2 (fasting gate
offers a fast wherever the evidence graph credits one; rival reason `difficulty`), §4 algorithm v2 in `optim/` (race,
quantised keys, holdout ensemble, tiers S/M/L/X, X checkpoints and convergence), §5 harness (`pnpm bench:planner`; it
also writes the Validation page's file), §6 audit (`pnpm audit:planner`, in the release chain; docs/PLANNER_COVERAGE.md),
§7 re-plan with the E5 wiring, §8 equipment composition, §9 `planLadder`/`resumeLadder`/`replan` with `planRegimes` as
the deprecated v1 wrapper.

**Algorithm decision (§5.4 gate, held-out split).** v2 alone was not non-inferior to v1 on full requests (R2); the app
therefore ships the **hybrid** of the 2026-10-01 ruling (`optim/hybrid.ts`): the frozen v1 search decides Hard, v2 builds
the ladder on top (≈ +37 % EU; tier M ≈ 31-34 s on 8 workers), the Ideal on top of that; v2 alone is selectable in dev
settings; tier X runs v2. Both results are published in docs/PLANNER_BENCHMARK.md. Deviations: limit costs use nominal
runs; checkpoints use the worker's own IndexedDB store; the selection ensemble keeps the v1 stream label; the hybrid is not
budget-neutral. Report and open items: docs/wp/E6.md.


---

## 12. Rung stability and the Easy search (batch 02)

**Status:** normative for v0.3.0 (package A3, 2026-10-02); owner **E21** (`src/engine/planner/**`,
`src/features/planner/**`, the audit and QA harness). Plan 02 calls this section "§9 Rung stability and the Easy search";
it is numbered 12 because §9 above is the interface section. Tier letters: the plan's **Q / M / X** are the code's
**S / M / X** (`TIER_WORD`: quick, standard, exhaustive); L stays as is.

**Found in the code (2026-10-02).** Easy is already its own constrained CMA-ES solve (`pLadder`, `optim/pipeline.ts:2251`,
budget `floor(ladderBudget/2)`, threshold `max(easyShare·g_H, g_min)`), but it runs inside the same stage as Medium,
warm-started from the run's staircase, and is then judged against the run's Hard by `ladderDistinctness`
(`optim/ladder.ts:214`). At tier X, a new Hard moves `g_H` and the distinctness reference, so rungs the tier-M run kept
are dropped (`notDistinct`: "It would repeat Hard with small changes"). The Ideal falls back to Hard's own plan with
`nothingBinds: true` (`ladderPlanner.ts:920-990`) but the UI still renders a second card. Ideal burden bars are drawn at
1/1.5 scale (`ladder.css:754-768`).

### 12.1 Carry-forward across tiers
- Every ladder run receives the previous ladder of the **same request hash** (`PlannerRequestV2.previous?: { tier;
  rungs: Partial<Record<RungId, RungPlan>> }`, sent by `planner.find` from the stored last result).
- After the run's own rung selection, for each `r ∈ {medium, easy}` missing in the new result but present in
  `previous`: re-evaluate the previous rung's genome under the **new** request (same evaluator, holdout ensemble), and
  keep it when it is safe, validated, satisfies the rung's goal-1 threshold against the **new** `g_H`
  (Easy ≥ max(0.5·g_H, g_min); Medium per §1.3) and passes distinctness against the new Hard. Kept rungs carry
  `provenance: 'carried'` and the card says "from the quick search".
- If the carried rung fails, the collapse reason is recorded with the failing check and numbers (e.g. "The quick
  search's Easy now reaches only 41 % of the new Hard's fat loss").
- **Invariant:** `count(cards after X) ≥ count(cards after M)` for the same request, unless a carried rung fails a
  safety or threshold check; that failure is a stated reason, never silent.
- **A stopped search (Q7).** A stopped run weighs the previous Hard too, and it outranks a hybrid's pinned Hard when its
  key is better (v1 was stopped as well). A stopped run with no carried Hard whose own Hard is below g_min returns no
  plan (`noSafePlan`, message "The search was stopped before it found a plan."). The screens keep the shown ladder
  (Hard, Medium, Easy and its Ideal) when the stopped result is worse (`stoppedResultWorse`, `domain/stoppedLadder.ts`:
  no Hard; a rung the shown ladder has is missing; Hard's goal-1 change more than 2 % below the shown Hard's, or a goal
  it reached now missed; or only the shown plans re-checked) and say "The long search was stopped; showing the plans
  from the quick search." (`keptAfterStop`, also in `planner.result`'s ladder).
```ts
interface RungPlan { /* + */ provenance: 'own' | 'carried' | 'easySearch'; fromTier?: 'S' | 'M' | 'L' | 'X' }
```

### 12.2 The dedicated Easy search (`optim/easySearch.ts`, stage `S5.easy`, after Hard is final)
- **Objective:** minimise `D(x)` (§1.1), then Gower distance to the baseline (habitual) plan, then goals 2..K
  ε-lexicographically (ladder tolerances δ_k). Minimum change, not maximum result.
- **Constraint:** safe, chance-feasible, validated, `d̃_1(x) ≥ max(0.5·g_H, g_min)` with `g_H` of the **final** Hard;
  goals 2..K ≥ min(0.5·d̃_j(H), d̃_j(H)) − δ_j; no goal worse than baseline unless Hard is.
- **Search space:** the same genome grammar, restricted to structures whose `D` lower bound (all genes at habit) is
  below `D_H − 0.15`; start points = baseline genome, the staircase elites of the three lowest occupied D bins, the
  carried Easy (if any), and the "baseline + Hard's goal-1 lever only" genome (one lever at a time: deficit depth,
  training, fasting tier, window).
- **Method:** a bisection on the goal-1 lever intensity from the baseline (≤ 8 steps per start), then CMA-ES (σ₀ 0.15)
  on `ladderKey` with D first.
- **Budget:** `easyEU = max(6 % of the tier total, 400 EU)` on top of the ladder share; tier X: 4 %.
- **Stopping rule:** budget spent, or 3 consecutive generations with ΔD < 0.005 and no new feasible point, or a point with
  `D ≤ D_E,lowerBound + 0.01`.
- **Proof of absence:** when no feasible point exists, the result records `easyProof = { starts: number; bestG1:
  number; needed: number; D: number }` and the collapse text "No plan with less effort than Hard reaches half of Hard's
  {goal}: the closest reached {bestG1 %} at effort {D}". The test reads `easyProof` (§12.6).

### 12.3 Ideal equals Hard
- Detection (`idealSameAsHard`): `nothingBinds === true`, or the Ideal's genome decodes to the same schedule as Hard,
  or Ideal − Hard on every goal is within the §4.3 quantum and |D_I − D_H| < 0.01.
- Payload on the result: `ideal.sameAsHard = { liftedWithoutEffect: Array<{ group: LimitGroupId; label: string; from:
  string; to: string }> }` (the `relaxed` list). The UI renders no Ideal card; Hard's card carries one line:
  "None of your limits is binding; the Ideal is this same plan." with the lifted list in a disclosure.

### 12.4 Convergence curve for the ladder graph
When fewer than two rungs are cards, the ladder graph plots the run's `convergence` instead of rung points:
```ts
interface LadderGraphData {
  axis: { x: 'effort'; xLabel: 'Effort (0 = how you live now, 100 = your limits)'; y: string /* goal-1 label + unit */ };
  frontier: Array<{ D: number; g: number }>;                // LadderInfo.frontier, D and goal-1 in metric units
  rungs: Array<{ kind: PlanKind; D: number; value: number; provenance: RungPlan['provenance'] }>;
  convergence: Array<{ eu: number; wallMs: number; G: number; hvLadder: number }>;   // from ConvergencePoint, X/L only
}
```

### 12.5 Same-scale effort bars
- Each burden row: `value ∈ [0, 1]` = (v − habit)/(limit − habit) on **every** card including the Ideal; fill = value ×
  track width; the tick is the limit at the track's right end on every card; no 1.5 squeeze.
- Over-limit: only on the Ideal and only when `over = (v − limit)/(limit − habit) > 0`: an extension segment past the tick,
  hatched, length `min(over, 0.5)` × track width, labelled "past your limit".
- Cards show a compact legend "now · your limit"; the footer explains the effort number (`BURDEN_FOOTNOTE`) and the
  caption says "The Ideal is not meant to be harder, only free of your practical limits."
- **Test oracle:** for equal `value`, every card's fill width is equal (DOM measurement within 1 px); `over` segment
  present iff Ideal ∧ over > 0.

### 12.6 Audit: four levels × three tiers × 17 requests
- The QA harness (`src/engine/planner/__tests__/qa/`, `QA_KEYS`: golden a–e, af, flf, fuzz0–9) runs every request at
  tiers **S, M and X** (X with a fixed EU of 60 000 in CI-free local runs, `X_AUDIT_EU`, so it finishes in minutes).
- For each (request, tier) and each level H, M, E, I: the level is a card, **or** a collapse with a reason the test
  verifies: `belowMinimal` → `g_H < g_min`; `tooClose`/`notDistinct` → the recorded check numbers fail the stated
  threshold; Easy `infeasible` → `easyProof.bestG1 < easyProof.needed`; Ideal absent → `sameAsHard` present and
  `idealSameAsHard` holds. A missing level without a verified reason fails.
- Monotone tiers: cards(X) ⊇ cards(M) ⊇ cards(S) modulo stated carried-rung failures (§12.1).
- On each card: effort bars, limits, "to make it work" rows and the Explain drawer render (journey test, Q3); the
  Ideal-equals-Hard line is asserted when it applies.
- Committed artefacts carry no timing fields (`wallMs`, `planMs`, `runtime`, machine data move to an uncommitted
  `qa/results/.timing/` file), so `pnpm release` leaves the tree clean.

**Tiers in the UI (Q3b, 2026-10-02; decision, closes Q3-J4-03).** The Plan screens offer two searches, as
design/screens/plan-ladder.md v2 §5 and §8 draw them: **Find plans** (the quick tier S, ≈ 10 s on desktop, the device
default) and, on desktop only, **Find the best possible plan** (tier X). The standard (M) and thorough (L) tiers are
engine tiers: the audit above runs M, and `planner.find { tier: 'M' }` from the Coach or an agent runs it, but no Plan
screen key starts it. `planner.find` records the tier that ran (S for Find plans; before, it recorded M while S ran).

**Acceptance tests (E21):** `easySearch.test.ts` (objective order, stopping rule, proof of absence on a constructed
request where half of g_H is unreachable); `carryForward.test.ts` (M result then X result with a moved Hard keeps both
rungs or states why); `idealSame.test.ts`; `burdenScale.test.tsx`; the 17 × 3 × 4 matrix in `checks.qa.ts`.

### 12.7 Implementation status (E21, 2026-10-02)

Shipped in `wp/E21` (hand-back docs/wp/E21.md):
- §12.1 `PlannerRequestV2.previous` carries the shown Medium and Easy as genomes only (`{ structureId, x }`), not whole
  `RungPlan`s, so the worker message stays small; `planner.find` gets it from `run.ts` (the shown result of the same request
  hash). The optimiser (`PlannerConfig.previous`) re-evaluates each carried genome (nominal run, then the selection ensemble
  Hard has; no polish, so it stays the plan the person saw), re-checks it against the final Hard and keeps the better of
  carried and own: Easy by the ladder key (least effort first), Medium by the knee distance. Not in the seed or the
  checkpoint key. `LadderResult.carried` says kept / `replaced` / the failing check; a failed carried rung's collapse has
  `detail.carried = 1` and its numbers, and the card text names the search it came from.
- §12.2 `optim/easySearch.ts` + `PlannerRun.easySearch` (stage `S5.easy`, after the final Hard): lines habit → Hard and
  habit → one of Hard's levers (`domain/easyStarts.ts`: deficit, training, fasting, window), bisection (≤ 8 steps), the best
  plan of the three lowest effort bins, the carried and own Easy; then CMA-ES (σ₀ 0.15) from the two best starts of
  distinct structures on the ladder key, with the stopping rule. Budget as specified, on top of the total and granted back
  as spent (plus an option's S5 share when it adds a rung); Hard is unchanged by construction (tested). The Gower distance to
  the habit is not a separate key entry: the habit-anchored starts stand in for it (decision). The proof's `bestG1` is taken
  over every nominal plan the search saw plus the archive, restricted to D ≤ D_H − 0.15 and the other goals' thresholds.
- Medium band search: edge 0.3 → 0.25 of the Easy-Hard span, 2 → 3 starts, at least the Easy search's budget (under the
  hybrid it had ≈ 70 EU at tier S), rounding margin qD/2 → qD, plan-distance margin 0.02 → 0.06, 3 → 6 candidates.
- Measured on the 17 requests (docs/PLANNER_COVERAGE.md §7): Easy 5/10/11 → 13/12/13 (S/M/X), Medium 2/6/4 → 3/6/4, Ideal
  duplicates of Hard removed, 0 of 204 cells unverified (24 before). Medium stays rare because of the §1.3 pairwise rule:
  Hard and Easy are usually < 0.30 apart in effort or < 0.40 apart in plan distance, leaving no plan ≥ 0.20 from both.
  Resolved by E21b: Medium's own margin, §12.8.
- §12.3 `idealSameAsHard` and `ideal.sameAsHard` (`liftedWithoutEffect` from `limitText`, one row per limit group). An Ideal
  search that returns no plan now falls back to Hard's own plan with `sameAsHard` (the Ideal's feasible set contains Hard's
  plan; before, the result had no Ideal at all for 5 of the 17 test requests).
- §12.6 `audit/levels.ts` (digest, `judgeLevels`, `monotoneViolations`), `audit/levelsRun.ts` (S → M → X chain per request,
  X at `X_AUDIT_EU` = 60 000), nine `part.levels.*` audit parts, `levelsReport.ts` (section 7 of docs/PLANNER_COVERAGE.md and
  `levels` in planner-coverage.json), `__tests__/qa/levels.qa.ts` and matrix `(h)` in `checks.qa.ts`. Committed artefacts
  carry no dates, run times or machine data; timings go to `qa/results/.timing/` (gitignored).

### 12.8 Medium's own distinctness margin (E21b, 2026-10-02; adopted)

**Rule.** Hard and Easy keep the §1.3 pairwise rule: D_H − D_E ≥ 0.15 and Gower(H, E) ≥ 0.20, ordered. A Medium between
a Hard-Easy pair that passes it must be, from **each** neighbour:

| Check | Threshold | Constant (`optim/ladder.ts`) |
|---|---|---|
| Effort gap | D_H − D_M ≥ 0.08 and D_M − D_E ≥ 0.08 | `MEDIUM_MARGIN.minDGap` (override `LadderSpec.mediumMinDGap`) |
| Plan distance | Gower(H, M) and Gower(M, E) ≥ max(0.10, Gower(H, E) / 3) | `MEDIUM_MARGIN.minGower`, `heShare` (override `LadderSpec.mediumMinGower`) |
| Order | d̃₁ and D ordered H ≥ M ≥ E | unchanged |

- Without Easy, a Medium keeps the pairwise rule (0.15 / 0.20). A plan distance below 0.05 between two cards is a
  duplicate (`MEDIUM_MARGIN.duplicate`); the audit fails such a card, and the thresholds above rule it out.
- Hard and Easy < 0.20 apart in plan distance (or < 0.15 in effort, or out of order): Easy collapses and Medium repeats
  Easy's reason with `detail.viaEasy = 1`; the chip says "Hard and the nearest easier plan are almost the same plan, so
  there is no room for a plan in between." (or the effort version). The audit labels it "Hard and Easy too alike, so none
  in between".
- `mediumMargins(gowerHE, spec)` computes the thresholds; `ladderDistinctness`, the S4 Medium room check
  (D_H − D_E ≥ max(0.15, 2 × 0.08)), the Medium band search (band [D_E + 0.08, D_H − 0.08] ∩ the middle half of the span;
  Gower target max(0.10, Gower(H, E)/3) + 0.06) and the level audit (`audit/levels.ts`) all read it. A collapse's
  `detail.minGower` / `minDGap` carry the threshold that applied, so the audit verifies it.

**Why.** The pairwise 0.20 forced Medium ≥ 0.20 from both neighbours, so a Hard-Easy pair < 0.40 apart in plan distance
(most of them) left no room. A Medium that sits between two distinct rungs is a real choice at a smaller margin.

**Measured** (17 QA requests, quick / standard / exhaustive; docs/PLANNER_COVERAGE.md §7; docs/wp/E21b.md):

| Level | Before (§1.3 pairwise) | After (§12.8) |
|---|---|---|
| Hard | 17 / 17 / 17 | 17 / 17 / 17 |
| Medium | 3 / 6 / 4 | **13 / 11 / 13** |
| Easy | 13 / 12 / 13 | 13 / 12 / 13 (same cells) |
| Cells failing the §12.6 rules | 0 of 204 | 0 of 204 |
| Smallest plan distance between two cards | 0.20 | 0.11 (none < 0.05) |
