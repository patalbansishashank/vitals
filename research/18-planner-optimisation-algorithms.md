# 18 — Planner Optimisation Algorithms (design study for Feature 2)

> **Dossier type.** Algorithms design study. The protocol's citation rules apply; its structure is
> adapted: §2-§4 describe the *planner's* state, inputs and algorithms instead of physiology.
> Labels: `PROPOSED` = engineering/design choice made in this dossier (not literature-derived);
> `UNVERIFIED` = numeric estimate not confirmed by a source or a measurement; `MEASURED` = benchmark
> run for this study (Node 26.10 / V8 and Bun / JavaScriptCore on an AMD Ryzen 9 5950X; set-ups are
> described inline so they can be re-run).
>
> **Evidence grades (adapted for algorithms).** A = standard method with theory and extensive
> published benchmarks; B = established method, but not validated in this domain; C = engineering
> proposal with partial precedent; D = speculative.
>
> **Cross-references.** Physiology comes from dossiers 01-16 and 19; hard safety bounds and safety
> tiers from 17; regime building blocks from 13; discrete interventions (multi-day fasts, etc.) from
> the forthcoming intervention catalogue 21; hunger/adherence signal from 12.

---

## 0. Executive summary — the recommended design in one table

| Decision | Recommendation | Main reason | § |
|---|---|---|---|
| Plan representation | **Skeleton + parameters**: a sequence of ≤ 4 *phases* (or a repeated *cycle* of 2-3 phases), each = building block id + duration (weeks) + ≤ 3 *day-types* + a 7-day *weekly pattern* + ≤ 2 *recurring overlays*; plus one-off *events* (multi-day fasts, deloads) placed on an hour-resolution timeline. All levers come from an extensible **lever registry**. | Compact (n ≈ 15-35 continuous genes per skeleton vs ≈ 3,600 for per-day vectors), human-shaped (weekly rhythm), evidence-traceable, extensible. | 4.2-4.4 |
| Goal normalisation | Derringer-Suich-type **desirability** d ∈ [0,1] anchored at *baseline plan* (0) and *best achievable* or *target* (1), with satiation at target. | Unit-free; "% of what was possible" is directly explainable. | 4.6 |
| Ordered goals | **ε-lexicographic (hierarchical) optimisation with degradation tolerances** in desirability space (goal 1 may lose at most δ₁ = 5 % of its achievable range to help goal 2, etc.), then rank-order-centroid (ROC) weighted utility only as tie-breaker. | Honours priority by construction; tolerance meaning is independent of Pareto-front shape (weights are not); same scheme as industrial solvers (Gurobi hierarchical objectives) and prioritised MPC. | 4.7 |
| Core optimiser | **CMA-ES** (full or separable; IPOP restarts; integer margin), ranking by **Deb feasibility rules**. | Among the best-benchmarked derivative-free optimisers for 10-100 continuous dims at 10³-10⁴ evaluations; rank-based (robust to scaling); parallel-friendly; ~300 lines TS. | 4.10 |
| Discrete structure | **Enumerate skeletons** from a block grammar, screen cheaply, refine the best continuously. Structural mutations inside the diversity stage. | Mixed discrete/continuous handled without a generic GA. | 4.11 |
| Alternatives (2-3 plans) | **CMA-ME / CVT-MAP-Elites archive** over user-meaningful behaviour descriptors (energy cycling, carb share, fasting load, exercise mode) + **MMR / farthest-point selection** with a Gower plan distance, subject to relaxed priority floors. | Diversity *among near-equally-good plans* in dimensions users care about. | 4.12 |
| Goal conflicts | Computed from the evaluation archive: pairwise **conflict cost κᵢⱼ** (what goal j retains when goal i is held near its best) + local Spearman sign; ε-constraint sweeps only for flagged pairs. | Automatic, no hard-coding; costs ≈ 0 extra simulations. | 4.13 |
| Feasibility | Anchor (single-goal) runs reveal unattainable targets; **time-to-target** optimisation on an extended horizon gives required duration; binding constraints are read from decoder repair logs. | Cheap; answers "not in 4 weeks — about N weeks at the safe maximum". | 4.14 |
| Robustness | Optimise nominal; **re-rank finalists on a fixed Latin-hypercube parameter ensemble (common random numbers, M = 16-32)**; chance-constrain safety on P90; optional SAA polish on desktop. Report P10-P90 fans. | ~1-3 % extra cost; mitigates optimizer's curse. | 4.15 |
| Building blocks | Library-constrained search inside the **evidence envelope** of dossier 13/21 blocks (default); exploration beyond envelope is opt-in and flagged. | Keeps plans inside the model's validated domain; optimisers exploit model error otherwise. | 4.16 |
| Budget | Evaluation budgets in *horizon-simulations* by device tier: S ≈ 3k, M ≈ 12k, L ≈ 40k. | Measured toy engine: 1.9 ms per 180-day run (V8, desktop); worker scaling ≈ linear to 8. | 4.1, 4.11 |
| Workers | Main thread spawns 1 coordinator + N evaluators (N = clamp(hardwareConcurrency − 1, 1, 8), mobile ≤ 3), connected by transferred **MessagePorts**; synchronous generations → results independent of worker count; seeded PRNG streams; no WASM, no SharedArrayBuffer. | Deterministic, responsive, dependency-free. | 4.19 |

---

## 1. Scope

This dossier specifies the algorithm behind **Feature 2 — the Planner**: given a person, an ordered
list of goals over the engine's ~40 outcome metrics, user constraints and a 1-6-month horizon, return
2-3 meaningfully different, safe, day-by-day regimes with projected curves, a hunger/adherence
assessment, and an honest explanation of trade-offs and unmet goals. It covers the problem
formulation, the plan representation (including multi-day water-only fasts and any future lever
type), goal aggregation maths, search algorithms and budgets, diversity, conflict and feasibility
analysis, robustness, explanation, re-planning, the Web Worker architecture and the test strategy.
It does **not** specify physiology (dossiers 01-16, 19), the safety limits themselves (17) or the
content of the building-block and intervention catalogues (13, 21) — only the interfaces to them.

---

## 2. Planner state (what the algorithm holds in memory during one run)

| Name | Type / size | Typical range | Represents | Initial value rule |
|---|---|---|---|---|
| `request` | object | — | person, goals (ordered), constraints, horizon, consent flags, strictness | from UI |
| `ctx` | compiled object | — | allowed levers/blocks after safety-tier gating, per-user valid weekly patterns, metric functionals | `compile(request)` (§4.4.6) |
| `baseline` | goal vector f(x_base) | per metric | outcome of the "status quo / maintenance" plan | 1 simulation |
| `anchors` aᵍ | Float64Array(K) | per metric | best value found for each goal *alone* | updated monotonically from every evaluation |
| `floors` Lₖ | Float64Array(K) | [0,1] | ε-lexicographic lower bounds on desirability | set after each lexicographic stage (§4.7) |
| `archive` | CVT cells × elite | 50-150 cells | best priority-feasible plan per behaviour niche | empty; every evaluation offered for insertion |
| `history` | Float32Array(EU × (K + 16)) | ≤ 40k rows (≈ 3.5 MB) | goal functionals, safety margins, descriptors, hunger, complexity of *every* evaluation | append-only; used for conflict matrix |
| `cma[]` | mean m, σ, C (n×n) or diag, paths | n ≤ 35 | state of each CMA-ES instance / emitter | from skeleton defaults or archive elites |
| `rng` | PRNG streams | 128-bit state | stage/emitter-specific random streams | derived from `hash(request)` (§4.19) |
| `ensemble` | Float64Array(M × P_unc) | M = 16-32 | Latin-hypercube draws of uncertain engine parameters (CRN) | drawn once per request seed |
| `budget` | {tier, EU_total, EU_used} | 3k-40k EU | evaluation budget in horizon-simulation units | from device calibration (§4.19) |

EU = *evaluation unit* = one simulation over the full planning horizon (plus tail, if any).

---

## 3. Inputs that drive the planner

| Input | Unit / type | How it enters |
|---|---|---|
| Person profile | engine `PersonProfile` | initial state s₀ for every simulation; also drives safety tiers (dossier 17) |
| Ordered goals g₁ … g_K (K ≤ 6) | metric id + sense (max/min/target/band) + optional target θ + optional deadline + functional | builds f_g and desirability d_g (§4.5-4.6); order → lexicographic stages (§4.7) |
| Priority strictness | {strict, balanced, flexible} | multiplies degradation tolerances δ_k (×0.5, ×1, ×2) |
| Horizon T | days (28-183) | simulation length; budget per EU ∝ T |
| Hard user constraints | available training weekdays and times, refused foods (→ macro/fibre bounds), earliest/latest eating times, max meals, fasting refusal, blackout dates, max session minutes | enforced by the decoder (guaranteed, §4.8) |
| Soft preferences | preferred meal count, preferred training time, weekend flexibility, hunger tolerance {low, medium, high} | regularisers (§4.9) |
| Consent flags | per opt-in lever family (e.g. 48-72 h water fast) | safety-tier gate (§4.4.6) |
| Safety bounds | input-space and state-space bounds + tier table (dossier 17) | decoder repair + constraint violations + independent validator |
| Block library / intervention catalogue | dossier 13 / 21 records (schema §4.16) | skeleton grammar, default parameters, evidence envelopes |
| Parameter uncertainty | per engine parameter: nominal, SD or CI, grade (all dossiers) | robustness ensemble (§4.15) |
| Device calibration | ms per simulated day (measured at start) | budget tier (§4.11, §4.19) |

---

## 4. Algorithms & equations

### 4.1 Evaluation cost model — how many simulations can we afford? (MEASURED)

**Question from the brief.** Is "180 days × 24 steps × ~50 state updates ≈ well under 1-5 ms per run,
so 10⁴-10⁵ evaluations in a few seconds" realistic?

**Benchmark 1 — single-thread engine stand-in.** A toy engine with 48 state variables, 50 state
updates per hourly step (each a Michaelis-Menten-type saturating flux; every 5th also calls
`Math.exp`), day-dependent inputs from a Float64Array schedule, fed/fasted switching, and output of
40 metrics as daily means (planner mode) or hourly values (simulator mode):

| Horizon | V8 (Node 26), daily outputs | V8, hourly outputs | JSC (Bun), daily outputs |
|---|---|---|---|
| 30 d | 0.32 ms/run (3,160 runs/s) | 0.35 ms | 0.20 ms |
| 90 d | 0.96 ms/run (1,040 runs/s) | 1.06 ms | 0.62 ms |
| 180 d | **1.90 ms/run (525 runs/s)** | 2.07 ms | 1.23 ms |

Cost is linear in horizon (≈ 8.8 ns per state update in V8). Recording hourly instead of daily
outputs costs ≈ +9 %.

**Benchmark 2 — worker pool.** Same engine in `worker_threads`, genomes sent as transferred
Float64Array batches, 8 summary numbers returned per candidate (8,192 evaluations, 180 d):

| Workers | 1 | 4 | 8 | 15 |
|---|---|---|---|---|
| Evaluations/s | 537 | 2,062 | 3,934 | 6,138 |

Scaling is ≈ linear up to physical cores; at 8 workers, batch size 1 vs 64 gave 3,816 vs 3,934
evals/s, i.e. **message overhead ≈ 3 % at 2 ms per evaluation** — batching matters only for
sub-millisecond evaluations. (Browser `postMessage` overhead is expected to be of the same order
but was not measured here — `UNVERIFIED` for browsers.)

**Extrapolation to the real engine (UNVERIFIED).** The real engine will have more branching
(thresholds, hysteresis), more transcendental calls and bookkeeping: assume 2-5× the toy →
**≈ 4-10 ms per 180-day run on a fast desktop core**. Mid-range phones run single-thread JavaScript
roughly 3-5× slower than a high-end desktop core (`UNVERIFIED` rule of thumb — must be measured by
the in-app calibration of §4.19) → ≈ 12-50 ms.

| Device class (180-day horizon) | Workers | ms / EU (est.) | EU/s | 10 s budget | 25 s budget |
|---|---|---|---|---|---|
| Desktop, 8+ cores | 7-8 | 4-10 | 700-2,000 | 7k-20k | 17k-50k |
| Laptop, 4-6 cores | 3-5 | 6-15 | 200-800 | 2k-8k | 5k-20k |
| Mid-range phone | 3 | 12-50 | 60-250 | 0.6k-2.5k | 1.5k-6k |

**Verdict.** The brief's estimate holds for desktops (10⁴ EU in 5-15 s; 10⁵ needs ~1-2 min). On
mobile the realistic budget is **10³-10⁴ EU**. The design therefore targets good answers at
**≈ 3,000 EU** (tier S) and uses extra budget for diversity and robustness (tiers M/L).

**Engine requirements that follow (PROPOSED):** (i) a *planner mode* that records only the metrics
needed by the goals/constraints/descriptors, as daily aggregates; (ii) **early abort** when a
state-space safety bound is violated (returns violation magnitude and day); (iii) no allocation in
the inner loop; (iv) performance budget ≤ 5 ms per 180-day run on the reference desktop and a CI
benchmark guarding it; (v) optional slow-state sub-cycling (update slow compartments daily) if the
budget is missed. Budgets are expressed in EU, so a 30-day horizon automatically gets ~6× more
evaluations than a 180-day one.

Evidence grade: **B** — measured on a stand-in, not on the real engine.

### 4.2 Decision variables (per day, before compression)

| Variable | Type | Search range (PROPOSED; hard limits from 17, envelopes from 13/21) | Friendly grid | Engine input / dossier |
|---|---|---|---|---|
| Energy intake | real, % of modelled maintenance | 0 (fast) or 45-125 % | 50 kcal (after resolution) | 02, 17 |
| Protein | real, g/kg reference mass | 1.2-2.6 | 5 g | 03 |
| Net carbohydrate | real, share of non-protein energy | 0.05-0.85 | 5 g | 04, 05 |
| Fat | derived = remaining energy | — | 5 g | 05, 06 |
| Fibre | real, g/d | 15-50 | 5 g | 15 |
| Food-quality flags | categorical (fat type, added sugar, processing) | per dossier | — | 06, 15 |
| Meals | int | 1-5 (usually 2-3) | 1 | 07 |
| Eating-window length | real, h | 4-14 (0 on zero-intake days) | 0.5 h | 07 |
| Eating-window start | real, clock h (circular) | user earliest-latest | 0.5 h | 07 |
| Extended / water-only fast | event (§4.4.5) | 24-168 h, tier-gated | 12 h | 07, 13, 17, 21 |
| Resistance training | per session: sets, intensity (RIR), clock time; sessions/week via weekly pattern | 0-6 sessions; 6-30 sets | 1 set, 0.5 h | 09 |
| Cardio | mode (cat), minutes, intensity, clock time (fed/fasted derived) | 0-90 min | 5 min | 10 |
| Steps | int/day | 3,000-15,000 | 500 | 10 |
| Sleep | real, h | user-bounded (often fixed) | 0.5 h | 16 |

