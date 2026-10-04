# Planner optimisation core (`src/engine/planner/optim`)

Engine-agnostic implementation of the Planner search: dossier 18 ("§x.y" below) as amended by algorithm v2
(`docs/PLANNER_V2_SPEC.md` §1.2-1.3 and §4, "spec §x" below; R6 for the reasoning). Everything here is generic over an
abstract evaluation function. There is no physiology, no DOM, no clocks and no `Math.random`, and the code runs in Web
Workers and Node. It is proven on toy engines (`toys.ts`). The real plan decoder and simulator plug in through the
interfaces in `types.ts` and `pipeline.ts`.

## v2 (2026-10-01): API as implemented, and changes against the E6 contract

The E6 contract's "Optim v2 API" is implemented with these names (additive unless marked **changed**):

| Where | What |
|---|---|
| `types.ts` | `HOLDOUT_DRAW_OFFSET = 1 << 20`, `isHoldoutDraw(draw)`, `RungId`, `ConvergencePoint` (same shapes as the domain's) |
| `pipeline.ts` | `Tier = 'S' \| 'M' \| 'L' \| 'X'`; every `Record<Tier, …>` table has X: `TIER_BUDGET_EU` (X 300k), `TIER_ENSEMBLE` {16, 32, 64, 128}, `TIER_HOLDOUT` {32, 64, 64, 128}, `TIER_SHARES`, `TIER_RACE_ROUNDS`, `TIER_D_BINS`, `TIER_STYLE_CELLS`, `TIER_ARCHIVE_CELLS`, `TIER_COVARIANCE`, `TIER_RESTARTS`, `TIER_LAMBDA_QUANTUM`, `TIER_MAX_SCREENED`; `idealBudgetEU(tier, total)` |
| `pipeline.ts` **changed** | `planBudget(tier, K, total?, ladder?)` returns the v2 `StageBudget` {total, run, race, anchors, stages, qd, ladder, ideal, robust} (the v1 fields s0…s6 and `STAGE_TABLE` are gone; `bench/baselines/v1` keeps them) |
| `PlannerProblem` | `ladder?: LadderSpec` (contract shape; `gMinMetric` NaN → 10 % of goal 1's achievable range; extra `reserveIdeal?` (default true: the caller runs the Ideal on top of the total; reported in `StageBudget.ideal` only)); `structureTags?(s)` |
| `PlannerConfig` | `holdoutSize` (**default `TIER_HOLDOUT` on ladder problems only**; 0 without a ladder unless set, and always 0 when M_s = 0 — v1-mode callers may run evaluators without holdout draws), `now`, `onConvergence`, `checkpoint: { save, resume?, everyEU? }`, `race: { eta?, roundEU?, rounds?, continueTop? }` (rounds / continueTop are extra), `ocba?` (default true), `restarts?: 'ipop' \| 'bipop'` |
| `PlannerResult` | `ladder` (contract shape: `rungs`, `collapsed` {rung, reason, detail}, `checks`, `staircase`), `convergence`, `holdoutGap` (**[] without a holdout**), `quanta {q, qG}`, `race {rounds}`; `provenance.resumedFrom` (checkpoint label, 'refused' or null); `provenance.budgetEU` = what the run may spend (the whole tier total; the Ideal runs on top) |
| `PlanOptionResult` | `rung?`, `D?`, `robustSelection`; `robust` is the HOLDOUT summary (the selection one when M_h = 0); `aBeatsThisShare` is read on the holdout draws. `label` stays the position letter (A, B, C) also for rungs — use `rung` |
| `PlannerProgress` | `rungs?: Partial<Record<RungId, OptionSummary & { D }>>`, `convergence?` |
| `checkpoint.ts` (new) | `PlannerCheckpointData` {version, fingerprint, label, phase, euUsed, state}, `encodeCheckpoint` / `decodeCheckpoint` (JSON that keeps NaN/±∞) |
| `goals.ts` | `GoalSystem.keyQuantum(k)`, `keyQuanta()`, `goalQuantum()`, `level(k, d)`, `hardKey(s, D, qD?, relaxed?)`, `ladderKey(s, thr, D, qD?)`, `effectiveTolerance(k, d)`, `getState()/setState()`; `quantLevel`, `ladderViolation`, `MIN_QUANTUM`, `DEFAULT_Q_D`. **Changed**: `stageKey` and `finalKey` are the quantised v2 keys |
| `ladder.ts` (new) | `LadderSpec`, `LADDER_DEFAULTS`, `staircase`, `ladderHypervolume`, `kneeOf`, `gMinDesirability`, `rungThresholds`, `ladderDistinctness` |
| `race.ts` (new) | `RACE_ETA`, `raceRoundBudget`, `raceSurvivors` (diversity guard), `dTercile` |
| `archive.ts` | `DFirstGrid` (D bins × a CVT over the style descriptors), `Archive.snapshot/restore` |
| `cmaes.ts` / `rng.ts` | `BipopCmaEs`, `CmaEs/IpopCmaEs/BipopCmaEs.getState/fromState`, `Rng.getState/fromState` (`RngState` = {key, s[4], spare, hasSpare}: the Box-Muller spare is part of a stream's state, so the spec's 4-word tuple is extended) |

**What the domain (lead) must pass / provide** for v2 behaviour: `problem.ladder` on the main run (absent → v1 MMR A/B/C,
which time-to-target, replan and the Ideal run keep); `EvalOutput.descriptors[0] = D` on ladder problems; an evaluator
that serves holdout draws `HOLDOUT_DRAW_OFFSET + m` (m < M_h, stream `ensemble/holdout`) besides the selection draws
0..M_s−1 (OCBA stays inside 0..M_s−1); the evaluator's holdout size must equal `holdoutSize`. The run spends
the whole total; on ladder problems the caller spends `idealBudgetEU(tier, total)` on the Ideal **on top** (benchmark
ruling 2026-10-01: carving the Ideal out of the run cost goal-1 quality on the full requests). No stage spends beyond the run budget (tested down to 60 EU); the holdout shrinks to what
the remaining budget pays for (≥ min(M_h, 4) draws, else the selection summary is reported). Progress stage names
stay S0…S6 (UI); the ladder solves report stage `S4` (`stageEU['S4.ladder']`, convergence stage `S4.ladder`).

### v2 pipeline (spec §4.2)

| Stage | Spec | What | Budget |
|---|---|---|---|
| S0 | P0 | baseline (desirability 0) | 1 EU |
| S1 | P1 + P2 | seeds first; screening (x0 + ≤ 4 LHS, stream `S1/lhs/<index>` as v1) → archive; successive halving: η = 3, per-round warm CMA-ES (σ₀ 0.25) on the stage-1 key, all instances of a generation in one evaluator batch (structure-index order); rounds below one generation use probes; survivors = top ⌈n/η⌉ + diversity guard | race share (S 20 %, M 20 %, L 25 %, X 45 %); per-structure round budgets η-geometric (X: 300 → 900 → 2.7k → 8.1k, capped by the share), then X "continue" rounds |
| S2 | P3 | single-goal IPOP anchors for goals 2..K (desirability scales, feasibility report, conflict history) | 25 % of the P3 share + 25 % of the race's unused EU |
| S3 | P3 | ε-lexicographic stages on the race survivors with the quantised stage keys; floors stay lower bounds | rest of the P3 share (+ 75 % of the race's unused EU), split over the active goals; BIPOP on X |
| S4 | P4 | CMA-ME (3 improvement + 1 structural emitter); archive key = final key with relaxed floors; D-first archive on ladder problems | QD share (+ roll-forward) |
| S4.ladder | P5 | Easy, then Medium ε-constraint CMA-ES solves on the ladder key, warm-started from the staircase | ladder share (½ Easy, rest Medium) |
| S5 | P7 | round-and-verify, selection ensemble (OCBA split), chance-constraint repair, validator, pick (Hard key / MMR), distinctness, holdout ensemble | the rest (holdout of 3 options reserved first) |
| S6 | P8 | ablations per option / rung, conflicts, feasibility, anchors, groupBest | what is left |

Unused EU of a stage rolls forward in table order (race → anchors/stages → QD → ladder → S5). Without a ladder there is
no P5 in the run: the ladder share goes to P3 (it decides option A) and the Ideal share to QD (it serves the MMR
alternatives). With a ladder the Ideal share goes to P3, so goal 1's search keeps about the same EU.

### Keys (spec §4.3)

- q_k = max(0.01, minTolerance_k / (u_k − b_k)) with `GoalSpec.minTolerance` (½ of the ensemble P10-P90 half-width, metric
  units); 0.01 without one and for band goals. Computed from the current scale, so ⌊d̃_k/q_k⌋ = ⌊(f_k − b_k)/minTolerance_k⌋
  while the tolerance branch is active (does not move when the anchor improves).
- q_G = max(0.01, √Σ_active (w_k q_k)²) [PROPOSED: the spread of G when every goal is uncertain by one quantum,
  independent errors].
- stageKey_k = (v_S, v_L(j<k), −⌊d̃_k/q_k⌋, R + α·box, −d̃_k); finalKey = (v_S, v_L, −⌊G/q_G⌋, R + α·box, −G);
  Hard key = (v_S, v_L, −⌊G/q_G⌋, ⌊D/q_D⌋, R + α·box, −G) (least burdensome among goal ties);
  ladderKey = (v_S, max(0, thr₁ − d̃₁) + Σ_{j≥2} 2^{−j}·max(0, thr_j − d̃_j), ⌊D/q_D⌋, −⌊d̃₂/q₂⌋…, R + α·box, D) — the
  trailing raw D (not in the spec) gives CMA-ES a gradient inside one difficulty quantum.
- archive key = finalKey with relaxed floors from the start (no provisional comparator any more); robust key in S5 =
  (chance violation, v_L on the selection-ensemble d̃, −⌊G/q_G⌋, [⌊D/q_D⌋], R + α·box, −G).
- Property test: R and the box penalty never overturn a quantised goal difference (stage, final and Hard keys).

### Race (spec §4.5)

- Round 1 = screening probes (x0 + min(b₁, 5) − 1 LHS points), then CMA-ES for structures whose round budget still holds a
  generation (tier X). Later rounds below one generation: N(best, 0.25²) probes (the first generation of the warm
  CMA-ES without its update; the spec says "x0 + LHS probes", which ignores what the structure already found).
- CMA-ES instances (plain CMA-ES, stream `race/<structureId>/<round>`) carry over to the next round while running (they
  are not restarted at σ₀ every round); a stopped instance is replaced by a new warm one at the structure's best.
- Diversity guard: ≥ 2 survivors per goal class (`structureTags`); without tags the 2 best structures of every active
  goal by that goal alone (v_S, −f_k); ladder problems keep the best structure of every occupied D tercile (by its best
  record with D in that tercile).
- The race stops early when one structure is left, or (S/M/L) when ≤ η structures were alive: halving cannot rank them
  and the EU rolls forward to P3 (a single structure gets only its screening). Tier X adds "continue" rounds over the top
  5 with 3× the last budget until the best record has not improved for two rounds (or the share is spent).
- Measured on `needleToy` (24 structures, peak only search reveals, tier M): v2 picks the needle on 6/6 seeds, v1's
  screening shortlist on 2/6.

### Ladder (spec §1.2-1.3)

- D-first archive: D = descriptor 0 binned uniformly (S 10, M/L/X 20 bins), a CVT over the active style descriptors
  (S 6, M 5, L 8, X 16 cells per bin; range rule 0.1) shared by every bin. Every evaluation is offered to it.
- Staircase F(D̄) = best d̃₁ over safe archive elites with D ≤ D̄ (strictly increasing points). Hypervolume of
  {(d̃₁, 1 − D)} against (0, 0) is `ConvergencePoint.hvLadder`.
- Hard (provisional, S4.ladder) = best of the selection pool under the Hard key with strict floors; final Hard = best
  validated, chance-feasible Hard finalist under the robust Hard key (relaxed fallback → `floorsRelaxedForA`).
- g_H < g_min → Easy = Hard: both rungs collapse `belowMinimal` {gHard, gMin}.
- Easy: thr₁ = max(easyShare·g_H, g_min); goals 2..K: d̃_j ≥ min(ρ·d̃_j(H), d̃_j(H)) − δ_j (ρ 0.5; keep goals d̃_j(H) − 2δ_j;
  ≥ 0 when Hard is) with δ_j = `effectiveTolerance` (the floor tolerance). One CMA-ES solve (σ₀ 0.15 [PROPOSED]) warm
  from the lowest-D staircase point meeting thr₁; candidates = best 3 distinct plans under the ladder key among the solve's
  best, the warm start and the archive elites.
- Medium: if D_H − D_E < 0.15 it is not solved (`tooClose`, budget rolls forward). Else the knee of the staircase between
  E and H (normalised distance ≥ 0.05 → thr₁ = the knee's d̃₁, warm start the knee's elite), else mediumShare·g_H; ρ 0.8.
- Rung constraints and orders are judged on nominal values (D is nominal by definition); chance feasibility and the
  validator decide survival in S5 (the first passing candidate per rung; none → `infeasible`).
- Distinctness (`ladderDistinctness`): Hard-Easy D gap < 0.15 → both rungs `tooClose`; Gower(H, E) < 0.20 or d̃₁ / D not
  ordered → both `notDistinct`; otherwise a failing Medium is dropped (`tooClose` / `notDistinct`). `checks` describe the
  rungs actually returned (recomputed after any collapse).
- **Open (lead request, not done at wind-down):** (a) treat d̃₁ ties within q₁ as ordered (holdout/nominal noise) — today
  any d̃₁ inversion beyond 1e-9 collapses; (b) when Easy beats Hard on goal 1 beyond q₁ at lower D, re-pick Hard from
  Easy's record instead of collapsing. Today such a ladder collapses to Hard only (`notDistinct`), never returned unordered. Gower ranges come from the archive elites plus the rungs (not the 2-3 rungs alone).
- `collapsed[].detail` (numbers only, for the domain's sentences): `tooClose` {dGap, minDGap, dHard, dEasy | dMedium,
  gShare (Easy's d̃₁ / Hard's), gShareMedium}; `notDistinct` {gower, minGower | d1Hard, d1Easy, d1Medium, dHard, …,
  gShare}; `belowMinimal` {gHard, gMin}; `infeasible` {thr1 | candidates | easyFound | hardSafe}.
- QD on ladder problems: emitters 1-2 restart from any safe elite (emitter 0 from relaxed-floor-feasible ones), so the
  low-D bins — below goal 1's floor by design — are searched for the best attainment at that effort.

### Robust (spec §4.7)

- Selection ensemble M_s (draws 0..M_s−1), OCBA split [simple deterministic version]: every finalist first gets ⌈M_s/2⌉
  draws; chance repair (tighten × 1.25 and re-polish, ≤ 2 × 150 EU) on those draws, keeping EU for the completions; the
  would-be picks plus finalists within one goal-score quantum of Hard / A are completed to M_s (and re-repaired there)
  before the final pick (≤ 4 rounds). Every chosen option is chance-checked on all M_s draws.
- Holdout ensemble M_h for every chosen option (draws `HOLDOUT_DRAW_OFFSET + m`): `robust`, bands, P(met) and decision
  stability come from it; `holdoutGap[k]` = selection mean d̃_k − holdout mean d̃_k of Hard (A).
- Robust key uses the mean (or CVaR with `robustMode: 'cvar'`) d̃ for every goal; the spec's P(target met) mapping for
  target goals [PROPOSED] is not used in the key (it is reported on the holdout). SAA polish on L/X: not implemented.

### Checkpoints and resume (spec §4.9)

- `config.checkpoint.save` is awaited after S0, the screening, every race round, every anchor, every stage, QD, each rung
  solve, and every `everyEU` EU inside CMA-driven loops (race generations, CMA jobs, QD rounds). S5-S6 are not
  checkpointed: a resume after S4.ladder re-runs them (≤ 15 % of the budget).
- The data holds every record the run still refers to (with its output), goal scales and floors, archive elites and the
  per-cell reserve, race trackers, CMA-ES / IPOP / BIPOP states with their RNG streams, the conflict history, the curve,
  and the keys of every evaluation so far. The evaluation cache is not stored: a resumed run re-evaluates a known key and
  charges 0 EU (as the uninterrupted run's cache hit did), so EU, requests and cache hits match.
- A resume whose fingerprint (seed, tier, budget, structures, goals, ladder, ensembles, race options) differs starts fresh
  (`provenance.resumedFrom = 'refused'`); the domain adds its own request/engine key.
- Tested: resuming from each of 25 checkpoints of an X-short ladder run (6k EU, rounds 20 → 60 → 180 + continue) gives a
  bitwise identical result (options, rungs, staircase, floors, EU, requests, curve, race). Size: ≈ 0.6 MB JSON at 6k EU;
  it grows with the evaluation keys and the conflict history (≈ 25-40 MB JSON at 300k EU — store with structured clone).

## Files and exported API

| File | What it provides |
|---|---|
| `types.ts` | The evaluation contract: `EvalOutput`, `EvalRequest {structure, x, draw}`, `Evaluator`, `PlanStructure`, `PlanModel<S, Sched, Sim>`, `RepairEntry`, `violation()`; v2: `HOLDOUT_DRAW_OFFSET`, `isHoldoutDraw`, `RungId`, `ConvergencePoint` |
| `rng.ts` | `Rng`: xoshiro128** with SplitMix32 seeding, named streams via `fork(label)` (derived from the key, not the parent's state), `getState/fromState`; `latinHypercube`, `halton`, `hashString`, `hashInts` |
| `cmaes.ts` | `CmaEs` (ask/tell over lexicographic `Key`s; full or `sep`; box handling by clamp plus penalty; integer margin), `IpopCmaEs`, `BipopCmaEs` (Hansen 2009; `maxRestarts` counts large-population restarts), state snapshot/restore for all three, `minimize`, `compareKeys`, `argsortKeys`, `jacobiEigen`, `defaultLambda`, `chooseCovariance` |
| `goals.ts` | §4.5 functionals; §4.9 helpers; §4.14 `bindingConstraints`; `rocWeights`, `ladderTolerance`; **`GoalSystem`** (baseline, anchors, d̃/d, P, Q, floors in physical units, the v2 keys `stageKey` / `finalKey` / `hardKey` / `ladderKey`, quanta, `utility`, `feasibilityReport`, state) |
| `archive.ts` | `cvtCentroids` → `CvtGrid`, `RegularGrid`, `DFirstGrid`, `selectActiveDescriptors`, `Archive<T>` (MAP-Elites with a hot-swappable comparator, snapshot/restore), `emitterRankKey`, `gowerDistance` / `featureRanges`, `selectAlternatives` (MMR) |
| `ladder.ts` | Staircase, hypervolume, knee, g_min, rung thresholds, distinctness and collapse rules (pure) |
| `race.ts` | Race round budgets and the survivor selection with the diversity guard (pure) |
| `checkpoint.ts` | Checkpoint data types, output (de)serialisation, JSON encoding that keeps non-finite numbers |
| `conflicts.ts` | `conflictMatrix`, `relationMessages`, `formatRelationMessage`, `formatPayoff`, `priorityCosts`, `kneePoint` |
| `robust.ts` | `evaluateEnsemble`, `robustSummary`, `robustKey`, `robustRerank`, `decisionStability`, `PRACTICALLY_TIED` |
| `pipeline.ts` | `runPlanner(problem, evaluator, config)`, `PlannerProblem<S>`, `PlannerConfig`, `PlannerResult<S>`, `planBudget`, `idealBudgetEU`, `budgetForDevice`, tier tables, `createLocalEvaluator`, `createPooledEvaluator`, `evaluatePlan` |
| `stats.ts` | quantiles (type 7), CVaR, Spearman, `normCdf` / `normInv` |
| `toys.ts` | Benchmark functions and toy planning problems (v2: `ladderToy` with a planted front, `needleToy`; `regimesToy` has a separate holdout LHS). Not re-exported from `index.ts` |
| `index.ts` | Public barrel |

## How the real planner plugs in (v1 text; v2 additions in the section above)

The planner has two sides, which share the same compiled context (person, goals, the structure list in the same order, and the ensemble):

1. **Coordinator side** (a coordinator worker) builds a `PlannerProblem<S>`:
   - `structures`: skeletons enumerated from the block grammar, pruned by tiers, consent and user constraints, and ordered by prior score (§4.11 S1). Each skeleton has `id`, `dim` (n ≈ 15-35), `x0` (block defaults), and `discrete` (integer-coded genes such as weeks, meals and sets, which get the CMA-ES margin).
   - `goals`: the ranked goals as `GoalSpec` (`max` / `min` with optional `target`, or `band`; optional `gamma`, `tolerance`).
   - `baseline`: the status-quo or maintenance plan (§4.6).
   - Optional hooks:
     - `mutateStructure` and `transferGenome` for the S4 structural emitter.
     - `roundGenome` and `gridStep` for the §4.9 friendly rounding.
     - `validate`, the independent validator from §4.4.6 layer 3. Failures are dropped, never repaired.
     - `ablations` for §4.17.
     - `featureSchema` (the Gower schema of the §4.12 φ list) or a custom `distance`.
2. **Evaluator side** (N evaluator workers) implements `PlanModel<S, Sched, Sim>`:
   - `decode(structure, x ∈ [0,1]ⁿ)` then `repair`, which enforces user hard constraints and input-space safety and logs every override (§4.4.4).
   - `simulate(schedule, draw)`, where draw −1 is the nominal parameter set and m is ensemble member m.
   - `goals`: the raw functionals Φ_g in metric units, in goal order. Build them with the `goals.ts` functionals.
   - `constraints`: normalised state-space margins, where ≥ 0 means OK. Include the hunger cap from `hungerCapMargin`.
   - `descriptors`: the §4.12 b₁…b₄, each in [0,1].
   - `regulariser`: λ_H·H + λ_C·C + λ_T·R_term, using `hungerPenalty` and `complexityPenalty`.
   - `features`: the Gower φ.
   - `evaluatePlan(model, structures, req)` turns one request into an `EvalOutput`.
3. **Evaluator binding** (`src/workers`, still to be written). Give `createPooledEvaluator(workers, chunkSize)` one `WorkerCall` per evaluator. A `WorkerCall` is `(batch: EvalRequest[]) => Promise<EvalOutput[]>`, typically a `postMessage` round trip over a transferred `MessagePort` with the `x` buffers in the transfer list. The pool re-assembles outputs by request index, so results do not depend on worker count or timing (tested with scrambled completion order). Tests and Node use `createLocalEvaluator(model, structures)`.
4. **Budget and tier:** run a calibration first (msPerEU), then `budgetForDevice({ msPerEU, workers, targetSeconds })` gives `{ tier, totalEU }`, which you pass as `config.tier`. For a non-standard budget, pass `totalEU`.
5. **Ensemble (§4.15):** draw the parameter LHS once per request, for example `latinHypercube(M, P, new Rng(seed).fork('ensemble'))` in quantile space. Map it to parameter values on the evaluator side, so that `simulate(schedule, m)` uses row m. M is `TIER_ENSEMBLE[tier]` unless `config.ensembleSize` is set.
6. **Result** (`PlannerResult`):
   - Options A, B, C. Each has the genome, the nominal `EvalOutput`, d̃ / d / P / Q, `costVsA`, a robust summary with P10-P90 bands, `aBeatsThisShare` (decision stability) and the top-3 ablations.
   - `feasibility`: per-goal unattainable, joint and met-at-baseline status, plus the nearest attainable target (§4.14).
   - `conflicts` and `relations` (§4.13), and optional `tradeoffs` (the ε-constraint sweep).
   - `noSafePlan`, with the least-infeasible candidate's violated constraints (§4.8).
   - `floorsRelaxedForA`, `shortfall` and `provenance` (seed, tier, EU per stage, cache hits).
   - `groupBest` (when `problem.group` is given): per plan family the best nominal plan seen, under the final key with
     relaxed floors (safe plans first; the domain uses it to say why no option fasts, ruling R-FAST-GATE).
   - `complete` / `stoppedAt` for anytime and cancelled runs.

Progress: `config.onProgress` receives `{stage, euUsed, euBudget, archiveSize, provisional, alternatives?}`.
It fires at every stage end and at least every 2 % of the budget in EU. Provisional A is available from the
end of S3.1, and A/B/C from the end of S4. The worker binding should throttle further by wall time (250 ms,
§4.19), because the engine has no clock.

Cancellation: set `config.signal.aborted` (an `AbortSignal` works). It is checked between generations. The
remaining stages then run without evaluations and the best result so far is returned with `complete: false`.

## Pipeline v1 (§4.11) — superseded by the v2 table above; constants below still apply where named

### v1 tuning constants

| Constant | Value | Source |
|---|---|---|
| λ, μ, weights, c_σ, d_σ, c_c, c₁, c_μ, lazy eigendecomposition | Hansen tutorial defaults | §4.10 [1] |
| sep-CMA learning-rate factor | (n + 2)/3 | §4.10 [4] |
| sep vs full | sep on tier S, full on M/L; `'auto'` means sep if budget < 10 n² | §4.10 |
| IPOP population factor / restart | ×2 on termination | §4.10 [3] |
| Stage termination | best-key range < 10⁻³ over 10 + ⌈30 n/λ⌉ generations | §4.10 |
| Integer margin α | 1/(n λ) | §4.10 [5] |
| Box repair penalty α | 1, applied to ‖x − clamp(x)‖² | §4.8 |
| δ ladder / strictness / δ_target | 0.05, 0.10, 0.15 × {0.5, 1, 2}; 0 | §4.7.3 |
| η (regulariser inside stages) | 0.1 — unused by the v2 keys | §4.7.3 |
| Floor-violation weights | 2^{k−j} | §4.7.3 |
| Provisional quantum | 0.1 — `provisionalKey` only (no longer used by the pipeline) | §4.7.3 |
| ROC weights | (1/K) Σ_{k≥i} 1/k | §4.7.1 [17] |
| END_k, TIR slope, SOFTMIN β | k = 7; 2 % of range; within 1 % of the minimum | §4.5 |
| Hunger penalty | κ = 20, ω = 0.5; cap = h_tol + 0.15 over 7 days | §4.9 |
| Complexity coefficients | 0.015 / 0.02 / 0.01 / 0.01 / 0.02 / 0.01 / 0.05 | §4.9 |
| σ₀ explore / warm | 0.25 / 0.10 | §4.10 |
| Tier budgets | 3k / 12k / 40k EU | §4.11 |
| Stage table | see the pipeline table above | §4.11 |
| CVT cells, Halton points | 64 / 100 / 150; 10⁴ | §4.12 |
| Active-descriptor range, D_min, MMR λ | 0.1, 0.20, 0.5 | §4.12 |
| Ensemble size M | v1 16 / 32 / 32; v2 see `TIER_ENSEMBLE` | §4.15 |
| Chance constraint | every margin's P10 ≥ 0 (bound holds at P90) | §4.15 |
| Re-polish | ≤ 2 iterations × ≤ 150 EU | §4.15 |
| CVaR α, "practically tied" | 0.2, 0.7 | §4.15 |
| κ ε, class thresholds, ρ subset | 0.05; 0.10 / 0.50; ρ ≥ 0.30; top 25 % by U | §4.13 |
| Trade-off sweep | levels 1 / 0.9 / 0.8 / 0.7 × A_i, ≤ 200 EU each | §4.13 |
| Binding constraint | active on ≥ 20 % of days | §4.14.2 |
| Round-and-verify search | ≤ 30 EU | §4.9 |
| Cache quantisation | 10⁻⁶ | §4.11 |
| λ quantum per tier | S 3, M/L 8 | this README (deviation 1) |
| QD emitter σ₀, structural mutation noise | 0.15, 0.05 | PROPOSED here (not specified) |
| Chance tightening safety factor | 1.25 | PROPOSED here (deviation 3) |

## Tuning constants (v2) and their sources

| Constant | Value | Source |
|---|---|---|
| Tier budgets | S 3k, M 12k, L 40k, X 300k EU | spec §4.8 |
| `TIER_SHARES` race / stages / QD / ladder / Ideal / robust | S .20/.30/.10/.12/.13/.15; M .20/.30/.15/.10/.12/.13; L .25/.25/.15/.10/.10/.15; X .45/.15/.15/.08/.07/.10 | spec §4.8 |
| `ANCHOR_SHARE` (anchors inside P3) | 0.25 | PROPOSED here (v1 gave anchors ≈ 20-25 % of S2 + S3) |
| Race η, σ₀, rounds | 3, 0.25, S 2 / M 3 / L 4 / X 4 | spec §4.5, §4.8 |
| Screening probes | x0 + ≤ 4 LHS | v1 S1 |
| X round budgets, continue | 300 / 900 / 2.7k / 8.1k EU per survivor; top 5, ×3, stop after 2 rounds without improvement | spec §4.8-4.9 |
| Diversity guard | 2 per goal class (or per goal), 1 per occupied D tercile | spec §4.5 |
| q_k, q_G, q_D | max(0.01, minTol/(u − b)); max(0.01, √Σ(w q)²); 0.02 | spec §4.3, §1.3 (q_G formula PROPOSED) |
| D bins / style cells per bin | S 10/6, M 20/5, L 20/8, X 20/16 | spec §1.2 |
| Archive cells without a ladder | S 64, M 100, L 150, X 200 | §4.12 (X PROPOSED) |
| Ensembles selection / holdout | S 16/32, M 32/64, L 64/64, X 128/128 | spec §4.7 |
| OCBA first pass | ⌈M_s/2⌉ draws (M_s ≥ 4); contenders within 1 goal-score quantum | PROPOSED here |
| Ladder easy / medium share, ρ Easy / Medium, keep factor | 0.5 / 0.8, 0.5 / 0.8, 2 | spec §1.3 |
| Knee minimum, min D gap, min Gower, g_min fallback | 0.05, 0.15, 0.20, 10 % of goal 1's range | spec §1.3 |
| Rung solve σ₀, candidates per rung | 0.15, 3 | PROPOSED here |
| Restarts | IPOP on S/M/L, BIPOP on X | spec §4.8 |
| Convergence points | every 2 % of the run budget + every stage end | spec §4.9 |
| Finalists | ≤ min(10, ½·(avail − holdout − 15 %)/M_s); ladder: ≤ 4 Hard + ≤ 3 per rung | v1 rule, v2 split PROPOSED |

## Deviations from the dossier (and why)

1. **λ is rounded to a tier constant (S 3, M/L 8), not to the live worker count.** The §4.10 rule λ = max(4 + ⌊3 ln n⌋, 2 N_workers), rounded to a multiple of N_workers, would make results depend on the worker count. That contradicts §4.19 and §7.3.7 (bitwise-identical output for any N).
2. **Budget surplus lifts S3 to a ≥ 30 % share before S4 gets the rest.** The §4.11 absolute table gives S3 only 12 % when K = 1, while its share column says 30-35 %. The rule follows the share column. It changes nothing for K ≥ 3 on tier S (the table already gives 35 %).
3. **S5 split.** Finalists are limited to ⌊0.5·S5/M⌋ (≤ 10) so the chance-constraint repair has budget on tier S. The repair may spend the S6 share, because safety outranks explanations. Tightening is multiplied by 1.25, since re-polishing to exactly the P50−P10 gap lands on the P90 boundary.
4. **MMR restricts the argmax to candidates with min D ≥ D_min.** The dossier stops as soon as the argmax is too close. In that version a high-utility near-duplicate of A ends the search while distinct options still exist.
5. **Fallback when no safe finalist meets the relaxed floors.** This happens, for example, after the P90 chance constraint lowers goal 1 below its nominal floor. A is then the safe plan with the smallest floor violation (Deb's ordering), flagged `floorsRelaxedForA`. The dossier does not cover this case.
6. **IPOP inside pipeline stages restarts from the stage-best genome** (σ₀ 0.25, 2λ) instead of a uniform random point, because the stages are warm-started. The standalone `IpopCmaEs` uses uniform restarts by default, following [3].
7. **CMA-ES with Margin:** the "side" (A-matrix) correction is applied only when a tail probability is below α/2. Otherwise it is an identity mathematically, but the CDF/quantile approximations would add drift.
8. **Jacobi eigensolver is warm-started** on BᵀCB (cold restart every 64 updates). It is still our own Jacobi (§4.20); measured ≈ 1.7× faster end-to-end on 40-D full-covariance IPOP runs.
9. **Band goals:** with the default widths (distance from baseline to the band) this is exactly the §4.6 two-sided form. With custom widths, d̃ is rescaled so that the baseline maps to 0.
10. **Goals met at baseline or not improvable** are skipped in the stages and in U, and reported as such. They do not become floors.
11. **The regulariser is a true tie-breaker in the final comparator** (ruling R-FAST-GATE, 2026-10-01; PLAN item 8
    decision 4). `finalKey` = (v_S, v_L, −⌊G / 0.01⌋, R + α·box, −G) with the weighted goal score G = Σ w·min(1, d̃)
    (`GOAL_SCORE_STEP`), and option A is chosen the same way (`compareGoalFirst` in `selectAlternatives`). §4.7.3 put −U
    with U = G − R last, so a complexity/hunger/time penalty could outweigh a better plan (golden request d: a 72-h-fast
    plan with G 0.728 lost to G 0.715). v2 (PLANNER_V2_SPEC §4.3) applies the same rule to the stage keys
    (quantised level first, R after it; η no longer enters any key) and replaces the fixed step by q_G.
11. **Stage budget guard:** a stage also stops after 3× its EU budget in requests. This prevents endless 0-EU cache-hit loops when samples clamp onto the same corner.
12. **Progress is throttled by EU, not by 250 ms**, because the engine has no clock. The worker binding should throttle by time.
13. **The ε-constraint verification sweep (§4.13) is implemented but off by default** (`config.tradeoffSweep`). §4.11 allocates it no budget, so enabling it reserves 800 EU from S4.
14. **The ±50 % regression against the §4.10 table skips the rotated ellipsoid at the 10⁻² target.** That count depends on the dossier's unrecorded random rotation (we measure ≈ 800 full / ≈ 1,170 sep versus 1,764 / 1,920). All other entries, including the rotated ellipsoid at 10⁻³, are within ±50 %.
15. **Floors of unreached targets** give up δ_k of the *achievable* range (§4.7.3 wording), not δ_k of d̃: d̃ of a target goal is scaled to the target, so δ_k of d̃ was δ_k of the distance to a target that may lie far beyond reach.
16. **Keep goals** (`GoalSpec.keep`, planner round 2026-09-30): a target with a shortfall scale; desirability 1 when met, 0 `keep` units short. Unlike a plain target they stay active when the baseline meets them, so "keep fat mass" constrains the higher-ranked goal instead of being skipped (deviation 10 still holds for plain targets).
17. **`GoalSpec.minTolerance`** (metric units) floors the tolerance a stage applies, e.g. at the model's own ensemble spread: floors never demand more precision than the model has.
18. **Warm starts:** `PlannerProblem.seeds` are evaluated first in S1; the result carries per-goal **`anchors`** (best safe nominal plan per goal) and each ablation's **`safe`** flag (the neutralised variant met every margin).

### v2 deviations from the spec (summary; details in the v2 sections above)

19. Quanta are computed from the current goal scales (not frozen at P0 probes); the level stays scale-invariant.
20. The ladder key ends with the raw D; the robust key does not use P(target met).
21. Race: carried-over instances, Gaussian probes below one generation after round 1, early stop at ≤ η structures
    (S/M/L) or one survivor, interleaving in structure-index (prior) order rather than id order.
22. Single-goal anchors (S2) are kept for goals 2..K (desirability scales, feasibility report, conflict history).
23. Without a ladder: P5 share → P3, P6 share → QD (the run spends the whole total).
24. OCBA is a split of the selection ensemble (no draws beyond M_s − 1, which the contract does not define).
25. Medium is not solved when D_H − D_E < 0.15; rung constraints are checked on nominal values.
26. Archive: final key with relaxed floors from the first insertion; a per-cell reserve (best safe record per goal) is
    re-offered whenever a floor is set (replaces v1's list of every pre-floor record, which a checkpoint cannot carry).
27. Not implemented: CMA-MAE (config switch), SAA polish on L/X, the K ≥ 4 cut-off on tier S, k-NN warm starts (all
    [BENCH] in the spec).
28. The holdout ensemble is on by default only for ladder problems (contract: `TIER_HOLDOUT` everywhere); problems
    without a ladder opt in with `holdoutSize`, because their evaluators (time-to-target, re-plan) may not serve holdout
    draws. `LadderSpec.reserveIdeal` is an addition requested by the lead (the v1 wrapper runs without the Ideal).

## Known limitations

- **ρ artefact:** ρ over the top 25 % by U (§4.13) can report a false "synergy" between goals that are independent, when one of them conflicts with a more heavily weighted goal. Selecting on U induces the correlation. κ is unaffected, and the run-history test classifies correctly. The rule may need revisiting with the real engine.
- **Cross-browser determinism:** CMA-ES and Box-Muller use `Math.exp`, `Math.log`, `Math.sqrt`, `Math.sin` and `Math.cos`. Results are bitwise stable within one JS engine only (§4.19, [78]). If the engine ships fdlibm ports, route these calls through them too.
- **Memory:** the evaluation cache keeps every `EvalOutput`, about 12 MB at 40k EU on tier L. Add an LRU if that becomes a problem.

- **Checkpoint size** grows with the evaluation keys and the conflict history (both O(EU)); fine for IndexedDB with
  structured clone, heavy as JSON at 300k EU.
- **Race on tier S** with real structure counts (≈ 60) is mostly probes (per-structure rounds of ≈ 4 and ≈ 13 EU are
  below one generation at n ≈ 25); the stages do the search.

## Tests (`pnpm vitest run src/engine/planner/optim`, 99 tests, ≈ 6 s alone, ≈ 10 s under load)

v2 tests (`pipeline.v2.test.ts`, `goals.test.ts` "quantised keys", `cmaes.test.ts` / `rng.test.ts` state and BIPOP):

| Test | Result (timing on the dev box) |
|---|---|
| Quantised-key property (3,000 random goal systems and plan pairs) | R / box never overturn a quantised level (stage, final, Hard keys); q_k level invariant under anchor moves |
| Ladder toy (planted front F(e) = 1 − (1 − e)², tier S) | Hard D ≈ 0.85, Medium at the knee (≈ 0.60), Easy ≈ 0.29 (planted 0.293); ordered, gaps ≥ 0.15, Gower ≥ 0.2 (≈ 50 ms per run) |
| Degenerate front / g_H < g_min | Hard only; `tooClose` ×2 / `belowMinimal` ×2 with details (≈ 20 ms) |
| Provisional rungs + convergence curve | Hard and Easy streamed from S3.1; curve every 2 % + stage ends; hvLadder > 0.4 |
| Race "needle in a structure" (24 structures, tier M) | needle survives every round and wins on 6/6 seeds (v1: 2/6) (≈ 150 ms per run) |
| Holdout | `robust` on 32 holdout draws, `robustSelection` on 16, `holdoutGap` = their mean-d̃ difference; v1 default (no ladder) keeps robust = selection |
| Budget adherence (totals 60-700 EU, 4 toys) | `euUsed ≤ budgetEU` everywhere (also a 210-run sweep incl. tier X, 0 overruns); `reserveIdeal: false` spends the total |
| Optimiser overhead (outside the evaluator, tier M/L toys) | 0.017-0.037 ms per EU (v1 0.019-0.044) — < 0.3 % of a 12-ms engine evaluation; mean evaluator batch 25-69 (v1 44-54) |
| X-short checkpoint / resume (6k EU, 25 checkpoints) | every resume bitwise identical; refused on a different seed (≈ 2.4 s for 26 runs) |
| Determinism | ladder S and X-short bitwise identical for 1/4/8 workers, chunks 1/4/3, scrambled completion |
| v1 suite | unchanged except: budgets test (v2 shares), stage-key test (v2 key), chance test reads `robustSelection` for the chance constraint and `robust` (holdout) for the reported bands |

### v1 test table (still passing)

| Dossier item | Test | Result (evaluations) |
|---|---|---|
| 7.2.1 known optima | shifted sphere to 10⁻⁸: n = 10 / 20 / 40 full, 40 sep | 1,089 / 2,104 / 3,909 / 3,919 |
| | Rosenbrock to 10⁻⁸: n = 10 / 20 | 6,063 / 22,382 |
| | Rastrigin in [−5.12, 5.12]ⁿ, global optimum 10⁻⁸ with IPOP: n = 10 full / 20 sep / 40 sep | 87k / 116k / 268k (λ up to 160 / 192 / 240) |
| | §4.10 table (sphere, axis and rotated ellipsoid, n = 20/40, full and sep, 10⁻² and 10⁻³ of f(x₀)), median of 3 seeds | all within ±50 % (see deviation 14) |
| | Boundary optimum (clamp + penalty); integer genes with and without the margin | converges; freezes without the margin |
| 7.2.2 linear energy balance | tier-S run | 99.999 % of the analytic optimum, 2.7k EU |
| 7.2.3 two-goal front | 10 seeds | d₁ = 0.95, d₂ = 0.185 ± 0.02 on ≥ 9/10 seeds |
| 7.2.4 structure discovery | adaptation toy | cycle wins with the mechanism, steady wins without it |
| 7.2.6 brute-force oracle | 12 skeletons × 21² grid (5,292 plans) | within 1 % under the oracle's comparator |
| 7.2.7 price of structure | structured vs weekly-CVP at tier M | gap ≤ 5 % |
| 7.3.1-7.3.5, 7.3.7 metamorphic | constraint relaxation, horizon, goal swap, appended goal, unit ×1024 (bitwise), worker counts 1/4/8 with chunk sizes 1/4/8 and scrambled completion order (bitwise) | pass |
| 7.6.1 / 7.6.2 | options pairwise D ≥ 0.20 within relaxed floors; conflict classes from run history | pass |
| §4.15 robustness | P90 chance constraint, repair, CVaR, decision stability, common random numbers | pass |
| Orchestration | budgets, tiers, progress (A after S3.1, A/B/C after S4), cancellation (anytime), no safe plan, validator, rounding, ablations | pass |