A naive per-day encoding for 180 days is ≈ 180 × 20 = **3,600 variables** (mixed types).

### 4.3 Representation alternatives

| Encoding | Dimensions (180 d) | Pros | Cons | Verdict |
|---|---|---|---|---|
| Direct per-day vectors | ≈ 3,600 | Maximal flexibility | Intractable at 10³-10⁴ EU; yields jittery, unfollowable plans; no weekly rhythm; no evidence priors | Rejected |
| Control-vector parameterisation (CVP), piecewise-constant **per week** [54] | ≈ 26 × 20 = 520 | Standard in optimal control; captures slow trends | Still large; no within-week structure (training vs rest days, refeeds, 5:2); no multi-day events | Rejected as primary; used as a test oracle ("price of structure", §7) |
| CVP with variable switching times (**phases**) | P × (1 + 20) ≈ 84 | Few dims; periodisation explicit | No day-level variety | Adopted as the phase layer |
| Weekly template (day-types × 7-day pattern) per phase | + ≤ 3 day-types, 1 categorical pattern | Captures training/rest, carb cycling, 5:2, refeeds; matches how people live | Categorical pattern | Adopted |
| Grammar / genotype encodings (grammatical evolution [73]) | variable | Arbitrary structure | Poor locality (small genotype change → very different plan), hard to guarantee safety, hard to explain | Rejected |
| Library of evidence-based building blocks (13/21) | discrete choice + ≤ 6 params per block | Evidence-traceable, safe, explainable, strong priors, small search space | May miss novel regimes; curation effort | Adopted as the skeleton layer (§4.16) |

### 4.4 Recommended representation (PROPOSED)

Six layers, each compiling into the next:

```
Lever registry ──► Block library ──► Skeleton (discrete) ──► Genome x ∈ [0,1]ⁿ ──► Plan ──► Hourly input timeline ──► engine
 (what can vary)    (evidence units)   (enumerated)          (what CMA-ES sees)     (what user sees)   (what physiology sees)
```

#### 4.4.1 Lever registry — extensibility to arbitrary new lever types

Every controllable thing (a macro, a meal-timing rule, a 72-h fast, a creatine protocol, a sauna
session, a sleep-extension intervention from catalogue 21) is a **lever** with a self-describing
definition. The optimiser never sees lever semantics — only a flat vector — so adding a lever type
needs a registry entry, engine support for the physical inputs it writes, and tests; **no optimiser
change**.

```ts
type SafetyTier = 'default' | 'optIn' | 'never';        // tier values come from dossier 17
type ParamSpec =
  | { key: string; kind: 'real'; min: number; max: number; unit: string;
      scale?: 'linear' | 'log'; grid?: number;                          // friendly rounding step
      evidence?: { min: number; max: number; ref: string } }            // evidence envelope (13/21)
  | { key: string; kind: 'int'; min: number; max: number; unit: string; step?: number }
  | { key: string; kind: 'cat'; options: readonly string[] };

type LeverKind =
  | 'dayParam'       // modifies a field of a day-type (e.g. protein, window start)
  | 'dayOverlay'     // replaces/modifies whole days on a recurrence (refeed day, 24-h fast day)
  | 'event'          // one-off or recurring span on the hour timeline, may cross days/weeks (72-h fast)
  | 'phaseModifier'; // changes a whole phase (deload week, ramp)

interface LeverDef<P extends Record<string, number | string> = Record<string, number | string>> {
  id: string; version: number; kind: LeverKind; family: string;         // family e.g. 'zeroIntake'
  params: ParamSpec[];
  engineInputs: EngineChannel[];            // physical inputs written (grams, hours, minutes) – checked at registration
  tier(person: PersonProfile, p: P): SafetyTier;                  // person- AND parameter-dependent
  constraints: LeverConstraint[];
  expand(p: P, ctx: ExpandCtx): TimelinePatch;                    // mechanistic effect on the input timeline
  recovery?(p: P, ctx: ExpandCtx): LockedSpan[];                  // mandatory pre/post spans (refeed, taper)
  descriptors?(p: P): Partial<DescriptorVec>;                     // contribution to diversity descriptors (§4.12)
  complexityCost(p: P): number;                                   // adherence/complexity regulariser (§4.9)
  explain: { name: string; oneLiner: string; dossierRefs: string[] };
}

type LeverConstraint =
  | { type: 'minGapDays'; family: string; days: number }                         // spacing between instances
  | { type: 'maxPerWindow'; family: string; count: number; windowDays: number }
  | { type: 'maxHoursPerWindow'; family: string; hours: number; windowDays: number } // cumulative zero-intake hours
  | { type: 'requires' | 'excludes'; leverId: string; scope: 'day' | 'phase' | 'plan' }
  | { type: 'noTrainingWithin'; hoursBefore: number; hoursAfter: number }
  | { type: 'allowedInBlocks'; blockIds: string[] };
```

Principle 1 of the brief (mechanistic, not label-based) is preserved: a lever's `expand` writes
physical quantities into the timeline; "5:2", "PSMF" or "water fast" are only names of registry
entries and blocks.

#### 4.4.2 Plan structure

```ts
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;               // 0 = Monday
interface LeverInstance { leverId: string; params: Record<string, number | string> }

interface DayType {
  id: string;
  energy: { pctMaintenance: number; reference: 'phaseStart' | 'checkIn' }; // engine resolves to kcal (§5)
  proteinGPerKg: number;
  carbShareNonProtein: number;       // 0..1 of non-protein kcal from net carbohydrate; fat = remainder
  fibreG: number;
  quality: Record<string, number | boolean>;  // fat-type shares, added-sugar cap, ... (06, 15)
  meals: number;                     // 1..5
  window: { lengthH: number; startH: number }; // lengthH = 0 → zero-intake day
  rt?: { sets: number; rir: number; timeH: number };
  cardio?: { mode: 'walk' | 'run' | 'cycle' | 'hiit' | 'other'; minutes: number; intensity: number; timeH: number };
  steps: number;
  sleepH: number;
  levers: LeverInstance[];           // registry 'dayParam' levers (future: creatine, caffeine timing, ...)
}

interface RecurringOverlay {         // periodic element inside a phase: refeed day, 24/36-h fast, deload week
  leverId: string;
  params: Record<string, number | string>;
  rule: { everyWeeks: number; weekday: Weekday; startH?: number; offsetWeeks?: number };
}

interface EventInstance {            // span on the hour timeline; may cross day, week and phase boundaries
  leverId: string;                   // e.g. 'waterFast'
  params: Record<string, number | string>;   // e.g. { durationH: 72 }
  anchor: { phaseIdx: number; week: number; weekday: Weekday; startH: number };
  recurrence?: { everyDays: number; count: number };    // periodic multi-day fasts
}

interface Phase {
  blockId: string;                   // building block from library 13/21
  weeks: number;                     // integer, inside block duration range
  dayTypes: DayType[];               // 1..3 (e.g. training day / rest day / refeed day)
  weekPattern: [number, number, number, number, number, number, number]; // Mon..Sun → dayTypes index
  overlays: RecurringOverlay[];      // 0..2
  ramps?: { path: string; perWeek: number }[];          // linear progression (steps, RT sets, ...)
}

type Segment =
  | { kind: 'phase'; phase: Phase }
  | { kind: 'cycle'; phases: Phase[]; repeats: number; dropLastPhase?: boolean }; // e.g. MATADOR 2:2

interface Plan {
  schemaVersion: 1; engineVersion: string; libraryVersion: string; registryVersion: string;
  startDate: string;                 // ISO date — fixes weekday alignment
  horizonDays: number;
  segments: Segment[];               // ≤ 4 distinct phases (a cycle's phases count once)
  events: EventInstance[];
  provenance: { requestHash: string; seed: string; budgetEU: number; evalsUsed: number; stoppedAt?: string };
}
```

*Example encodings.* (a) MATADOR-style intermittent restriction — 8 × 2-week blocks at 67 % of
maintenance alternating with 2-week energy-balance blocks [62] — is **one** `cycle` segment with two
phases and `repeats = 8, dropLastPhase = true` (≈ 5-8 genes: energy level and protein of each phase, block length, weekly pattern parameters). (b) "High-carb low-fat week then a
protein-sparing very-low-energy week, repeated" is a 2-phase cycle. (c) "Steady deficit with
Saturday refeed, RT Mon/Wed/Fri" is one phase with 3 day-types and one pattern.

#### 4.4.3 Skeleton (discrete) and genome (continuous)

```ts
interface Skeleton {                 // enumerated from the block grammar (§4.11 S1)
  id: string;
  segments: Array<{ blockIds: string[]; cycle: boolean }>;
  overlays: Array<{ phaseSlot: number; leverId: string }>;
  events: Array<{ leverId: string; variant: string }>;  // e.g. waterFast@72h
  weekPatternIds: number[];          // indices into the per-user list of valid weekly patterns
}
interface GeneSpec { path: string; spec: ParamSpec; transform: 'unit' | 'log' | 'round' | 'softmaxGroup' }
interface GenomeLayout { skeletonId: string; genes: GeneSpec[] }  // x ∈ [0,1]ⁿ ↔ Plan via decode()

declare function decode(layout: GenomeLayout, x: Float64Array, ctx: CompiledCtx):
  { plan: Plan; timeline: InputTimeline; repairLog: RepairEntry[] };
```

* Only parameters a block marks as **free** become genes; everything else takes the block's
  evidence-based default. Each block exposes ≤ 6 free parameters; each phase has ≤ 3 day-types, of
  which usually ≤ 2 carry free parameters → a 2-3-phase skeleton has **n ≈ 15-35 genes**.
* Genes are normalised to [0,1] (log transform for scale-like parameters) so CMA-ES starts
  isotropic; integers (weeks, meals, sets) are decoded by rounding (see integer margin, §4.10);
  phase durations are decoded from continuous shares by the largest-remainder method so that
  Σ weeks × 7 = horizon (the last phase absorbs a partial week).
* **Weekly patterns** are not free categorical genes. At compile time the planner enumerates, for
  the user's allowed training weekdays and each sessions/week count, the few patterns that maximise
  rest spacing (e.g. 3 sessions on Mon/Wed/Fri out of Mon-Sat allowed); the skeleton picks a pattern
  id. 3⁷ = 2,187 raw day-type assignments (3 day-types) shrink to ≈ 1-3 patterns per sessions/week count.
* **Locality** requirement: a small change in x must produce a small change in the plan (needed for
  CMA-ES). Hence no genotype grammars, and discrete choices live in the skeleton.

#### 4.4.4 Decoder precedence and repair (hour-resolution timeline)

The decoder writes an hourly `InputTimeline` (intake by macro and hour, exercise bouts, sleep
episodes) in this fixed order — later layers override earlier ones, and every override is logged:

1. Phase templates → a day-spec per calendar date via `weekPattern` (anchored at `startDate`).
2. Ramps (per-week linear progression).
3. Recurring overlays (refeed day, 24/36-h fast day, deload week).
4. Events and their **locked recovery spans** (§4.4.5); displaced training is moved to the nearest
   allowed day respecting `noTrainingWithin`, otherwise dropped (logged).
5. User hard constraints (allowed training days/times, earliest/latest eating, blackout dates,
   refused foods → macro/fibre bounds).
6. Safety input-space bounds for the person (dossier 17) — clamp/repair.
7. Consistency: macros sum to the day's energy; meals fit the window at ≥ minimum spacing; window
   inside [earliest, latest].

The `repairLog` feeds (i) the box/repair penalty that keeps CMA-ES inside the feasible region
(§4.8), (ii) the complexity score (§4.9), and (iii) the "binding constraints" explanation
(§4.14, §4.17).

#### 4.4.5 Multi-day zero-intake blocks (24 h, 48 h, 72 h, ~7 d, periodic)

Water-only fasts are `event` levers of family `zeroIntake` (definitions and limits come from
dossiers 07/13/17 and catalogue 21; values below are placeholders showing the mechanics):

```ts
const waterFast: LeverDef<{ durationH: number }> = {
  id: 'waterFast', version: 1, kind: 'event', family: 'zeroIntake',
  params: [{ key: 'durationH', kind: 'int', min: 24, max: 168, step: 12, unit: 'h' }],
  engineInputs: ['intake.*', 'water', 'electrolytes'],
  tier: (person, p) => tierTable17('waterFast', person, p.durationH),  // e.g. 24-36 h default,
                                                                        // 48-72 h optIn, ~7 d optIn or never (17)
  constraints: [
    { type: 'minGapDays', family: 'zeroIntake', days: /* from 21, depends on durationH */ 7 },
    { type: 'maxHoursPerWindow', family: 'zeroIntake', hours: /* from 17 */ 96, windowDays: 28 },
    { type: 'noTrainingWithin', hoursBefore: 0, hoursAfter: 24 },
  ],
  expand: (p, ctx) => zeroIntakeSpan(ctx.startHour, p.durationH),       // intake = 0 for [start, start+duration)
  recovery: (p, ctx) => refeedSpans21(p.durationH, ctx),                  // mandatory graded refeed; for
       // "little or no intake > 5 days" the catalogue must encode refeeding precautions (NICE CG32 [63]; 17)
  descriptors: (p) => ({ fastingLoadH: p.durationH }),
  complexityCost: (p) => 1 + p.durationH / 72,
  explain: { name: 'Water-only fast', oneLiner: 'No energy intake; water and electrolytes only.', dossierRefs: ['07', '13', '17', '21'] },
};
```

Handling rules (PROPOSED):

* **Spanning days/weeks.** An event is anchored at (phase, week, weekday, clock hour) and occupies
  `[start, start + durationH)` on the hourly timeline. Fully covered dates become zero-intake days;
  a partially covered date keeps only the part of its template eating window outside the span
  (e.g. a 72-h fast starting Friday 20:00 truncates Friday's window to end at 20:00, zeroes Saturday
  and Sunday, and Monday until 20:00). Spans may cross phase boundaries; the underlying weekly
  template simply resumes after the recovery span.
* **Mandatory recovery.** `recovery()` returns *locked* spans (e.g. graded refeed days with energy
  and carbohydrate caps, no heavy training) whose parameters the optimiser cannot move outside the
  catalogue's ranges. Locked spans are part of the event for spacing, complexity and explanation.
* **Minimum spacing / cumulative load.** Checked in the decoder over the expanded timeline
  (including periodic recurrences and overlay fast-days of the same family). Violations are
  repaired by shifting the later instance forward to the next allowed weekday or, failing that,
  deleting it (logged) — the genome never needs to "know" the rule.
* **Periodic fasts** (e.g. 36 h every week, 72 h every 4 weeks) use `RecurringOverlay` (weekly
  rhythm) or `EventInstance.recurrence` (non-weekly period). Both expand to ordinary spans.
* **Position genes.** Event position is two genes: a continuous position within its phase (decoded
  to week and weekday, snapped to user-preferred start weekdays) and a start clock hour (grid 1 h).
  Duration is a variant chosen in the skeleton (tier-allowed durations only), not a continuous gene,
  because durations have qualitatively different physiology and safety status.

#### 4.4.6 Safety-tier gate (three layers; tiers from dossier 17)

1. **Compile-time filter.** For the person, evaluate `tier()` for every lever and every discrete
   variant: `never` → removed from the registry view and from all blocks/skeletons; `optIn` →
   removed unless the user has given the matching consent flag; `default` → available. Blocks whose
   mandatory levers are unavailable are removed from the grammar. This also shrinks the search space.
2. **Decoder clamp.** Continuous parameters are clamped to the tier-allowed sub-range (e.g. a
   duration or energy floor that depends on BMI/age/sex from 17).
3. **Independent post-validator.** Every returned plan is re-expanded by a *separate* code path
   (no shared decoder code) and checked against all input- and state-space bounds and tier rules;
   any failure → the plan is discarded, never repaired silently (§9).

The Simulator may still simulate `never`-tier regimes with warnings (brief principle 5); the Planner
never proposes them.

#### 4.4.7 Adding a new lever type (checklist)

1. Engine: add or reuse physical input channels; state effects with evidence per protocol.
2. Registry: `LeverDef` with params, evidence envelope, tier function (17), constraints, `expand`,
   optional `recovery`, descriptor contribution, complexity cost, explanation strings.
3. Library: add blocks or allow the lever inside existing blocks (`allowedInBlocks`).
4. Tests: decoder property tests (§7), validator coverage, one known-effect toy test.
No change to CMA-ES, the archive, the comparator, the conflict matrix or the worker protocol.

Evidence grade (§4.2-4.4): **C** — control parameterisation is standard optimal-control practice
[54], block libraries mirror how periodised programmes are published [62]; the specific layering is
an engineering proposal.

---

### 4.5 From goals to scalar objectives: metric functionals

Notation: x = genome; π(x) = decoded plan; y_m(t), t = 0 … T = daily aggregate of engine metric m
(t = 0 is the initial state); s_g = +1 for "maximise/increase", −1 for "minimise/decrease", so that
every goal objective f_g(x) = s_g · Φ_g(y_{m_g}) is **maximised**.

| Functional Φ | Definition | Default for |
|---|---|---|
| END_k | (1/k) Σ_{t=T−k+1}^{T} y(t), k = 7 | stocks at end: fat mass, lean mass, strength, VO₂max, lipids at end |
| DELTA | END_7 − y(0) | "lose 10 kg fat", "gain 2 kg lean mass" |
| MEAN_W | (1/\|W\|) Σ_{t∈W} y(t), W = whole horizon unless set | time-integrated: autophagy index, ketone level, insulin sensitivity over the period |
| TIR_[a,b] | (1/T) Σ_t σ((y(t)−a)/s) · σ((b−y(t))/s), σ = logistic, s = 2 % of range | "stay in ketosis", "keep glucose in range" (smooth time-in-range avoids plateaus) |
| SOFTMIN | −(1/β) ln Σ_t exp(−β y(t)), β chosen so it is within 1 % of min | "never lose more than X kg lean mass" |
| AUC_θ | (1/T) Σ_t max(0, y(t) − θ) | exposure above a threshold |
| TTT_θ | first t with y(t) ≥ θ (shaped, §4.14) | "as fast as possible", horizon search |

* **Endpoint vs time-integrated.** Stocks (masses, fitness, steady-state biomarkers) are judged at the
  end (END/DELTA); intensities and signals (autophagy index, ketosis, MPS) are judged over time
  (MEAN/TIR/AUC). PROPOSED: every metric in the dossiers' §6 tables gains a `defaultFunctional` and
  the UI lets the user switch ("fat mass *at the end*" vs "*average* autophagy index").
* **Deadlines.** A goal may carry t_g < T ("lose 5 kg by week 8, then hold") → END evaluated at t_g
  and, optionally, a HOLD constraint (SOFTMIN over [t_g, T]).
* **Hour-resolved goals** (hours per day in ketosis, fasted hours) require the engine to emit daily
  aggregates (hours above threshold), not hourly series, in planner mode.
* **Terminal-state gaming.** End-point objectives invite end-of-plan manipulation (e.g. cutting
  carbohydrate and sodium in the last days to dump glycogen-bound water so "weight at end" looks
  better). Rules (PROPOSED): (1) mass goals use fat mass, lean mass or glycogen/water-corrected trend
  weight — scale weight is displayed, never optimised; (2) END uses 7-day means; (3) a soft terminal
  penalty R_term = Σ_r w_r · max(0, z_r(T) − z_r^tol) on rebound-risk states (metabolic adaptation
  index from 02, hunger from 12, glycogen depletion from 04); (4) finalists get a standardised
  14-day maintenance *tail* simulation in the report ("what happens after the plan").

Evidence grade: **C** (standard objective functionals; choice of defaults is a proposal).

### 4.6 Normalising heterogeneous metrics: desirability

For each goal g: baseline b_g = f_g(x_base), where x_base is the user's current habits if entered,
else maintenance intake with current activity; anchor a_g = best f_g found for goal g alone over all
feasible evaluations (updated monotonically, seeded by the anchor stage §4.11); optional target θ_g
(sign-adjusted). Upper reference u_g = θ_g if a target is given, else a_g.

```
Search (raw) desirability:   d̃_g(x) = min( 1 , (f_g(x) − b_g) / (u_g − b_g) )        (no lower clip → no plateau below baseline)
Reported desirability:       d_g(x) = clip(d̃_g(x), 0, 1) ^ γ_g ,  γ_g = 1 by default
"% of what was possible":    P_g(x) = (f_g(x) − b_g) / (a_g − b_g)
"% of target":               Q_g(x) = (f_g(x) − b_g) / (θ_g − b_g)
Band goal [θ_lo, θ_hi] (e.g. "exactly 10 kg, not more", "LDL within range"):
  d̃_g = 1 inside the band; 1 − (θ_lo − f)/w_lo below; 1 − (f − θ_hi)/w_hi above  (two-sided Derringer form)
```

* d = 0 means "no better than doing nothing"; d = 1 means "target met" (satiation: extra
  improvement is worth nothing, so spare capacity flows to lower-priority goals) or "as good as
  anything we found". γ_g < 1 would add diminishing returns; the default stays linear because it keeps
  the "% of possible" message exact.
* If u_g ≤ b_g the goal is already satisfied by the baseline or cannot be improved within the
  horizon/constraints; it is removed from the stages and reported as such.
* **Floors are stored in physical units** (F_k = b_k + L_k (u_k − b_k)), so when an anchor improves
  later in the run and the desirability scale shifts, previously set priority floors do not move.
* This is the Derringer-Suich desirability construction [19] with the reference-point idea of
  achievement functions [20] (target = aspiration level); it removes units without arbitrary
  weights on kilograms vs index points.

Evidence grade: **A** for the construction (standard multi-response optimisation), **C** for the
baseline/anchor choice.

### 4.7 Honouring an ordered goal list

#### 4.7.1 Candidate methods

| Method | Formulation (maximisation) | Honours order? | Main problem |
|---|---|---|---|
| Pure lexicographic | max d̃₁; then max d̃₂ s.t. d̃₁ = d̃₁*; … | Strictly | Continuous optimum of goal 1 is (near-)unique → goals 2…K get nothing; brittle under stochastic search |
| **ε-lexicographic / preemptive goal programming with tolerances** [21, 23, 24] | stage k: max d̃_k s.t. d̃_j ≥ L_j (j < k), L_j = d̃_j* − δ_j | Yes, with explicit bounded sacrifice | K sequential stages (cost ×K) |
| Weighted sum, rank-derived weights [17, 18] | max Σ w_i d̃_i; ROC w_i = (1/K) Σ_{k=i}^{K} 1/k; rank-sum w_i = 2(K+1−i)/(K(K+1)); rank-reciprocal w_i = (1/i)/Σ_k(1/k) | Only approximately | Trade-off rate fixed by weights, independent of priority semantics; cannot reach non-convex parts of the front; outcome depends on front curvature |
| Achievement scalarising function (reference point) [20] | max min_i w_i (d̃_i − r_i) + ρ Σ_i w_i (d̃_i − r_i), ρ ≈ 10⁻³ | Via weights only | Needs meaningful aspiration levels r for directional goals |
| ε-constraint [22] | max d̃₁ s.t. d̃_j ≥ ε_j (j ≥ 2) | No (goal 1 favoured, others get fixed levels) | ε levels must be chosen a priori |

ROC weights for K = 3 are (0.611, 0.278, 0.111); rank-sum (0.500, 0.333, 0.167); rank-reciprocal
(0.545, 0.273, 0.182). Barron & Barrett found ROC the most accurate rank-based approximation for
*choosing* among alternatives [17] — which is why ROC is kept as the tie-breaker below, not as the
primary aggregation.

#### 4.7.2 Worked example — why tolerances beat weights for priorities

Two goals, Pareto front d₂ = 1 − d₁⁴ (goal 2 is cheap to improve while goal 1 is near its best).
ROC weights for K = 2 are (0.75, 0.25): maximising 0.75 d₁ + 0.25 (1 − d₁⁴) gives d₁ = 0.75^{1/3} =
**0.909**, d₂ = **0.318** — goal 1 silently loses 9 % of its achievable range. With front
d₂ = 1 − d₁ (linear) the same weights give the corner d₁ = 1, d₂ = 0; with a non-convex front such as
d₂ = (1 − d₁)², a weighted sum can only return corners. ε-lexicographic with δ₁ = 0.05 returns
d₁ = 0.95, d₂ = 1 − 0.95⁴ = 0.185 on the first front, and δ₁ = 0.10 returns d₁ = 0.90, d₂ = 0.344 —
the *meaning* of δ ("goal 1 gives up at most 5 % of what is achievable") is the same for every front
shape, and it is what the UI can promise.

#### 4.7.3 Recommended formulation (PROPOSED)

```
Given ordered goals 1…K, tolerances δ_k, feasible set X = { x : state-space safety OK, user OK }:

for k = 1 … K:
    x_k* ∈ argmax_{x ∈ X}  d̃_k(x) − η·R(x)          s.t.  d̃_j(x) ≥ L_j   for j = 1 … k−1
    if goal k has a target and d̃_k(x_k*) ≥ 1 and δ_target = 0:   L_k = 1            ("keep target met")
    else:                                                          L_k = d̃_k(x_k*) − δ_k

Priority-feasible set   F = { x ∈ X : d̃_j(x) ≥ L_j  ∀ j ≤ K }          (x_K* ∈ F by construction)
Final utility on F      U(x) = Σ_j w_j^ROC · min(1, d̃_j(x)) − λ_H·H(x) − λ_C·C(x) − λ_T·R_term(x)
Regulariser in stages   R(x) = λ_H·H(x) + λ_C·C(x) + λ_T·R_term(x),  η = 0.1 (tie-breaking only)
```

Default tolerances (PROPOSED, to be tuned in user testing): δ = 0.05 for goal 1, 0.10 for goal 2,
0.15 for goals ≥ 3; the strictness setting multiplies them by 0.5 / 1 / 2. Target goals default to
δ_target = 0 ("a target you set is kept once reachable"). Relaxed floors L_j − Δ_j with Δ_j = δ_j
admit alternative regimes (§4.12); every option reports what it gives up relative to option A.

**Comparator used to rank a CMA-ES population in stage k** (Deb's feasibility rules [16] with an
ordered violation measure; transitive, so it is a valid ranking):

```
key_k(x) = (  v_S(x),                                           // normalised state-space safety violation, 0 if feasible
              v_L(x) = Σ_{j<k} 2^{k−j} · max(0, L_j − d̃_j(x)),  // priority-weighted floor violation
              −( d̃_k(x) − η·R(x) − α·‖x − clamp(x)‖² )  )       // objective incl. boundary-repair penalty
compare keys lexicographically (smaller is better)
```

Before any floor exists (skeleton screening), a *provisional* comparator uses quantised desirability
q_j = ⌊d̃_j / 0.1⌋: key = (v_S, −q₁, −q₂, …, −q_K, −U). Pairwise tolerance comparisons ("tie if within
ε", as in ε-lexicase selection [74]) are **not** transitive and cannot rank a population —
quantisation is the transitive substitute.

The scheme is the evolutionary analogue of hierarchical multi-objective solvers (Gurobi's
priority-ordered passes with relative/absolute degradation tolerances `ObjNRelTol`/`ObjNAbsTol` [24])
and of prioritised MPC, where a sequence of constrained single-objective problems is solved in
priority order [23, 81].

Evidence grade: **A** for the method, **C** for default δ values.

### 4.8 Constraints inside the search

| Constraint class | Examples | Enforcement |
|---|---|---|
| Genome box | x ∈ [0,1]ⁿ | decoder clamps; penalty α‖x − clamp(x)‖² (α = 1) keeps the CMA-ES mean inside |
| Input-space safety (17) | energy floor, protein floor, max fast length per tier, max session volume | decoder repair — **never violated** in a decoded plan |
| User hard constraints | training days/times, eating times, refused foods, blackout dates | decoder repair — never violated |
| State-space safety (17) | max weekly loss rate, max lean-mass loss, BMI floor, electrolyte/ketone proxies | trajectory check → v_S; early abort; Deb rules |
| Adherence cap | rolling 7-day mean hunger ≤ h_max | state-space constraint (in v_S with lower weight) |
| Priority floors | d̃_j ≥ L_j | v_L in the comparator |
| Chance constraints | P90 of each state-space safety metric within bound | checked on finalists with the ensemble (§4.15); violation → tighten margin, re-polish |

If no candidate is safety-feasible, the planner returns **no plan** plus the minimal set of
constraints violated by the least-infeasible candidate ("your blackout dates and 3 training days
per week leave no safe way to reach …"). It never returns an unsafe plan.

### 4.9 Adherence and practicality regularisers

**Hunger/adherence penalty.** With the engine's normalised hunger index h(t) ∈ [0,1] (dossier 12)
and the user's tolerance h_tol (low / medium / high → 0.40 / 0.55 / 0.70, placeholders `UNVERIFIED`
until 12 fixes the scale):

```
H(x) = (1/T) Σ_t softplus_κ( h(t) − h_tol ) + ω · maxRun_days( h > h_tol ) / 7 ,   softplus_κ(z) = ln(1 + e^{κz}) / κ,  κ = 20, ω = 0.5
Hard cap: max over 7-day windows of mean h(t) ≤ h_tol + 0.15
```

**Complexity penalty** (PROPOSED form; coefficients `UNVERIFIED`, scaled so each unit costs about
1-2 % of goal-1 range):

```
C(x) = 0.015 · Σ_phases (n_daytypes − 1)            distinct day-types
     + 0.020 · (n_distinct_phases − 1)              phases
     + 0.010 · n_phase_transitions · 28 / T         change frequency
     + 0.010 · Σ_events complexityCost(event)       fasts, deloads, …
     + 0.020 · (1/T) Σ_t |Δ window start_t|_circ / 1 h   clock shifts of the eating window
     + 0.010 · (n_distinct_training_clock_times − 1)
     + 0.050 · (1 − P_week)                          P_week = share of days identical to the same weekday one week earlier
```

Practicality rules: block-defined minimum phase length (≥ 1 week, usually ≥ 2); training only on
user-allowed days; weekly rhythm enforced by construction (weekly patterns); **friendly rounding**
of every prescribed number to the grids of §4.2 followed by re-simulation ("round-and-verify"); if
rounding breaks a floor or bound, a Hooke-Jeeves pattern search [72] on the rounded grid (≤ 30 EU)
restores it.

**Why this matters.** In a 1-year trial of four popular diets, self-reported adherence predicted
weight loss (r = 0.60, P < .001) whereas diet type did not (r = 0.07), and only 50-65 % of
participants completed [61]. A model with *intermittent* lack of adherence reproduced the typical
6-month plateau that energy-expenditure adaptation alone could not [49]. The planner therefore
(i) penalises hunger and complexity, and (ii) reports a **"realistic adherence" projection**
alongside "as prescribed": daily intake multiplied by an intermittent non-adherence process of the
kind used in [49] and 1 in 4 training sessions missed (placeholder parameters, `UNVERIFIED`).

Evidence grade: **B** that adherence dominates outcomes [49, 61]; **C** for the penalty forms.

---

### 4.10 Search algorithms — evaluation and choice

Criteria: fits a 10³-10⁴ EU budget; handles mixed discrete/continuous variables; handles
constraints; deterministic/reproducible; can yield diverse alternatives; implementation effort in
dependency-free TypeScript.

| Algorithm | Budget fit | Mixed vars | Constraints | Diverse output | Effort (TS LOC) | Verdict |
|---|---|---|---|---|---|---|
| **CMA-ES** [1, 2] (full) | Good: ≈ 1-5k EU to reach 1 % of the initial gap at n = 20-40 (MEASURED below) | continuous; integers via margin [5]; discrete via skeletons | rank-based → Deb comparator [16] | via emitters (CMA-ME) | ≈ 300 incl. Jacobi eigensolver | **Core** |
| **sep-CMA-ES** [4] | Better than full when budget < ~10 n² or problem near-separable | same | same | same | +20 | **Tier S / low budget** |
| **IPOP restarts** [3] | Restart with doubled λ on stagnation → better global search | — | — | several local optima visited | +40 | **Yes** |
| Differential evolution [6] | Workable; standard binomial crossover is coordinate-dependent, whereas CMA-ES is invariant to rotations of the search space and to order-preserving transformations of the objective [1] — relevant because plan parameters are correlated (energy % × carb share × protein) | continuous | via comparator | weak | ≈ 60 | Fallback only |
| GA with structured genomes | Needs large populations; weak on continuous parameters | good | penalty | niching needed | ≈ 300 | Replaced by skeleton enumeration + structural mutation in QD |
| NSGA-II [7] / NSGA-III [8] / MOEA/D [9] | Fronts need populations ~100 × ≥ 100 generations ≈ 10⁴ EU (`UNVERIFIED` typical setting); for K ≥ 4 most points become non-dominated | via operators | constrained-domination | whole front | ≈ 400-600 | Rejected as primary (does not honour priority; users want 2-3 options, not a front). Archive-based pairwise fronts suffice for conflict analysis |
| **MAP-Elites [10] / CVT-MAP-Elites [11] / CMA-ME [12]** | QD illumination; CMA-ME more than doubled MAP-Elites' QD performance on its benchmarks [12] | yes (structural emitters) | archive acceptance rule | **designed for it** | ≈ 250 | **Diversity stage** |
| Simulated annealing [71] | Sequential single trajectory → poor use of workers; schedule tuning | yes | penalty | no | ≈ 80 | Rejected |
| Beam search / DP over weekly blocks (receding horizon) | DP over a ~40-dimensional continuous state is intractable; beam search with state snapshots is feasible but myopic for slow effects (adaptation, keto-adaptation) unless costly look-ahead rollouts; goals are non-additive (end-points, floors) | discrete only | pruning | beam = diverse-ish | ≈ 200 | Rejected as primary; reserved for re-planning v2 and single-goal time-to-target |
| Bayesian optimisation [75] | GP cost grows as O(N³) in evaluations; suited to ≲ 10³ expensive evaluations and ≲ 20 dims; here evaluations are cheap (ms), so model overhead dominates; mixed/discrete awkward | poor | extra models | no | ≈ 800 + linear algebra | Rejected |
| Pattern / coordinate search [72] | Good for low-dimensional polish on integer/friendly grids | grid | repair | no | ≈ 60 | **Round-and-verify polish** |
| Nelder-Mead | Degrades beyond ~10 dims | no | no | no | ≈ 80 | Rejected |
| Gradient-based (AD through engine, Pontryagin, collocation) | Engine has thresholds, hysteresis, saturation (non-smooth), no AD in the stack | no | yes | no | high | Rejected for v1 |
| Reinforcement learning [59] | Model is known and deterministic → this is *planning*, not learning; RL adds reward shaping and huge sample needs | yes | shaping | no | high | Rejected (future: learning a user's adherence behaviour) |
| Linear programming (diet problem) [56-58] | Solves *which foods* meet nutrient targets at minimum cost; not the dynamic regime problem | — | yes | — | small | Out of scope; candidate for a downstream "meal composer" that fills each day-type's macro targets with foods |
| **Hybrid: enumerate archetypes × continuous refinement** | Discrete structure small after grammar/tier pruning; continuous part suits CMA-ES | yes | yes | yes | — | **Backbone of the pipeline** |

**Measured CMA-ES evaluation counts** (implementation written for this study following the
tutorial's defaults [1]: λ = 4 + ⌊3 ln n⌋, μ = ⌊λ/2⌋, log-weights, rank-one + rank-μ updates, CSA;
sep variant with the learning-rate increase of [4]; x₀ = 0.5·1, σ₀ = 0.2 (Rosenbrock: x₀ = 0.1·1,
σ₀ = 0.1); median of 3 seeds; entries = evaluations until best f ≤ 10⁻² f(x₀) / ≤ 10⁻³ f(x₀)):

| Function (target shift inside [0,1]ⁿ) | n = 20 full | n = 20 sep | n = 40 full | n = 40 sep |
|---|---|---|---|---|
| Sphere | 552 / 852 | 528 / 720 | 1,020 / 1,560 | 960 / 1,410 |
| Axis-parallel ellipsoid, condition 10³ | 1,344 / 2,340 | 672 / 1,044 | 3,225 / 6,450 | 1,620 / 2,670 |
| Rotated ellipsoid, condition 10³ | 1,764 / 2,472 | 1,920 / 5,472 | 2,085 / 4,935 | 2,055 / 11,370 |
| Rosenbrock (x scaled ×4 − 1) | 1,932 / 14,952 | 1,452 / 25,680 | 5,085 / > 60,000 | 4,455 / > 60,000 |

Interpretation: reaching ~99 % of the achievable improvement (the precision our δ ≥ 5 % tolerances
need) costs ≈ 0.5-5k EU at n = 20-40; the last 0.1 % is expensive and unnecessary. Hence: keep
**n ≤ 35 per CMA-ES run**, warm-start from good skeleton defaults, budget ≈ 1-3k EU per stage on
desktop, and use sep-CMA-ES on tier S. The CMA-ES internal cost is negligible — the tutorial reports
≈ 3 (n + 5)² × 10⁻⁸ s per evaluation on a Pentium 4 when the eigendecomposition is recomputed only
every max(1, ⌊1/(10 n (c₁ + c_μ))⌋) generations [1], i.e. ≈ 0.05 ms at n = 35 versus ≥ 2 ms per simulation.

**CMA-ES configuration (PROPOSED):**
* Genes normalised to [0,1]; initial mean = block defaults or an archive elite; σ₀ = 0.25 for
  exploration from screening elites, 0.10 when warm-starting stage k from x_{k−1}*.
* λ = max(4 + ⌊3 ln n⌋, 2·N_workers), rounded up to a multiple of N_workers (increasing λ
  improves global search at the price of convergence speed [1]).
* Integer-coded genes: margin correction of CMA-ES with Margin [5], default α = (n·λ)⁻¹ as
  recommended in that paper, so integer genes never freeze on a plateau.
* Termination per stage: budget exhausted, or best-value range over the last 10 + ⌈30 n/λ⌉
  generations < 10⁻³ (desirability units) [1] → IPOP restart with 2λ if budget remains [3].
* Flat fitness (many candidates with d̃ = 1 after a target is met) is resolved by the η·R
  tie-breaker rather than by inflating σ — the tutorial notes that flat fitness should prompt a
  reconsideration of the objective formulation [1].

Evidence grade: **A** (CMA-ES and variants are extensively benchmarked, e.g. the COCO/BBOB
platform [68] and DFO reviews [67]).

### 4.11 The optimisation pipeline (stages, budgets, pseudo-code) — PROPOSED

| Stage | Purpose | Share of budget | Tier S ≈ 3k EU | Tier M ≈ 12k EU | Tier L ≈ 40k EU |
|---|---|---|---|---|---|
| S0 | Baseline plan + device calibration | — | 2 | 2 | 2 |
| S1 | Enumerate skeletons (grammar × tiers × user constraints); evaluate each at defaults + 4 LHS samples [36]; shortlist | 10 % | 300 | 1,200 | 4,000 |
| S2 | Anchors: short CMA-ES per goal (goal 1's anchor = S3 stage 1) → normalisation, payoff table, feasibility (§4.14) | 8-10 % | 150 × (K−1) | 500 × (K−1) | 1,500 × (K−1) |
| S3 | ε-lexicographic stages k = 1…K (warm-started, 1-2 skeletons each) | 30-35 % | 350 × K | 1,200 × K | 4,000 × K |
| S4 | Quality-diversity: CMA-ME improvement emitters + 1 structural emitter inside relaxed floors | 17-30 % | ≈ 500 | ≈ 3,000 | ≈ 12,000 |
| S5 | Select options, round-and-verify, ensemble evaluation (M = 16 / 32 / 32), chance-constraint repair, robust re-rank, optional SAA polish (L only) | ≈ 8 % | ≈ 250 | ≈ 900 | ≈ 3,000 |
| S6 | Explanations: ablations per option, Morris screening (M/L), tail simulation | ≈ 3 % | ≈ 60 | ≈ 400 | ≈ 1,200 |

Tier selection: EU/s from calibration × target wall time (desktop 10 s, mobile 20 s) → S/M/L.
Anytime behaviour: a provisional plan A is shown after S3 stage 1 (≈ 25-35 % of budget); A is final
after S3; B and C appear after S4; robustness bands after S5. Every evaluation from every stage is
offered to the archive and appended to `history` (so screening and anchor runs also feed diversity
and the conflict matrix). Duplicate genomes (hash of x quantised to 10⁻⁶) are served from a cache.

```ts
async function plan(req: PlanRequest, pool: EvalPool): Promise<PlanResult> {
  const ctx  = compile(req);                                 // tiers, registry view, patterns, functionals, grammar
  const rng  = prngStreams(hashRequest(req));                // deterministic, stage-specific streams
  const B    = budgetFor(req.horizonDays, await pool.calibrate());
  const arch = new Archive(ctx.activeDescriptors, cvtCentroids(ctx, rng.stream('cvt'), B.cells));

  // S0 — baseline (status quo) defines desirability zero
  ctx.setBaseline((await pool.evaluate([ctx.baselineGenome]))[0]);

  // S1 — skeleton screening with the provisional (quantised-lexicographic) comparator
  const skeletons = enumerateSkeletons(ctx);                 // typically 50-300 after pruning (UNVERIFIED)
  const probes = skeletons.flatMap(s => [defaultGenome(s), ...lhs(s, 4, rng.stream('lhs'))]);
  arch.offerAll(await pool.evaluate(probes.slice(0, B.s1)));
  const shortlist = arch.topSkeletons({ perGoal: 2, overall: 6, perNiche: 1 });

  // S2 — anchors for goals 2..K (goal 1 is done by S3 stage 1)
  for (const g of ctx.goals.slice(1))
    await cmaes({ objective: single(g), starts: shortlist.bestFor(g), budget: B.anchor, arch, rng: rng.stream(`a${g.id}`) });
  ctx.normalise(arch);                                       // b_g, a_g, u_g → d̃_g ; feasibility report (§4.14)

  // S3 — ε-lexicographic stages
  let incumbent = arch.bestProvisional();
  for (let k = 0; k < ctx.goals.length; k++) {
    const run = await cmaesMulti({ comparator: stageKey(k, ctx.floors), starts: [incumbent, ...shortlist.warmStarts(k)],
                                   budget: B.stage(k), arch, rng: rng.stream(`s${k}`) });
    incumbent = run.best;
    ctx.setFloor(k, incumbent);                              // L_k, stored in physical units
    emitProgress({ stage: `S3.${k + 1}`, provisional: summarise(incumbent) });
  }

  // S4 — quality-diversity inside relaxed floors
  await cmaMe({ arch, feasible: relaxedFloors(ctx), emitters: 3, structuralEmitters: 1, budget: B.qd, rng: rng.stream('qd') });

  // S5 — choose, simplify, verify, robustify
  let options = selectDiverse(arch, ctx, 3);                 // MMR / farthest-first with Gower distance (§4.12)
  options = await Promise.all(options.map(o => roundAndVerify(o, ctx, pool)));
  const ens = await pool.evaluateEnsemble(options, ctx.ensemble);          // common random numbers
  options = robustRerank(options, ens, ctx).filter(o => independentValidator(o.plan, ctx.person).ok);

  // S6 — explain
  const abl = await ablations(options, pool);                // remove/neutralise each lever instance
  return explain({ options, ens, abl, conflicts: conflictMatrix(arch.history, ctx), feasibility: ctx.feasibility });
}
```

**Skeleton grammar (PROPOSED).** `Plan := Segment{1..P_max}`, `Segment := Phase | Cycle(Phase, Phase
[, Phase]) × r`, P_max = 4 distinct phases. Pruning: transitions allowed by each block's `entryFrom` /
`exitTo` lists (dossier 13), block duration ranges, maximum consecutive weeks per block family,
tiers and consent, user constraints, and Σ durations = horizon. A 15-block library gives ≤ 15 + 15² +
15³ ≈ 3.6k raw sequences; pruning and symmetry removal are expected to leave 50-300 (`UNVERIFIED`);
tier S screens at most the first 60 by a prior score (e.g. evidence grade and match to goal types).

Evidence grade: **C** (standard building blocks — screening designs, CMA-ES, QD — composed in a new
pipeline).

### 4.12 Producing 2-3 *meaningfully different* alternatives

**Behaviour descriptors** (user-meaningful, computed from the decoded timeline, each in [0,1]):

| Descriptor | Definition | 0 means | 1 means |
|---|---|---|---|
| b₁ energy cycling | CV of daily energy intake / 0.6 (clipped) | steady intake | strongly cycled (fasts, refeeds, alternate days) |
| b₂ carbohydrate share | mean share of energy from net carbohydrate / 0.6 | very low carb | high carb |
| b₃ fasting load | mean over days of max(0, fasted hours in the day − 10) / 14; zero-intake day = 1 | conventional overnight fast only | full zero-intake days |
| b₄ exercise mode | cardio minutes / (cardio minutes + 3 min × RT sets) (`UNVERIFIED` conversion) | RT only | cardio only |

Descriptors that barely vary under the user's constraints (range < 0.1 across S1 samples, e.g.
fasting refused) are dropped. The archive is a **CVT-MAP-Elites** grid [11] with 64 / 100 / 150
centroids (tier S/M/L) over the active descriptors, centroids from seeded k-means on 10⁴ quasi-random
points (negligible cost). Insertion rule: a candidate replaces the cell elite if it is better under
the final comparator with relaxed floors, key = (v_S, v_L′, −U). S4 runs **CMA-ME** improvement
emitters [12] (offspring ranked by "new cell" first, then by improvement of the cell elite), restarted
from random elites when they stagnate, plus one **structural emitter** that mutates skeletons
(swap a block for a grammar-compatible one, add/remove an overlay, add/remove/move an event, change
the weekly pattern, split/merge a phase), with continuous parameters inherited by path name.

**Plan distance** — Gower's coefficient [29] over a feature vector φ(x):

```
numeric features k: b₁…b₄, mean energy %, mean protein g/kg, RT sessions/week, cardio min/week, mean steps,
                    mean window length, window start (circular: min(|a−b|, 24−|a−b|)/12), number of phases
boolean/categorical: has multi-day fast, has maintenance breaks, fasted-cardio share ≥ 0.5
set feature:        set of block families used (Jaccard distance)

D(x, y) = Σ_k w_k δ_k(x, y) / Σ_k w_k ,   δ_k = |φ_k(x) − φ_k(y)| / R_k (numeric, R_k = archive range),
                                           1[φ_k(x) ≠ φ_k(y)] (categorical), 1 − |A∩B|/|A∪B| (set)
weights (PROPOSED): 2 for b₁, b₂, b₃, multi-day fast, maintenance breaks, block families; 1 otherwise
```

**Selection** — maximal marginal relevance [30] / farthest-first traversal [31]:

```
Q  = { cell elites x : v_S(x) = 0, d̃_j(x) ≥ L_j − Δ_j ∀ j }                (Δ_j = δ_j; chance check follows in S5)
S  = { x_A = argmax_{x ∈ F} U(x) }                                            (option A = best under the priorities)
while |S| < 3:
    x* = argmax_{x ∈ Q \ S} [ (1 − λ)·Û(x) + λ·min_{s ∈ S} D(x, s) ] ,  Û = U rescaled to [0,1] over Q, λ = 0.5
    if min_{s ∈ S} D(x*, s) < D_min (= 0.20, PROPOSED): stop
    S = S ∪ {x*}
```

If fewer than 3 options survive, say so: "Only one distinct approach reaches your top priority;
alternatives cost more than X % of it." Each option reports its per-goal cost vs option A.

**Naming** (rule table on φ, PROPOSED examples): b₁ < 0.1 and b₃ < 0.2 → "Steady moderate deficit"
(or "aggressive" by energy %); a cycle segment containing maintenance phases → "Cycled: aggressive
blocks + maintenance breaks"; b₃ ≥ 0.4 with fasted cardio → "Time-restricted with fasted cardio";
multi-day fast events → "Periodic multi-day fasting (opt-in)"; b₂ ≥ 0.45 / ≤ 0.15 adds "high-carb" /
"low-carb". Names are made unique by appending the most distinguishing feature from D.

Evidence grade: **A** for QD/MMR as methods [10-13, 30, 31]; **C** for descriptor and weight choices.

---

### 4.13 Goal compatibility: an automatic conflict/synergy matrix

**Data.** `history` holds the goal functionals of *every* safety-feasible evaluation of the run
(thousands of rows, from screening, anchors, lexicographic stages and QD) — no extra simulations.

**Pairwise conflict cost** (PROPOSED; asymmetric):

```
A_i   = max_h d̃_i(h)                                             (best seen for goal i)
κ_ij  = 1 − max{ d̃_j(h) : d̃_i(h) ≥ A_i − ε } / A_j ,  ε = 0.05,  clipped to [0,1]
        "how much of goal j's potential is lost when goal i is held within 5 % of its best"
ρ_ij  = Spearman rank correlation of (d̃_i, d̃_j) over the top 25 % of feasible plans by U
class = synergy     if κ_ij < 0.10 and ρ_ij ≥ 0.30
        compatible  if κ_ij < 0.10
        trade-off   if 0.10 ≤ κ_ij < 0.50
        conflict    if κ_ij ≥ 0.50                                 (thresholds PROPOSED)
```

The classical **payoff table** (goal vector at each single-goal anchor [25]) is shown in the details
panel ("if you ranked goal 3 first it would reach 100 % and goal 1 would reach 55 %").

*Why not a global correlation over random plans?* Random and screening samples mix good and bad
plans, so metrics correlate simply because "good plans are good at many things". Conflict is a
property of the (near-)Pareto-optimal set — Purshouse & Fleming define conflict, harmony and
independence relationships there [26], and objective-reduction methods use the same idea [27].
κ therefore uses the *upper envelope* of the archive and ρ only the top plans.

**Verification sweep** (tiers M/L, only for pairs classed trade-off/conflict among the top-3
goals): ε-constraint [22] runs maximising d̃_j with d̃_i ≥ {1.0, 0.9, 0.8, 0.7} × A_i (warm-started
CMA-ES, ≤ 200 EU each) → trade-off curve for the UI and its knee point [28] as a suggested
compromise ("beyond ≈ 7 kg of fat loss each extra kg costs ≈ 10 index points of autophagy").

**Messages** (examples):
* "Goal 3 (maximise autophagy index) conflicts with goal 1 (lose 10 kg fat): keeping goal 1 within
  5 % of its best leaves at most 40 % of goal 3's potential. At your priority order you get 35 %."
* "Goals 1 and 2 work together here: plans that lose more fat also keep more lean mass."
* Priority cost PC_j = 1 − P_j(x_A), shown per goal with its conflicting higher-priority goal.

Evidence grade: **B** (conflict defined on the Pareto set is standard [26, 27]); **C** (κ, thresholds).

### 4.14 Feasibility and target setting

1. **Stand-alone attainability.** After S2 (and updated throughout the run), a target goal is
   unattainable within the horizon if a_g < θ_g. The report gives the **nearest attainable target**
   (a_g, rounded conservatively and later replaced by its ensemble P50) and "% of target".
2. **Why — binding constraints.** From the anchor plan's repair log and margins, a constraint is
   *binding* if it was clamped or within 2 % of its bound on ≥ 20 % of days (PROPOSED). Each maps to a
   plain-language reason ("limited by the maximum safe rate of weight loss (17)", "limited by 3
   available training days"). Counterfactuals relax only *user* constraints — never safety bounds —
   with a short anchor run (≤ 200 EU): "with 4 training days you would reach 7.5 kg".
3. **Required horizon — time-to-target run.** Single-goal CMA-ES on an extended horizon
   T_ext = min(max(2T, T + 56 d), 365 d):

   ```
   J(x) = − t_hit(x)                                      if the target is crossed (t_hit interpolated between days)
   J(x) = − T_ext − (θ_g − f_g(x; T_ext)) / r ,  r = (θ_g − b_g) / T_ext     otherwise (shaping)
   Required horizon T* = ⌈t_hit / 7⌉ weeks; report ensemble P50/P90 of t_hit for the found plan.
   ```

   Because the library contains maintenance blocks, feasible sets are nested in T (any plan for T
   can be extended by maintenance), so minimum time is well defined and bisection over T would also
   be valid; one direct time-to-target run is cheaper than log₂ bisection runs. Physiology makes this
   essential: the body-weight response to a sustained intake change has half-times of about one year
   in Hall's model [46], so fixed-intake plans approach targets asymptotically, and dossier 17's rate
   caps bound the speed further.
4. **Joint feasibility.** In S3, a target goal k with d̃_k(x_k*) < 1 although a_k ≥ θ_k is
   "attainable alone but not together with your higher-priority goals". On request, bisection over T
   (≤ 5 iterations, S2-S3 at tier-S budget each) finds a horizon for all targets.
5. **Already met.** If the baseline meets a target, the goal is marked "met without change".

*Prior art.* The NIH Body Weight Planner builds personalised calorie and activity plans that reach a
goal weight by a chosen date and then maintain it, using Hall's model [46, 47] — the single-goal,
single-intake special case of this search.

Evidence grade: **B** (min-time and ε-constraint formulations are standard); **C** (thresholds).

### 4.15 Robustness to model uncertainty and sensitivity reporting

Uncertainty sources: (a) parameter uncertainty (CI/SD per parameter in dossiers 01-19); (b)
inter-individual variability (e.g. spread of adaptive thermogenesis), represented the same way; (c)
adherence deviations (§4.9); (d) structural model error — not quantifiable, handled by evidence
grades and the evidence envelope (§4.16).

**Ensemble.** M draws by Latin hypercube sampling [36] in the quantile space of each uncertain
parameter (independent marginals — correlations are an open question), fixed per request seed and
reused for every candidate: **common random numbers**, which make comparisons between plans far less
noisy than independent draws [34].

**Policy (PROPOSED):**
1. S1-S4 optimise the nominal model (cost ×1).
2. S5 evaluates ≤ 10 finalists × M (16 on tier S, 32 on M/L) → per goal: mean, P10, P50, P90,
   P(target met). **Chance constraints**: each state-space safety metric must be within bound at P90
   (or P10 for lower bounds); a violating finalist gets its internal bound tightened by the observed
   P90 − P50 gap and is re-polished (≤ 2 iterations, ≤ 150 EU each). Cost on tier M ≈ 320 EU (2.7 %).
3. Robust re-ranking uses the ensemble-mean desirability (default) or CVaR₀.₂ — the mean of the
   worst 20 % of draws [35] — in a "cautious" mode.
4. Tier L only: sample-average-approximation polish [33] — CMA-ES on the mean over M = 8 CRN draws
   for each chosen option (≈ 8 × 300 EU). Other robust formulations (worst case, variance-penalised)
   are surveyed in [32].

**Optimizer's curse.** Choosing the best of many uncertain value estimates biases the chosen
estimate upward even when each estimate is unbiased [38]; model error plays that role here. So the
headline projection is the **ensemble P50 with a P10-P90 band**, never the nominal optimum curve.

**Sensitivity reporting:**
* Tier M/L: Morris elementary-effects screening [37] on each final plan — r = 4 trajectories ×
  (k + 1) runs, k ≈ 30 uncertain parameters → ≈ 124 EU per option; rank parameters by μ* for each
  goal ("your projected fat loss is most sensitive to the size of adaptive thermogenesis (grade B,
  dossier 02)").
* Tier S: one-at-a-time ±1 SD on the 10 parameters with the highest prior influence (20 EU/option).
* Decision sensitivity: share of ensemble members in which option A beats B on goal 1; if < 70 %,
  the options are reported as "practically tied on your top priority".
* Adherence sensitivity: the realistic-adherence scenario (§4.9) and "+10 % intake" scenario.

Evidence grade: **A** for the methods [32-38]; **C** for the defaults.

### 4.16 Warm-starting from evidence-based building blocks (discussion)

**Why library-constrained search is the default:**
1. *Traceability.* Each block cites the trials in which that regime was tested; the planner "tunes and
   sequences tested regimes". Example: MATADOR alternated 8 × 2-week blocks at 67 % of maintenance with
   2-week energy-balance blocks; per-protocol completers lost more fat (12.3 ± 4.8 vs 8.0 ± 4.2 kg)
   than with continuous restriction [62].
2. *Staying inside the model's validity domain.* Optimisers are drawn to wherever the model is most
   optimistic, which is often where it is least validated. Model-based RL explicitly limits reliance
   on learned models for this reason [39]; decision analysis calls the resulting upward bias the
   optimizer's curse [38]. A block's evidence envelope approximates the region where the engine's
   equations were fitted.
3. *Avoiding degenerate optima.* For the linear Banister fitness-fatigue model the analytically
   optimal plan is sustained maximal training followed by complete cessation — no periodisation,
   contradicting practice [40]; influence curves on the same model family were used to derive optimal
   training and taper strategies [41], and a nonlinear model with saturation/over-training optimised by a genetic algorithm produced
   realistic progression and taper [44]. Unconstrained optimisation of simplified physiology returns
   extreme, bang-bang regimes; blocks, regularisers and nonlinear physiology prevent that.
4. *Efficiency and explanation.* Block defaults are strong warm starts and carry rationale text.

**Costs:** may miss better novel combinations; curation effort; published protocols over-represent
some populations. **Mitigations:** free continuous parameters span each block's whole envelope;
sequencing is free within the grammar; an opt-in **exploratory mode** lets parameters leave the
envelope (never the safety bounds) and badges such plans "outside tested range" with a confidence
downgrade; the "price of structure" test (§7) quantifies what the library costs on toy engines.

**Block record — interface to dossiers 13 and 21 (PROPOSED):**

```ts
interface BuildingBlock {
  id: string; name: string; family: string;          // e.g. 'steadyDeficit', 'intermittentER', 'psmf', 'dietBreak', 'leanGain'
  durationWeeks: { min: number; max: number; default: number };
  dayTypes: Array<{ role: 'train' | 'rest' | 'refeed' | 'low' | 'zeroIntake';
                    fixed: Partial<DayType>;                               // evidence-fixed values
                    free: Array<{ path: string; spec: ParamSpec }> }>;    // tunable within the evidence envelope
  defaultPatternRule: 'maxRestSpacing' | 'weekendRefeed' | 'alternateDays' | string;
  overlays?: Array<{ leverId: string; free: ParamSpec[] }>;
  events?: Array<{ leverId: string; variants: string[] }>;               // e.g. waterFast@{24,36,72}
  entryFrom: string[]; exitTo: string[];                                // transition grammar
  maxConsecutiveWeeksFamily?: number;
  tier: (person: PersonProfile) => SafetyTier;                         // dossier 17
  evidence: Array<{ ref: string; population: string; design: string; outcome: string; grade: 'A' | 'B' | 'C' | 'D' }>;
  validates: string[];                                                  // engine validation targets reproduced
  explain: { rationale: string; tradeoffs: string };
}
```

Evidence grade: **B** that model exploitation and the optimizer's curse are real risks [38-40];
**C** for this library design.

### 4.17 Explanation generation (deterministic templates; no LLM, no backend)

Facts computed per option:
1. Goal table: value (units), P_g (% of possible), Q_g (% of target), met / not met, P(target met),
   P10-P90.
2. Priority cost vs the goal's stand-alone best and vs option A.
3. Binding constraints with activity share (§4.14).
4. **Lever contributions by ablation** (counterfactual explanations in the sense of [76]):
   neutralise each lever instance / phase feature (replace by the phase's base day-type, remove the
   event, flatten the cycle) and re-simulate → Δ per goal; keep the top 3 by |Δd| (≈ 5-15 EU/option).
5. Conflicts from §4.13 touching this option's unmet goals.
6. Differences vs the other options: top-3 Gower feature differences and goal deltas.
7. Burden: mean/peak hunger, days above tolerance, complexity score, distinct day-types, events.
8. Confidence: lowest evidence grade among the goal metrics and levers used; ensemble spread.

Template examples:
* "{option} reaches {goal₁} of {value} ({P}% of what is possible in {weeks} weeks). It is limited
  by {binding₁}."
* "The largest single contributor to {goal} is {lever}; without it: {Δ}."
* "Compared with {A}, {B} gives up {Δgoal₁} for {Δhunger}% lower average hunger and a simpler week."
* Hedging by evidence grade: A/B → plain statement; C → "the model suggests"; D → "speculative —
  based mainly on mechanistic or animal data".
* Numbers are rounded to meaningful precision (e.g. 0.5 kg) and always shown with bands.

### 4.18 Re-planning from logged data (MPC) — future-proofing

Loop at each check-in (weekly by default): estimate the current state → re-optimise the remaining
horizon from it → show the updated plan → the user follows the next week.

* **State estimation.** v1: replay the engine with the logged actual inputs from the start; fit a
  single intake-bias / expenditure-offset term so the replayed trajectory matches the logged trend
  weight (energy-balance back-calculation, as in Hall & Chow's free-living intake estimation [48]
  and consumer expenditure algorithms [64]). v2: extended Kalman filter or moving-horizon estimation
  of key states (fat, lean, glycogen/water) and person-specific parameters.
* **Re-optimisation.** Shrinking horizon (to the user's end date) or receding window; warm start from
  the shifted previous genome with small σ; plan-stability term λ_S · D(next 14 days new, next 14 days
  previous) to avoid churn; keep the chosen option's archetype unless the user asks or it became
  infeasible.
* **Precedent.** MPC is the standard receding-horizon framework [53]; it has been applied to glucose
  control with a compartment model and Bayesian parameter updates [52], and to dosing a
  gestational-weight-gain behavioural intervention via hybrid MPC on semi-physical models, now in an
  RCT [51]; control-engineering models of behavioural weight-loss interventions exist [50, 55].
  Publicly documented consumer apps are weekly single-target feedback controllers: MacroFactor
  solves energy expenditure from logged intake and the weight trend and updates targets weekly
  ("adherence neutral") [64]; Carbon's weekly check-in decreases, increases or holds calories
  according to progress [65]; RP Diet reviews progress weekly and updates the plan [66]. None
  documents forward multi-phase optimisation against ranked multi-metric goals.
* **Engine requirements.** Serialisable, versioned state snapshots; `simulate(snapshot, schedule)`;
  deterministic replay; plans store engine/library/registry versions.

Evidence grade: **A** for MPC as a method [53]; **C** for this application.

### 4.19 Web Worker architecture

```
 Main thread (React UI)                    Coordinator worker                      Evaluator workers × N
 ──────────────────────                    ──────────────────                      ─────────────────────
 creates coordinator + N evaluators  ───►  PRNG streams, CMA-ES, archive,   ◄───►  engine + decoder (pure),
 transfers N MessagePorts to it            comparators, budget, explanations       planner-mode simulate(),
 renders progress (≤ 4 Hz)           ◄───  Progress / Result / Error               early abort, calibration
 Cancel / Pause / Resume             ───►
```

* **Wiring.** The main thread creates the coordinator and the evaluators and transfers one
  MessageChannel port per evaluator to the coordinator, so the coordinator talks to evaluators
  directly without relying on nested workers (available only since Chrome 69, Firefox 34 and Safari
  16.4 [79]). Module workers (`new Worker(new URL('./evaluator.ts', import.meta.url), { type: 'module' })`,
  bundled by Vite) are supported from Chrome 80, Firefox 114 and Safari 15 [79].
* **Pool size.** N = clamp(navigator.hardwareConcurrency − 1, 1, 8); on phones N ≤ 3
  (heterogeneous cores, thermal limits). WebKit reports 4 when the device has fewer than 8 cores and 8
  otherwise, as an anti-fingerprinting clamp [80]; MDN notes browsers may report fewer cores than
  exist [79]. Adaptive rule (PROPOSED): if per-evaluation latency during the run exceeds 1.6× the
  calibration median, retire one evaluator.
* **Calibration.** On init each evaluator runs a fixed 30-day reference simulation 3×; the median
  ms per simulated day sets the EU rate and the budget tier *before* the run (recorded in provenance).
* **Messages** (typed; ArrayBuffers in the transfer list — zero-copy, sender's buffer detached [79]):
  * main → coordinator: `Start{request, tier?}`, `Cancel{runId}`, `Pause{runId}`, `Resume{runId}`
  * coordinator → main: `Progress{runId, stage, euUsed, euBudget, options: Summary[≤3]}` (goal curves
    decimated to weekly), `Result{…}`, `Error{code, detail}`
  * coordinator → evaluator: `Init{engineVersion, person, planningCtx, ensemble: Float64Array}`,
    `EvalBatch{batchId, skeletonIds: Int32Array, genomes: Float64Array(b × n), ensembleIdx: Int16Array (−1 = nominal), want: 'summary' | 'trajectory'}`
  * evaluator → coordinator: `EvalResult{batchId, summaries: Float64Array(b × R)}` with R ≈ K goal
    functionals + ~6 safety margins + 4 descriptors + hunger stats + complexity + abort day.
    Full trajectories only for finalists (40 metrics × 183 days × 8 B ≈ 59 kB each).
* **Batching.** λ/N candidates per evaluator per generation; overhead ≈ 3 % at 2 ms/EU (§4.1).
* **Determinism.** (1) All randomness lives in the coordinator: counter-derived streams per
  stage/emitter from hash(request) (SplitMix-style seeding of xoshiro128** [70] or sfc32).
  (2) Synchronous generations: results are processed and inserted into the archive **in candidate
  index order, never arrival order** → identical output for any N and any timing. (3) Budgets are in
  EU and fixed before the run. (4) Floating point is identical within one browser engine, but
  ECMAScript specifies `Math.exp`, `Math.log`, `Math.pow`, trigonometric functions etc. as
  "implementation-approximated", merely recommending fdlibm [78] → cross-browser bitwise equality is
  not guaranteed. PROPOSED: the engine ships its own `exp/log/pow` (fdlibm ports) so golden tests and
  cross-device replays are bitwise stable; the stored plan, not the seed, is the durable artefact.
* **Anytime / progress.** Progress after every stage and at most every 250 ms.
* **Cancellation.** Cooperative flag checked between generations (latency ≈ λ/N × ms/EU ≈ 10-100 ms);
  hard stop via `worker.terminate()` + respawn when inputs change (debounced 300 ms).
* **Mobile responsiveness.** Nothing heavy on the main thread; progress rendering throttled; pause
  issuing batches when `document.visibilityState === 'hidden'` and resume when visible; tier-S
  budgets keep runs ≲ 20-30 s to limit thermal throttling and battery drain.
* **Memory.** `history` ≤ 40k × ~26 × 4 B ≈ 4 MB (Float32Array); archive ≤ 150 elites.
* **Not used.** SharedArrayBuffer (needs cross-origin isolation via COOP/COEP headers [79]; unnecessary
  at ~3 % messaging overhead). WebAssembly: not warranted initially — the engine is scalar,
  JIT-friendly typed-array code; WASM adds a second toolchain and harder debugging, and is not
  automatically fast (compiled SPEC benchmarks ran 45-55 % slower than native on average [77]).
  Revisit only if profiling shows > 10 ms/EU on the reference phone after planner-mode optimisations;
  a later option is lock-step simulation of several candidates in structure-of-arrays form.

Evidence grade: **B** (browser facts verified in MDN/BCD, WebKit source and the ECMAScript spec;
throughput measured in Node, not in browsers).

### 4.20 Existing libraries vs implementing ourselves (registry metadata accessed 2026-09-30 [83])

| Need | Candidates found | Licence | Decision |
|---|---|---|---|
| CMA-ES | No established JS/TS package: `@oraclaw/cmaes` 1.0.0 (MIT; a single 2026 release from the OraClaw agent-tools project, unvetted). The reference-implementation page lists C, C++, Fortran, Java, Matlab/Octave, Python, R and Scilab — no JavaScript [84]; `pycma` (`cma` 4.5.0) is BSD-3-Clause | — | **Implement** (~300 LOC TS) from the tutorial [1] / pycma; the prototype for this study was ~120 LOC |
| Eigendecomposition | `ml-matrix` 6.15 (2 deps) | MIT | Own Jacobi solver (n ≤ 35, ~40 LOC) |
| MAP-Elites / CMA-ME | `pyribs` (`ribs` 0.12) [14] — Python reference only | MIT | **Implement** (~250 LOC) |
| NSGA-II | `win-nsga` (last release 2014); `pymoo` (Python) | MIT / Apache-2.0 | Not needed |
| Nelder-Mead / CG | `fmin` 0.0.4 | BSD-3-Clause | Not needed (pattern search ~60 LOC) |
| PRNG | `pure-rand` 8.4 (0 deps); `seedrandom` 3.0.5 (last release 2019) | MIT | Own 20-line xoshiro128**/sfc32 (or `pure-rand`) |
| Worker RPC | `comlink` 4.4.2 (0 deps) | Apache-2.0 | Optional; a hand-written typed protocol is small |
| Property-based testing | `fast-check` 4.10 + `@fast-check/vitest` | MIT | **Use** (dev dependency) |

Net result: **zero runtime dependencies** for the planner.

---

### 4.21 Prior art

| Domain | Work | What is optimised and how | Lesson for Vitals |
|---|---|---|---|
| Body-weight inverse problems | Hall et al. 2011 [46]; NIH Body Weight Planner [47] | Energy intake (and activity) to reach a goal weight by a date, plus maintenance intake, from a validated dynamic model | Single-goal special case of our search; slow dynamics (half-times ≈ 1 y) make horizon feasibility central |
| Control of body weight | Laila 2010 [55] | Feedback control of energy intake on a macronutrient flux-balance model | Control framing of intake is established |
| Behavioural interventions as dynamical systems | Navarro-Barrientos, Rivera & Collins 2011 [50]; Khan, Rivera et al. 2025 [51] | Energy balance + Theory-of-Planned-Behaviour model to design interventions; hybrid MPC choosing categorical intervention dosages from daily measurements (evaluated in an RCT) | MPC with categorical "dosages" ≈ our blocks + re-planning |
| Adherence modelling | Thomas et al. 2014 [49] | Intermittent non-adherence term in an energy-balance model reproduces early plateaus | Basis of the "realistic adherence" projection |
| Physiological MPC | Hovorka et al. 2004 [52] | Nonlinear MPC of glucose with a compartment model and Bayesian parameter updates | Template for state estimation + re-planning |
| Training periodisation | Calvert et al. 1976 [42]; Fitz-Clarke et al. 1991 [41]; Busso 2003 [43]; Turner et al. 2017 [44]; Kumyaito et al. 2018 [45]; Ceddia et al. 2025 [40]; Montmain et al. 2026 [82] | Fitness-fatigue impulse-response models; influence curves for tapers [41]; variable dose-response [43]; GA on a nonlinear model gives progression + high-intensity phase + taper [44]; adaptive PSO with ε-constraints on monotony, ramp rate and daily load beat a British Cycling plan *in-model* [45]; analytic optimum of the linear model is "max then stop" [40]; control-theory perspective notes the combinatorial limits of scenario simulation [82] | Closest methodological relatives. Practical constraints and nonlinearity are what make optimised plans realistic |
| Diet linear programming | Stigler 1945 [56]; Dantzig 1990 [57]; van Dooren 2018 (review of 52 LP papers) [58] | Food choice meeting nutrient, cost, acceptability and ecological constraints | Different (static, food-level) problem → future "meal composer" |
| ML / RL nutrition | Amiri et al. 2024 [59]; Zeevi et al. 2015 [60] | Deep-Q-learning meal recommendation with a composite reward (ratings, nutrition, preference) [59]; ML prediction of personal post-prandial glycaemic responses used to design diets that lowered responses in a blinded RCT [60] | Personalising the *response model* is complementary; not regime planning |
| Consumer apps | MacroFactor [64]; Carbon [65]; RP Diet [66] | Weekly feedback adjustment of calorie/macro targets toward one goal from logged intake and weight | Validates weekly check-in cadence for re-planning; none documents multi-goal forward optimisation |

**Gap.** No located published system performs priority-ordered, multi-goal, multi-phase forward
optimisation of combined diet, meal-timing and exercise regimes against a mechanistic multi-output
physiological model. The nearest analogues are training-load optimisation [40-45] and MPC-dosed
behavioural interventions [51].

---

## 5. Interactions with other subsystems (interface requirements)

**Needs from the engine (dossier 01 and module owners)** — PROPOSED signatures:

```ts
simulate(
  init: PersonProfile | StateSnapshot,
  timeline: InputTimeline,
  opts: {
    metrics: MetricId[];                  // planner mode: only these, as daily aggregates
    resolution: 'daily' | 'hourly';
    abortOn?: StateBound[];               // early abort → { day, bound, magnitude }
    paramOverrides?: Float64Array;        // ensemble member (same order as parameter registry)
  }
): { daily: Float32Array /* metrics × days */; aborted?: { day: number; bound: string; magnitude: number };
     realised: { kcal: Float32Array; proteinG: Float32Array; carbG: Float32Array; fatG: Float32Array } };
snapshot(): StateSnapshot;   restore(s: StateSnapshot): void;
```

* Energy as % of maintenance with explicit reference (`phaseStart`, or `checkIn` = re-anchored
  every 4 weeks); the prescription shown to users is the realised kcal (so it reads like a coach's
  weekly numbers). Protein per kg of a declared reference mass (phase-start body mass or FFM).
* Parameter registry: id, nominal, SD/CI, distribution, evidence grade, owning dossier.
* Metric registry: id, unit, direction-of-good, `defaultFunctional`, evidence grade, daily aggregation
  rule for hour-resolved quantities.
* Determinism (own `exp/log/pow`), no DOM, versioned; ≤ 5 ms per 180-day run (desktop reference).

**From dossier 17:** input-space bounds as functions of the person; state-space bounds; the tier
table per lever *and* per discrete variant (e.g. fast duration); contraindication rules; the
independent validator's specification. **From 13 / 21:** block and lever records (schemas §4.4.1,
§4.16), transition grammar, recovery rules for fasts, spacing and cumulative limits, evidence
envelopes, validation studies. **From 12:** hunger-index scale, tolerance mapping, adherence-process
parameters. **From 02 / 04:** metabolic-adaptation index and glycogen state for the terminal penalty.
**From all dossiers:** parameter uncertainty for the ensemble.

**Gives:** options (Plan + timeline + curves + bands), explanations, conflict matrix and feasibility
report to the UI; any option can be opened in the Simulator (same `Plan`/`InputTimeline` types) for
manual editing.

---

## 6. Output metrics for the UI (planner-level)

| Metric | Unit | Direction of good | How computed | Grade |
|---|---|---|---|---|
| Goal attainment P_g | % of what is possible | higher | (f − b)/(a − b), §4.6 | inherits the metric's grade |
| Target attainment Q_g; target met | %; yes/no | higher | §4.6 | inherits |
| P(target met) | % | higher | share of ensemble members meeting θ, §4.15 | inherits, widened by C/D parameters |
| Projection band | P10-P90 per goal curve | narrower | ensemble, §4.15 | — |
| Priority cost PC_g | % | lower | 1 − P_g(x_A) with the responsible higher goal | C |
| Conflict class / κ_ij | matrix | — | §4.13 | C |
| Required horizon T* | weeks (P50, P90) | — | time-to-target run, §4.14 | inherits |
| Binding constraints | list with activity % | — | repair log / margins, §4.14 | — |
| Hunger burden | mean h, peak 7-day mean, days above tolerance | lower | engine hunger index (12), §4.9 | from 12 |
| Complexity score | 0-100 (C scaled) + counts of day-types, events, phase changes | lower | §4.9 | C |
| Realistic-adherence delta | Δ per goal | smaller | adherence scenario, §4.9 | C |
| Decision stability | % of ensemble where option ranking holds | higher | §4.15 | C |
| Model confidence | A-D | higher | lowest grade among goal metrics and levers used | — |
| Provenance | seed, EU used/budget, versions | — | §4.19 | — |

---

## 7. Validation targets — how we know the planner works (test strategy)

All stochastic tests use fixed seeds and, where a property is statistical, a set of ≥ 10 seeds with
a pass threshold (e.g. ≥ 9/10) to avoid flakiness. Tolerance ε = 0.02 desirability units unless
stated.

**7.1 Decoder / representation (property-based with fast-check)**
1. `decode(x)` is total for every x ∈ [0,1]ⁿ (10⁴ random vectors + all 2ⁿ corners for n ≤ 12) and
   every decoded plan satisfies all input-space bounds and user hard constraints.
2. Energy consistency: Σ macro energy = resolved energy ± 1 kcal on every day.
3. Every event has its recovery span; spacing and cumulative zero-intake limits hold, including across
   phase boundaries, periodic recurrences and horizon end (an event whose core + recovery would
   exceed the horizon is moved earlier or dropped).
4. Idempotence: decode(encode(decode(x))) = decode(x).
5. A lever that is `never` for the person, or `optIn` without consent, never appears.

**7.2 Optimiser correctness (known optima)**
1. CMA-ES regression on COCO-style functions [68] (sphere, ellipsoid, rotated ellipsoid, Rosenbrock;
   n = 10/20/40): evaluation counts within ±50 % of the §4.10 table.
2. *Linear energy-balance toy* (fat loss = Σ (M − I_t)/ρ with an intake floor and a weekly-loss cap):
   the analytic optimum rides the tighter bound every day; the planner must reach ≥ 99 % of it on the
   tier-S budget.
3. *Two-goal analytic front* d₂ = 1 − d₁⁴: ε-lexicographic output satisfies d₁ ≥ 1 − δ₁ − ε and
   |d₂ − (1 − (1 − δ₁)⁴)| ≤ ε.
4. *Structure discovery*: a toy with a slowly building, break-reversible adaptation state (MATADOR-like
   mechanism) → planner picks a cycle skeleton; the same toy without the mechanism → steady skeleton.
5. *Banister toy*: without practicality constraints the planner reproduces the max-then-stop optimum
   [40]; with them it returns a progressive plan with a taper.
6. *Brute-force oracle*: a micro-library (3 blocks × 2 durations × 2 patterns × 2 continuous
   parameters on 21-point grids ≈ 5k plans) enumerated exhaustively; planner within 1 % of the
   exhaustive optimum under the same comparator.
7. *Price of structure*: on toys 2 and 4, compare with an unstructured weekly-CVP optimum (large
   budget); report the gap; alert if > 5 %.

**7.3 Metamorphic relations [69]**
1. Relaxing any user constraint never lowers the lexicographic attainment vector (beyond ε).
2. Extending the horizon never lowers target attainment (nested feasible sets).
3. Swapping goals i < j never lowers the promoted goal's attainment.
4. Appending a new lowest-priority goal does not lower higher goals beyond their δ.
5. Changing a metric's unit (kg ↔ g) leaves the plan bitwise identical (desirability is unit-free).
6. Shifting the start date by one weekday shifts weekly patterns consistently.
7. Worker count N ∈ {1, 2, 8} gives bitwise-identical plans (same browser engine).

**7.4 Safety**
1. Fuzzing: 10⁴ random persons × goal lists × constraints → 100 % of returned plans pass the
   independent validator; infeasible requests return "no safe plan" with reasons.
2. Finalists satisfy state-space bounds at ensemble P90.

**7.5 Performance and UX**
1. CI benchmark: engine ≤ 5 ms per 180-day EU (desktop reference); tier-M planner run ≤ 10 s on an
   8-core desktop in headless Chromium.
2. Provisional plan A within 30 % of the budget; tier-S run ≤ 25 s on a reference mid-range phone
   (device lab).
3. No main-thread task > 50 ms during a run (Long Tasks API).

**7.6 Diversity and explanation**
1. Returned options have pairwise D ≥ 0.20 and unique names.
2. On a toy with two conflicting and two independent goals, the conflict matrix classifies all pairs
   correctly.
3. Ablation claims re-verify: removing the listed top lever changes the stated goal by the stated Δ.

**7.7 Face validity** — canonical personas (e.g. 35-year-old man, 95 kg, 28 % body fat; goals 1. lose
8 kg fat, 2. keep lean mass; 16 weeks) reviewed by a domain expert against dossier expectations
(protein and training consistent with 03/09, deficit within 17's rate caps), then frozen as golden
files.

---

## 8. Myths / contested claims

1. *"Bigger weights for higher priorities honour the priorities."* No — weights fix a trade-off rate,
   not a priority, and cannot reach non-convex parts of a front (§4.7.2).
2. *"Just show the Pareto front."* With ≥ 3-4 goals most plans are non-dominated and fronts are
   unreadable; the brief asks for 2-3 regimes, which QD + MMR provide as distinct near-best options.
3. *"Bayesian optimisation is the tool for expensive black boxes."* Only when evaluations are truly
   scarce and dimensions low [75]; ours cost milliseconds.
4. *"Personalised plans need reinforcement learning."* With a known deterministic model this is
   planning; RL targets unknown dynamics [59].
5. *"More optimisation means better real-world results."* Optimizer's curse [38], model exploitation
   [39], degenerate optima of simplified models [40] — hence envelopes, ensembles and regularisers.
6. *"The optimal regime is the most extreme one the safety bounds allow."* That is what linear models
   imply [40]; nonlinear physiology (adaptation, hunger, lean loss) and adherence can make moderate or
   cycled regimes better — the planner should discover this (test 7.2.4), not assume it.
7. *"WebAssembly will make it fast."* Not automatically [77]; budget design matters more.
8. *"Seeded means reproducible everywhere."* Not across browser engines unless the math functions are
   owned [78].
9. *"Existing coaching apps already do this."* Publicly documented apps adjust calories weekly toward
   a single target [64-66].

---

## 9. Safety bounds (algorithmic enforcement)

1. Three layers (§4.4.6): compile-time tier gating → decoder repair of input-space bounds →
   independent validator on every returned plan. Penalties alone are never trusted.
2. State-space bounds enforced on the ensemble P90 for finalists (chance constraints).
3. A plan that fails validation is discarded, never silently patched; if none passes, the planner
   returns "no safe plan" with the violated constraints.
4. `optIn` levers require stored consent flags; `never` levers are unavailable to the Planner even on
   request (the Simulator may simulate them with warnings).
5. Counterfactuals and horizon searches relax only user constraints or the horizon — never safety
   bounds.
6. Multi-day fasts carry locked recovery spans and spacing/cumulative limits; refeeding precautions
   follow 17 (NICE CG32 treats little or no intake for > 5 days as a refeeding-risk criterion [63]).
7. Exploratory mode never crosses safety bounds; outside-envelope plans are badged.
8. Mass goals exclude scale weight; terminal penalty and post-plan tail report discourage end-of-plan
   dehydration or glycogen dumping.
9. Hunger caps from the user's tolerance (12) are hard constraints.
10. Plans record engine/library/registry/safety-table versions and are re-validated when loaded
    under newer versions.

---

## 10. Rejected alternatives (summary)

| Alternative | Why rejected |
|---|---|
| Per-day decision vectors (≈ 3,600 vars) | Intractable at 10³-10⁴ EU; unfollowable, arrhythmic plans |
| Weekly CVP without day-types/events | Too many dims (≈ 520), no training/rest structure, no multi-day events; kept only as a test oracle |
| Grammar/genotype encodings [73] | Poor locality, hard safety guarantees, hard to explain |
| Pure lexicographic | Lower goals get nothing |
| ROC / rank-sum weighted sum as primary [17, 18] | Does not honour priority; front-shape dependent; kept as tie-breaker |
| Achievement scalarising function as primary [20] | Needs aspiration levels for directional goals; priority only through weights |
| NSGA-II/III, MOEA/D [7-9] | Priority ignored, fronts unreadable for K ≥ 4, budget-hungry |
| Novelty search alone [15] | Diversity without quality; QD (CMA-ME) keeps both [12, 13] |
| Simulated annealing [71] | Sequential, poor parallel use, schedule tuning |
| DP / beam search as primary | State too large for DP; beam myopic for slow physiology; kept for re-planning v2 |
| Bayesian optimisation [75] | Model overhead ≫ ms-cheap simulations; mixed variables awkward |
| Gradient / AD-based optimal control | Non-smooth engine; no AD; black-box |
| Reinforcement learning [59] | Known deterministic model → planning; RL sample-hungry |
| LP diet models [56-58] | Static food-level problem; future meal composer |
| WASM, SharedArrayBuffer | Not needed at measured costs; toolchain and COOP/COEP burden |
| Robust optimisation of every candidate | ×M cost; finalist ensemble + optional SAA polish gives most of the benefit |

---

## 11. Open questions / weakest assumptions

1. **Real engine cost** (assumed 4-10 ms desktop, 12-50 ms mid-range phone per 180-day run —
   `UNVERIFIED`). Above ~50 ms on phones, tier S needs a multi-fidelity screen (coarser time step)
   or a shorter default horizon.
2. **Default tolerances and coefficients** (δ, complexity weights, hunger tolerances, D_min, κ
   thresholds) are design guesses; they need user testing and the hunger scale from 12.
3. **Many goals on tier S.** Whether ≈ 3k EU gives good plans for K = 5-6 is untested; may need to cap
   K at 4 on mobile or merge low-priority goals into the final utility only.
4. **Skeleton count** after pruning (50-300) depends on the size of catalogues 13/21.
5. **Ensemble realism.** Parameter correlations are ignored; parameter uncertainty and
   inter-individual variability are pooled; structural error is not captured.
6. **Baseline choice** (status quo vs maintenance) changes every "% of possible" statement; the UI
   must state which baseline is used.
7. **Integer genes** (margin correction) under satiated/plateau-y desirabilities are untested here.
8. **Descriptors** may not match what users perceive as "different"; validate with user studies.
9. **Cross-browser determinism** requires the engine to own its transcendental functions.
10. **Evidence envelope ≠ validity domain.** Each parameter can be inside its tested range while the
    combination is untested; no multivariate envelope is defined yet.
11. **Re-planning** depends on a water/glycogen model good enough to separate fat change from scale
    noise (04, 15).
12. **Browser throughput** (postMessage overhead, mobile core scheduling) was measured only in Node;
    confirm in real browsers.

---
## 12. References

*Optimisation methods*
1. Hansen N. The CMA Evolution Strategy: A Tutorial. arXiv:1604.00772 (v2, 2023). https://arxiv.org/abs/1604.00772
2. Hansen N, Ostermeier A. Completely derandomized self-adaptation in evolution strategies. *Evol Comput* 2001;9(2):159-195. doi:10.1162/106365601750190398
3. Auger A, Hansen N. A restart CMA evolution strategy with increasing population size. *2005 IEEE Congress on Evolutionary Computation*, vol. 2:1769-1776. doi:10.1109/CEC.2005.1554902
4. Ros R, Hansen N. A simple modification in CMA-ES achieving linear time and space complexity. *PPSN X*, LNCS 5199, 2008:296-305. doi:10.1007/978-3-540-87700-4_30
5. Hamano R, Saito S, Nomura M, Shirakawa S. CMA-ES with Margin: lower-bounding marginal probability for mixed-integer black-box optimization. *GECCO 2022*:639-647. doi:10.1145/3512290.3528827; arXiv:2205.13482 (default α = (Nλ)⁻¹)
6. Storn R, Price K. Differential evolution — a simple and efficient heuristic for global optimization over continuous spaces. *J Glob Optim* 1997;11(4):341-359. doi:10.1023/A:1008202821328
7. Deb K, Pratap A, Agarwal S, Meyarivan T. A fast and elitist multiobjective genetic algorithm: NSGA-II. *IEEE Trans Evol Comput* 2002;6(2):182-197. doi:10.1109/4235.996017
8. Deb K, Jain H. An evolutionary many-objective optimization algorithm using reference-point-based nondominated sorting approach, Part I. *IEEE Trans Evol Comput* 2014;18(4):577-601. doi:10.1109/TEVC.2013.2281535
9. Zhang Q, Li H. MOEA/D: a multiobjective evolutionary algorithm based on decomposition. *IEEE Trans Evol Comput* 2007;11(6):712-731. doi:10.1109/TEVC.2007.892759
10. Mouret J-B, Clune J. Illuminating search spaces by mapping elites. arXiv:1504.04909 (2015). https://arxiv.org/abs/1504.04909
11. Vassiliades V, Chatzilygeroudis K, Mouret J-B. Using centroidal Voronoi tessellations to scale up the multidimensional archive of phenotypic elites algorithm. *IEEE Trans Evol Comput* 2018;22(4):623-630. doi:10.1109/TEVC.2017.2735550
12. Fontaine MC, Togelius J, Nikolaidis S, Hoover AK. Covariance matrix adaptation for the rapid illumination of behavior space. *GECCO 2020*:94-102. doi:10.1145/3377930.3390232
13. Pugh JK, Soros LB, Stanley KO. Quality diversity: a new frontier for evolutionary computation. *Front Robot AI* 2016;3:40. doi:10.3389/frobt.2016.00040
14. Tjanaka B, Fontaine MC, Lee DH, et al. pyribs: a bare-bones Python library for quality diversity optimization. *GECCO 2023*:220-229. doi:10.1145/3583131.3590374 (package `ribs`, MIT licence)
15. Lehman J, Stanley KO. Abandoning objectives: evolution through the search for novelty alone. *Evol Comput* 2011;19(2):189-223. doi:10.1162/EVCO_a_00025
16. Deb K. An efficient constraint handling method for genetic algorithms. *Comput Methods Appl Mech Eng* 2000;186(2-4):311-338. doi:10.1016/S0045-7825(99)00389-8

*Multi-criteria decision making*
17. Barron FH, Barrett BE. Decision quality using ranked attribute weights. *Manage Sci* 1996;42(11):1515-1523. doi:10.1287/mnsc.42.11.1515
18. Stillwell WG, Seaver DA, Edwards W. A comparison of weight approximation techniques in multiattribute utility decision making. *Organ Behav Hum Perform* 1981;28(1):62-77. doi:10.1016/0030-5073(81)90015-5
19. Derringer G, Suich R. Simultaneous optimization of several response variables. *J Qual Technol* 1980;12(4):214-219. doi:10.1080/00224065.1980.11980968
20. Wierzbicki AP. A mathematical basis for satisficing decision making. *Math Model* 1982;3(5):391-405. doi:10.1016/0270-0255(82)90038-0
21. Tamiz M, Jones D, Romero C. Goal programming for decision making: an overview of the current state-of-the-art. *Eur J Oper Res* 1998;111(3):569-581. doi:10.1016/S0377-2217(97)00317-2
22. Haimes YY, Lasdon LS, Wismer DA. On a bicriterion formulation of the problems of integrated system identification and system optimization. *IEEE Trans Syst Man Cybern* 1971;SMC-1:296-297.
23. Kerrigan EC, Maciejowski JM. Designing model predictive controllers with prioritised constraints and objectives. *Proc IEEE Int Symp Computer Aided Control System Design* 2002:33-38. doi:10.1109/CACSD.2002.1036925
24. Gurobi Optimization. Multiple Objectives (hierarchical objectives, ObjNRelTol / ObjNAbsTol). Gurobi Optimizer Reference Manual. https://docs.gurobi.com/projects/optimizer/en/current/features/multiobjective.html (accessed 2026-09-30)
25. Miettinen K. *Nonlinear Multiobjective Optimization.* Boston: Kluwer Academic Publishers; 1999.
26. Purshouse RC, Fleming PJ. Conflict, harmony, and independence: relationships in evolutionary multi-criterion optimisation. *EMO 2003*, LNCS 2632:16-30. doi:10.1007/3-540-36970-8_2
27. Brockhoff D, Zitzler E. Objective reduction in evolutionary multiobjective optimization: theory and applications. *Evol Comput* 2009;17(2):135-166. doi:10.1162/evco.2009.17.2.135
28. Branke J, Deb K, Dierolf H, Osswald M. Finding knees in multi-objective optimization. *PPSN VIII*, LNCS 3242, 2004:722-731. doi:10.1007/978-3-540-30217-9_73
29. Gower JC. A general coefficient of similarity and some of its properties. *Biometrics* 1971;27(4):857-871. doi:10.2307/2528823
30. Carbonell J, Goldstein J. The use of MMR, diversity-based reranking for reordering documents and producing summaries. *SIGIR '98*:335-336. doi:10.1145/290941.291025
31. Gonzalez TF. Clustering to minimize the maximum intercluster distance. *Theor Comput Sci* 1985;38:293-306. doi:10.1016/0304-3975(85)90224-5

*Uncertainty, robustness, sensitivity*
32. Beyer H-G, Sendhoff B. Robust optimization — a comprehensive survey. *Comput Methods Appl Mech Eng* 2007;196(33-34):3190-3218. doi:10.1016/j.cma.2007.03.003
33. Kleywegt AJ, Shapiro A, Homem-de-Mello T. The sample average approximation method for stochastic discrete optimization. *SIAM J Optim* 2002;12(2):479-502. doi:10.1137/S1052623499363220
34. Glasserman P, Yao DD. Some guidelines and guarantees for common random numbers. *Manage Sci* 1992;38(6):884-908. doi:10.1287/mnsc.38.6.884
35. Rockafellar RT, Uryasev S. Optimization of conditional value-at-risk. *J Risk* 2000;2(3):21-41.
36. McKay MD, Beckman RJ, Conover WJ. A comparison of three methods for selecting values of input variables in the analysis of output from a computer code. *Technometrics* 1979;21(2):239-245. doi:10.2307/1268522
37. Morris MD. Factorial sampling plans for preliminary computational experiments. *Technometrics* 1991;33(2):161-174.
38. Smith JE, Winkler RL. The optimizer's curse: skepticism and postdecision surprise in decision analysis. *Manage Sci* 2006;52(3):311-322. doi:10.1287/mnsc.1050.0451
39. Janner M, Fu J, Zhang M, Levine S. When to trust your model: model-based policy optimization. *NeurIPS 2019*. arXiv:1906.08253

*Physiological models, training optimisation, control*
40. Ceddia D, Bondell H, Taylor P. Mathematical modelling and optimisation of athletic performance: tapering and periodisation. arXiv:2505.20859 (2025). https://arxiv.org/abs/2505.20859
41. Fitz-Clarke JR, Morton RH, Banister EW. Optimizing athletic performance by influence curves. *J Appl Physiol* 1991;71(3):1151-1158. PMID 1757312. doi:10.1152/jappl.1991.71.3.1151
42. Calvert TW, Banister EW, Savage MV, Bach T. A systems model of the effects of training on physical performance. *IEEE Trans Syst Man Cybern* 1976;SMC-6(2):94-102. doi:10.1109/TSMC.1976.5409179
43. Busso T. Variable dose-response relationship between exercise training and performance. *Med Sci Sports Exerc* 2003;35(7):1188-1195. PMID 12840641. doi:10.1249/01.MSS.0000074465.13621.37
44. Turner JD, Mazzoleni MJ, Little JA, Sequeira D, Mann BP. A nonlinear model for the characterization and optimization of athletic training and performance. *Biomed Hum Kinet* 2017;9:82-93. doi:10.1515/bhk-2017-0013
45. Kumyaito N, Yupapin P, Tamee K. Planning a sports training program using Adaptive Particle Swarm Optimization with emphasis on physiological constraints. *BMC Res Notes* 2018;11:9. PMID 29310699. doi:10.1186/s13104-017-3120-9
46. Hall KD, Sacks G, Chandramohan D, Chow CC, Wang YC, Gortmaker SL, Swinburn BA. Quantification of the effect of energy imbalance on bodyweight. *Lancet* 2011;378(9793):826-837. PMID 21872751. doi:10.1016/S0140-6736(11)60812-X
47. NIDDK. Body Weight Planner. https://niddk.nih.gov/research-funding/at-niddk/labs-branches/laboratory-biological-modeling/integrative-physiology-section/research/body-weight-planner (accessed 2026-09-30)
48. Hall KD, Chow CC. Estimating changes in free-living energy intake and its confidence interval. *Am J Clin Nutr* 2011;94(1):66-74. PMID 21562087.
49. Thomas DM, Martin CK, Redman LM, Heymsfield SB, Lettieri S, Levine JA, Bouchard C, Schoeller DA. Effect of dietary adherence on the body weight plateau: a mathematical model incorporating intermittent compliance with energy intake prescription. *Am J Clin Nutr* 2014;100(3):787-795. PMID 25080458. doi:10.3945/ajcn.113.079822
50. Navarro-Barrientos JE, Rivera DE, Collins LM. A dynamical model for describing behavioural interventions for weight loss and body composition change. *Math Comput Model Dyn Syst* 2011;17(2):183-203. PMID 21673826. doi:10.1080/13873954.2010.520409
51. Khan O, Campregher F, Rivera DE, Visioli A, Pauley AM, Symons Downs D. An optimized behavioral intervention for managing gestational weight gain using semi-physical modeling and hybrid model predictive control. *2025 American Control Conference*:3317-3322. doi:10.23919/ACC63710.2025.11107916
52. Hovorka R, Canonico V, Chassin LJ, et al. Nonlinear model predictive control of glucose concentration in subjects with type 1 diabetes. *Physiol Meas* 2004;25(4):905-920. PMID 15382830. doi:10.1088/0967-3334/25/4/010
53. Mayne DQ. Model predictive control: recent developments and future promise. *Automatica* 2014;50(12):2967-2986. doi:10.1016/j.automatica.2014.10.128
54. Goh CJ, Teo KL. Control parametrization: a unified approach to optimal control problems with general constraints. *Automatica* 1988;24(1):3-18. doi:10.1016/0005-1098(88)90003-9
55. Laila DS. A note on human body weight dynamics and control based on the macronutrient and energy flux balance. *2010 American Control Conference*:3580-3585. doi:10.1109/ACC.2010.5530809

*Diet optimisation, nutrition ML, adherence*
56. Stigler GJ. The cost of subsistence. *J Farm Econ* 1945;27(2):303-314. doi:10.2307/1231810
57. Dantzig GB. The diet problem. *Interfaces* 1990;20(4):43-47. doi:10.1287/inte.20.4.43
58. van Dooren C. A review of the use of linear programming to optimize diets, nutritiously, economically and environmentally. *Front Nutr* 2018;5:48. PMID 29977894. doi:10.3389/fnut.2018.00048
59. Amiri M, Sarani Rad F, Li J. Delighting palates with AI: reinforcement learning's triumph in crafting personalized meal plans with high user acceptance. *Nutrients* 2024;16(3):346. PMID 38337630. doi:10.3390/nu16030346
60. Zeevi D, Korem T, Zmora N, et al. Personalized nutrition by prediction of glycemic responses. *Cell* 2015;163(5):1079-1094. PMID 26590418. doi:10.1016/j.cell.2015.11.001
61. Dansinger ML, Gleason JA, Griffith JL, Selker HP, Schaefer EJ. Comparison of the Atkins, Ornish, Weight Watchers, and Zone diets for weight loss and heart disease risk reduction: a randomized trial. *JAMA* 2005;293(1):43-53. PMID 15632335. doi:10.1001/jama.293.1.43
62. Byrne NM, Sainsbury A, King NA, Hills AP, Wood RE. Intermittent energy restriction improves weight loss efficiency in obese men: the MATADOR study. *Int J Obes* 2018;42(2):129-138. PMID 28925405. doi:10.1038/ijo.2017.206
63. National Institute for Health and Care Excellence. Nutrition support for adults: oral nutrition support, enteral tube feeding and parenteral nutrition (CG32), 2006, updated 2017 — refeeding-risk criteria (little or no intake > 5 days). https://www.nice.org.uk/guidance/cg32 (criterion as reproduced in NHS refeeding guidelines, e.g. https://rightdecisions.scot.nhs.uk/media/2643/219-adults-at-risk-of-re-feeding.pdf)

*Consumer applications (publicly documented behaviour only)*
64. MacroFactor. "MacroFactor's Algorithms and Core Philosophy" https://macrofactor.com/macrofactors-algorithms-and-core-philosophy/ and "An In-Depth Look at MacroFactor's New V3 Expenditure Algorithm" https://macrofactor.com/expenditure-v3/ (accessed 2026-09-30)
65. Carbon Diet Coach. "What is Carbon and how does the coaching system work?" https://help.joincarbon.com/en/articles/5296570-what-is-carbon-and-how-does-the-coaching-system-work (accessed 2026-09-30)
66. Renaissance Periodization. RP Diet Coach app description. https://rpstrength.com/diet and App Store listing https://apps.apple.com/app/id1330041267 (accessed 2026-09-30)

*Benchmarking, testing, randomness, other algorithms*
67. Rios LM, Sahinidis NV. Derivative-free optimization: a review of algorithms and comparison of software implementations. *J Glob Optim* 2013;56(3):1247-1293. doi:10.1007/s10898-012-9951-y
68. Hansen N, Auger A, Ros R, Mersmann O, Tušar T, Brockhoff D. COCO: a platform for comparing continuous optimizers in a black-box setting. *Optim Methods Softw* 2021;36(1):114-144. doi:10.1080/10556788.2020.1808977
69. Chen TY, Kuo F-C, Liu H, Poon P-L, Towey D, Tse TH, Zhou ZQ. Metamorphic testing: a review of challenges and opportunities. *ACM Comput Surv* 2018;51(1):4. doi:10.1145/3143561
70. Blackman D, Vigna S. Scrambled linear pseudorandom number generators. *ACM Trans Math Softw* 2021;47(4):36. doi:10.1145/3460772
71. Kirkpatrick S, Gelatt CD, Vecchi MP. Optimization by simulated annealing. *Science* 1983;220(4598):671-680. doi:10.1126/science.220.4598.671
72. Hooke R, Jeeves TA. "Direct search" solution of numerical and statistical problems. *J ACM* 1961;8(2):212-229. doi:10.1145/321062.321069
73. O'Neill M, Ryan C. Grammatical evolution. *IEEE Trans Evol Comput* 2001;5(4):349-358. doi:10.1109/4235.942529
74. La Cava W, Spector L, Danai K. Epsilon-lexicase selection for regression. *GECCO 2016*:741-748. doi:10.1145/2908812.2908898
75. Snoek J, Larochelle H, Adams RP. Practical Bayesian optimization of machine learning algorithms. *NeurIPS 2012*. arXiv:1206.2944
76. Wachter S, Mittelstadt B, Russell C. Counterfactual explanations without opening the black box: automated decisions and the GDPR. SSRN 2017. doi:10.2139/ssrn.3063289

*Web platform*
77. Jangda A, Powers B, Berger ED, Guha A. Not so fast: analyzing the performance of WebAssembly vs. native code. *USENIX ATC 2019*. https://www.usenix.org/conference/atc19/presentation/jangda
78. Ecma International. ECMA-262 ECMAScript Language Specification, §21.3 The Math Object (Math.exp "implementation-approximated"; fdlibm recommended). https://tc39.es/ecma262/ (accessed 2026-09-30)
79. MDN Web Docs: Navigator.hardwareConcurrency; Transferable objects; SharedArrayBuffer (security requirements); and @mdn/browser-compat-data 8.1.3 (nested workers: Chrome 69, Firefox 34, Safari 16.4; module workers: Chrome 80, Firefox 114, Safari 15; hardwareConcurrency clamped to 4 or 8 in Safari 15.4+). https://developer.mozilla.org/ (accessed 2026-09-30)
80. WebKit. Source/WebCore/page/NavigatorBase.cpp — `hardwareConcurrency()` returns 4 if the device has < 8 cores, else 8. https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/NavigatorBase.cpp ; WebKit bug 233381 https://bugs.webkit.org/show_bug.cgi?id=233381 (accessed 2026-09-30)
81. Arnström D, Garofalo G. Prioritized constraints in optimization-based control. arXiv:2512.18458 (2025).
82. Montmain J, Couturier P, Dray G. New perspectives for the fitness fatigue model: how to revisit questions about the science of sports training from the perspective of systems control theory. arXiv:2609.26506 (2026).
83. npm registry and PyPI package metadata for `@oraclaw/cmaes`, `ml-matrix`, `fmin`, `pure-rand`, `seedrandom`, `comlink`, `fast-check`, `win-nsga`, `cma`, `pymoo`, `ribs` (accessed 2026-09-30). https://registry.npmjs.org/ , https://pypi.org/
84. Hansen N (maintainer). CMA-ES source code page (implementations by language). https://cma-es.github.io/cmaes_sourcecode_page.html (accessed 2026-09-30)
