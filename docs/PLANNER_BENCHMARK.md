# Planner benchmark

*Run 1sqatkt of 2026-10-18; engine 1.3.0-policy, parameter set 137eb920, plan library 1, planner comparison policy 2 (pol2-d085395b), reference set review-policy-v1.*

The planner searches for the plan that best serves your goals in priority order within your limits and the safety rules. This report measures how close its plans come to the best plan, how fast it gets there, and how well its easier and harder plans cover the trade-off between effort and result. Each problem is solved many times with different random seeds; the previous planner and the shipped planner (previous search proposes the hardest plan, new ladder) get the same problems, the same evaluations and the same random draws, so their results can be compared run by run.

## What is shown and what is not

- On small real plan spaces (each searched exhaustively, every plan simulated), the plan returned first was within half the priority tolerance of the best plan on every goal in 69 % of runs; its median shortfall on goal 1 was 0.00 % of what goal 1 can gain in that space.
- On problems with planted priorities and a known best plan, the returned plan met every priority within half its tolerance in 95 % of runs.
- When the best plan hides in one plan shape among 50-400, the search found it (within tolerance) in 0 % of runs.
- On frontiers with a known shape, the returned plans covered a median 91 % of the area the ideal three-plan ladder covers.
- Under uncertain physiology, returned plans kept their limits in a median 100.0 % of 10,000 draws.
- No returned plan broke a safety limit or failed the independent plan check.
- On those small spaces the exhaustive best plan by the nominal model kept every safety limit in at least 90 % of 256 draws of the model's uncertain parameters in 4 of 6 spaces; among the 50 best plans, the best one that did was ranked 1, 1, 1, 13 by the nominal search. The full planner checks every returned plan this way before returning it.

Not shown by this benchmark:

- That plans are the best possible for full requests: there the reference is the best plan any run of the benchmark returned, not an exhaustive search.
- That the model of the body is right: every result here is measured inside the model. How the model compares with published studies is in the validation report.
- Wall times on other devices: they were measured on one machine shared with other work, so they are indicative only; evaluation counts are the stable cost measure.
- That a goal no run reached cannot be reached: a search that finds nothing within its budget is not proof that no plan exists.

## Headline results

Tier S, holdout split. "Better" needs a paired test below 0.05 after correcting for the number of suites and an effect size Â₁₂ of at least 0.56.

| Suite | Measure | previous planner | shipped planner (previous search proposes the hardest plan, new ladder) | Difference | p (corrected) | Â₁₂ | Verdict |
|---|---|---|---|---|---|---|---|
| Full requests | lex-success (% of runs) | 36.7 | 35.0 | -1.7 | 1.000 | 0.49 (negligible) | no difference |
| Full requests | goal-1 regret (% of goal 1 range (median)) | 0.5 | 0.5 | 0.0 | 0.275 | 0.51 (negligible) | no difference |
| Full requests | time to 95 % (EU (expected running time)) | 684 | 737 | 53 | 1.000 | 0.50 (negligible) | no difference |
| Full requests | ladder hypervolume (returned plans (median)) | 0.473 | 0.657 | 0.185 | < 0.001 | 0.65 (medium) | better |
| Small real plan spaces (exhaustive search) | lex-success (% of runs) | 67.7 | 68.8 | 1.1 | 1.000 | 0.51 (negligible) | no difference |
| Small real plan spaces (exhaustive search) | goal-1 regret (% of goal 1 range (median)) | 0.0 | 0.0 | 0.0 | < 0.001 | 0.55 (negligible) | no difference |
| Small real plan spaces (exhaustive search) | time to 95 % (EU (expected running time)) | 1908 | 3007 | 1099 | < 0.001 | 0.25 (large) | worse |
| Small real plan spaces (exhaustive search) | ladder hypervolume (returned plans (median)) | 0.233 | 0.248 | 0.015 | < 0.001 | 0.52 (negligible) | no difference |
| Continuous test functions | lex-success (% of runs) | 76.1 | 78.0 | 1.9 | 0.461 | 0.51 (negligible) | no difference |
| Continuous test functions | goal-1 regret (% of goal 1 range (median)) | 0.2 | 0.1 | -0.1 | < 0.001 | 0.64 (small) | better |
| Continuous test functions | time to 95 % (EU (expected running time)) | 886 | 751 | -135 | 0.023 | 0.49 (negligible) | no difference |
| Planted priorities | lex-success (% of runs) | 56.5 | 94.6 | 38.2 | < 0.001 | 0.69 (medium) | better |
| Planted priorities | goal-1 regret (% of goal 1 range (median)) | 0.4 | 0.1 | -0.3 | < 0.001 | 0.69 (medium) | better |
| Planted priorities | time to 95 % (EU (expected running time)) | 677 | 499 | -178 | 1.000 | 0.48 (negligible) | no difference |
| Needle among many plan shapes | lex-success (% of runs) | 0.0 | 0.0 | 0.0 | 1.000 | 0.50 (negligible) | no difference |
| Needle among many plan shapes | goal-1 regret (% of goal 1 range (median)) | 7.4 | 7.4 | -0.1 | < 0.001 | 0.58 (small) | better |
| Needle among many plan shapes | time to 95 % (EU (expected running time)) | – | – | – | 1.000 | 0.50 (negligible) | no difference |
| Effort-attainment frontier | lex-success (% of runs) | 100.0 | 100.0 | 0.0 | 1.000 | 0.50 (negligible) | no difference |
| Effort-attainment frontier | goal-1 regret (% of goal 1 range (median)) | 0.0 | 0.0 | -0.0 | < 0.001 | 0.59 (small) | better |
| Effort-attainment frontier | time to 95 % (EU (expected running time)) | 153 | 153 | 0 | 1.000 | 0.50 (negligible) | no difference |
| Effort-attainment frontier | ladder hypervolume (returned plans (median)) | 0.085 | 0.401 | 0.317 | < 0.001 | 0.88 (large) | better |
| Uncertain physiology | lex-success (% of runs) | 50.0 | 91.9 | 41.9 | < 0.001 | 0.71 (medium) | better |
| Uncertain physiology | goal-1 regret (% of goal 1 range (median)) | 0.5 | 0.1 | -0.5 | < 0.001 | 0.71 (medium) | better |
| Uncertain physiology | time to 95 % (EU (expected running time)) | 466 | 387 | -78 | 0.840 | 0.48 (negligible) | no difference |

## Acceptance gate

A new planner is accepted only if, on every suite, it is not worse by more than 2 points of lex-success and 1 % of goal 1 range in regret (one-sided, 95 % bootstrap bounds over paired runs), and it is better on at least one suite or equally good at least 20 % faster.

**Verdict: the shipped planner (previous search proposes the hardest plan, new ladder) fails: not shown to be non-inferior on R2.**

| Suite | Pairs | Lex-success change (lower bound) | Regret change (upper bound) | Not worse | p (corrected) | Â₁₂ | Wall-time ratio | Better |
|---|---|---|---|---|---|---|---|---|
| Full requests | 180 | -1.7 (-4.4) | -0.85 (0.59) | no | 1.000 | 0.49 | 1.81 | no |
| Small real plan spaces (exhaustive search) | 186 | 1.1 (0.0) | -0.20 (-0.08) | yes | 1.000 | 0.51 | 1.89 | no |
| Continuous test functions | 372 | 1.9 (0.5) | -1.30 (-1.11) | yes | < 0.001 | 0.64 | 0.99 | yes |
| Planted priorities | 186 | 38.2 (32.3) | -4.66 (-4.03) | yes | 1.000 | 0.49 | 0.99 | no |
| Needle among many plan shapes | 186 | 0.0 (0.0) | -0.08 (0.02) | yes | < 0.001 | 0.58 | 0.99 | yes |
| Effort-attainment frontier | 186 | 0.0 (0.0) | -0.01 (-0.00) | yes | < 0.001 | 0.59 | 1.24 | yes |
| Uncertain physiology | 124 | 41.9 (34.7) | -4.67 (-3.82) | yes | 0.328 | 0.38 | 1.02 | no |

## Suites

- **Continuous test functions**: sphere, ellipsoid, Rosenbrock and Rastrigin with 10, 20 and 40 settings; the best value is known.
- **Planted priorities**: 2-4 ranked goals over several plan shapes with whole-number settings; goal 1 has many equally good plans, goal 2 picks among them and is limited by two safety limits that both bind at the best plan; decoy shapes are better for goal 2 but fall outside goal 1's tolerance. The best plan is known exactly.
- **Needle among many plan shapes**: 50-400 plan shapes; the best one has a narrow basin that random tries miss, while decoys look good at first and end worse. Two problems put the best shape beyond the 60 shapes the quickest tier screens, to measure what that cap costs.
- **Effort-attainment frontier**: attainment against difficulty with convex, concave and broken frontiers of known shape; measures the ladder of easier and harder plans.
- **Uncertain physiology**: the planted-priorities problems with uncertain parameters; one limit moves with the parameters, so the best plan must keep a margin (the limit has to hold in 90 % of draws). Returned plans are scored on 10,000 draws.
- **Small real plan spaces**: the five reference requests and the autophagy-first request on the real model, restricted to 1-3 plan shapes and 4-6 settings on their usual steps (5,000-30,000 plans each); every plan is simulated to find the exact best plan.
- **Full requests**: the same six requests and 20 generated requests (10 for tuning, 10 held out for the verdict), solved in full; the reference is the best plan any run returned.

## Measures

- **Lex-success**: the share of runs whose first plan is within half the priority tolerance of the best plan on goal 1 and then on every lower goal (tolerance 5 % of goal 1's range, 10 % for goal 2, 15 % below).
- **Goal-1 regret**: how much of goal 1's achievable range the first plan leaves on the table; per problem also in the goal's own unit (kg, cm, …).
- **Time to quality**: evaluations (one simulated plan each) until the best plan seen reaches 50, 80, 90, 95 and 99 % of the reference score; expected running time counts the unsuccessful runs too.
- **Ladder**: area covered by the returned plans in the plane of attainment against difficulty (1 = full result at no effort), the same for every plan the search saw, the distance to the best frontier known, whether the plans are distinct enough (difficulty gaps of at least 0.15 and different enough settings) and ordered (a harder plan never achieves less).
- **Robustness**: how much better a plan looked on the draws used to choose it than on independent draws, and whether every returned plan keeps every limit in at least 90 % of 256 fresh draws.

### Full requests

12 problem(s).

| Measure | previous planner | shipped planner (previous search proposes the hardest plan, new ladder) |
|---|---|---|
| Runs (failed) | 180 (0) | 180 (0) |
| Lex-success | 37 % | 35 % |
| Lex-success, median over problems | 27 % | 27 % |
| Goal-1 regret, median [95 % interval] | 0.46 % [0.20, 1.47] | 0.46 % [0.00, 1.19] |
| Score vs reference, median | 94.0 % | 93.2 % |
| Runs reaching 95 % of the reference | 93 % | 97 % |
| Expected evaluations to 95 % [95 % interval] | 684 [538, 848] | 737 [575, 929] |
| Median evaluations / seconds to 95 % | 303 / 0.7 | 324 / 1.0 |
| Anytime score (area under the success curve) | 0.653 | 0.691 |
| Ladder area of returned plans | 0.473 | 0.657 |
| Ladder area of every plan seen | 0.789 | 0.828 |
| Distance to the best frontier known | 0.038 | 0.019 |
| Ladders distinct and ordered | 1 % | 15 % |
| Order violations per run | 0.73 | 0.00 |
| Plans returned per run | 2.39 | 2.39 |
| Own archive filled | 23 % | 28 % |
| Goal 1: chosen-on vs independent draws (gap) | 0.003 | 0.003 |
| Runs whose plans keep every limit in ≥ 90 % of draws | 91 % (lowest 77.3 %) | 92 % (lowest 83.2 %) |
| Fasting-served requests: a plan fasts or a fasting plan was compared | 100 % | 100 % |
| Safety violations | 0 | 0 |
| Evaluations per run, median | 2813 | 4626 |
| Wall time per run, median (s) | 19.5 | 34.2 |

| Problem | Pairs | Lex-success (previous planner / shipped planner (previous search proposes the hardest plan, new ladder)) | Goal-1 regret, median (previous planner / shipped planner (previous search proposes the hardest plan, new ladder)) | p (corrected) | Â₁₂ |
|---|---|---|---|---|---|
| b | 15 | 33 % / 33 % | -0.013 / -0.022 kg | 1.000 | 0.52 |
| c | 15 | 7 % / 7 % | -0.092 / -0.024 kg | 1.000 | 0.48 |
| e | 15 | 0 % / 0 % | 0.022 / 0.022 kg | 1.000 | 0.51 |
| fuzz10 | 15 | 20 % / 0 % | -0.004 / -0.012 kg | 1.000 | 0.46 |
| fuzz11 | 15 | 47 % / 40 % | 0.014 / 0.014 mL/kg/min | 1.000 | 0.43 |
| fuzz12 | 15 | 7 % / 7 % | 0.302 / 0.302 mmol/L | 1.000 | 0.39 |
| fuzz13 | 15 | 20 % / 20 % | 0.125 / 0.127 kg | 1.000 | 0.47 |
| fuzz14 | 15 | 100 % / 100 % | 0.000 / 0.000 kg | 1.000 | 0.50 |
| fuzz15 | 15 | 20 % / 13 % | 0.136 / 0.128 kg | 1.000 | 0.45 |
| fuzz16 | 15 | 93 % / 87 % | -0.028 / -0.007 kg | 1.000 | 0.54 |
| fuzz18 | 15 | 53 % / 73 % | 0.023 / -0.003 kg | 1.000 | 0.52 |
| fuzz19 | 15 | 40 % / 40 % | 0.050 / 0.050 kg | 1.000 | 0.50 |

### Small real plan spaces (exhaustive search)

6 problem(s).

| Measure | previous planner | shipped planner (previous search proposes the hardest plan, new ladder) |
|---|---|---|
| Runs (failed) | 186 (0) | 186 (0) |
| Lex-success | 68 % | 69 % |
| Lex-success, median over problems | 100 % | 100 % |
| Goal-1 regret, median [95 % interval] | 0.00 % [0.00, 0.00] | 0.00 % [0.00, 0.00] |
| Score vs reference, median | 0.0 % | 0.0 % |
| Runs reaching 95 % of the reference | 30 % | 30 % |
| Expected evaluations to 95 % [95 % interval] | 1908 [1269, 2806] | 3007 [1995, 4524] |
| Median evaluations / seconds to 95 % | 2 / 0.2 | 2 / 0.2 |
| Anytime score (area under the success curve) | 0.268 | 0.270 |
| Ladder area of returned plans | 0.233 | 0.248 |
| Ladder area of every plan seen | 0.277 | 0.296 |
| Distance to the best frontier known | 0.000 | 0.000 |
| Ladders distinct and ordered | 2 % | 1 % |
| Order violations per run | 0.22 | 0.00 |
| Plans returned per run | 1.45 | 1.19 |
| Own archive filled | 56 % | 10 % |
| Safety violations | 0 | 0 |
| Evaluations per run, median | 1333 | 1949 |
| Wall time per run, median (s) | 2.2 | 8.8 |

| Problem | Pairs | Lex-success (previous planner / shipped planner (previous search proposes the hardest plan, new ladder)) | Goal-1 regret, median (previous planner / shipped planner (previous search proposes the hardest plan, new ladder)) | p (corrected) | Â₁₂ |
|---|---|---|---|---|---|
| a | 31 | 100 % / 100 % | 0.000 / 0.000 kg | 1.000 | 0.50 |
| af | 31 | 100 % / 100 % | 0.000 / 0.000 kg | 1.000 | 0.50 |
| b | 31 | 0 % / 0 % | -0.085 / -0.085 kg | 0.009 | 0.30 |
| c | 31 | 6 % / 13 % | 0.685 / 0.320 kg | 1.000 | 0.50 |
| d | 31 | 100 % / 100 % | 0.000 / 0.000 kg | 1.000 | 0.50 |
| e | 31 | 100 % / 100 % | 0.001 / 0.000 kg | < 0.001 | 0.89 |

### Continuous test functions

12 problem(s).

| Measure | previous planner | shipped planner (previous search proposes the hardest plan, new ladder) |
|---|---|---|
| Runs (failed) | 372 (0) | 372 (0) |
| Lex-success | 76 % | 78 % |
| Lex-success, median over problems | 100 % | 100 % |
| Goal-1 regret, median [95 % interval] | 0.18 % [0.15, 0.22] | 0.09 % [0.04, 0.11] |
| Score vs reference, median | 99.8 % | 99.9 % |
| Runs reaching 95 % of the reference | 79 % | 84 % |
| Expected evaluations to 95 % [95 % interval] | 886 [715, 1079] | 751 [620, 903] |
| Median evaluations / seconds to 95 % | 107 / 0.1 | 130 / 0.1 |
| Anytime score (area under the success curve) | 0.641 | 0.641 |
| Own archive filled | 100 % | 100 % |
| Safety violations | 0 | 0 |
| Evaluations per run, median | 2670 | 2550 |
| Wall time per run, median (s) | 0.2 | 0.2 |

| Problem | Pairs | Lex-success (previous planner / shipped planner (previous search proposes the hardest plan, new ladder)) | Goal-1 regret, median (previous planner / shipped planner (previous search proposes the hardest plan, new ladder)) | p (corrected) | Â₁₂ |
|---|---|---|---|---|---|
| ellipsoid-10 | 31 | 100 % / 100 % | 0.104 / 0.000 f | < 0.001 | 1.00 |
| ellipsoid-20 | 31 | 100 % / 100 % | 2.553 / 0.023 f | < 0.001 | 1.00 |
| ellipsoid-40 | 31 | 100 % / 100 % | 49.583 / 6.362 f | < 0.001 | 1.00 |
| rastrigin-10 | 31 | 13 % / 35 % | 17.999 / 11.939 f | 0.003 | 0.73 |
| rastrigin-20 | 31 | 0 % / 0 % | 133.070 / 39.525 f | < 0.001 | 0.94 |
| rastrigin-40 | 31 | 0 % / 0 % | 355.330 / 340.087 f | 0.002 | 0.74 |
| rosenbrock-10 | 31 | 100 % / 100 % | 7.890 / 6.356 f | < 0.001 | 0.85 |
| rosenbrock-20 | 31 | 100 % / 100 % | 20.628 / 17.286 f | < 0.001 | 0.82 |
| rosenbrock-40 | 31 | 100 % / 100 % | 210.999 / 46.808 f | < 0.001 | 0.97 |
| sphere-10 | 31 | 100 % / 100 % | 0.000 / 0.000 f | < 0.001 | 1.00 |
| sphere-20 | 31 | 100 % / 100 % | 0.000 / 0.000 f | < 0.001 | 1.00 |
| sphere-40 | 31 | 100 % / 100 % | 0.020 / 0.000 f | < 0.001 | 1.00 |

### Planted priorities

6 problem(s).

| Measure | previous planner | shipped planner (previous search proposes the hardest plan, new ladder) |
|---|---|---|
| Runs (failed) | 186 (0) | 186 (0) |
| Lex-success | 56 % | 95 % |
| Lex-success, median over problems | 60 % | 95 % |
| Goal-1 regret, median [95 % interval] | 0.39 % [0.15, 3.78] | 0.06 % [0.05, 0.09] |
| Score vs reference, median | 99.6 % | 99.6 % |
| Runs reaching 95 % of the reference | 90 % | 100 % |
| Expected evaluations to 95 % [95 % interval] | 677 [539, 840] | 499 [447, 555] |
| Median evaluations / seconds to 95 % | 289 / 0.2 | 392 / 0.2 |
| Anytime score (area under the success curve) | 0.598 | 0.596 |
| Own archive filled | 72 % | 95 % |
| Safety violations | 0 | 0 |
| Evaluations per run, median | 2671 | 2545 |
| Wall time per run, median (s) | 0.2 | 0.2 |

| Problem | Pairs | Lex-success (previous planner / shipped planner (previous search proposes the hardest plan, new ladder)) | Goal-1 regret, median (previous planner / shipped planner (previous search proposes the hardest plan, new ladder)) | p (corrected) | Â₁₂ |
|---|---|---|---|---|---|
| k2-s4 | 31 | 48 % / 100 % | 16.202 / 0.057 units | < 0.001 | 0.80 |
| k2-s8 | 31 | 71 % / 100 % | 0.396 / 0.113 units | 1.000 | 0.45 |
| k3-s4 | 31 | 77 % / 100 % | 0.421 / 0.336 units | 1.000 | 0.45 |
| k3-s8 | 31 | 16 % / 90 % | 9.679 / 0.161 units | 0.007 | 0.65 |
| k4-s4 | 31 | 39 % / 87 % | 11.219 / 0.256 units | < 0.001 | 0.17 |
| k4-s8 | 31 | 87 % / 90 % | 0.852 / 0.381 units | 0.208 | 0.35 |

### Needle among many plan shapes

6 problem(s).

| Measure | previous planner | shipped planner (previous search proposes the hardest plan, new ladder) |
|---|---|---|
| Runs (failed) | 186 (0) | 186 (0) |
| Lex-success | 0 % | 0 % |
| Lex-success, median over problems | 0 % | 0 % |
| Goal-1 regret, median [95 % interval] | 7.45 % [7.39, 8.09] | 7.38 % [7.19, 7.39] |
| Score vs reference, median | 92.6 % | 92.6 % |
| Runs reaching 95 % of the reference | 0 % | 0 % |
| Expected evaluations to 95 % [95 % interval] | – [–, –] | – [–, –] |
| Median evaluations / seconds to 95 % | – / – | – / – |
| Anytime score (area under the success curve) | 0.443 | 0.439 |
| Own archive filled | 100 % | 100 % |
| Safety violations | 0 | 0 |
| Evaluations per run, median | 2681 | 2545 |
| Wall time per run, median (s) | 0.1 | 0.1 |

| Problem | Pairs | Lex-success (previous planner / shipped planner (previous search proposes the hardest plan, new ladder)) | Goal-1 regret, median (previous planner / shipped planner (previous search proposes the hardest plan, new ladder)) | p (corrected) | Â₁₂ |
|---|---|---|---|---|---|
| s100 | 31 | 0 % / 0 % | 0.105 / 0.104 units | 0.118 | 0.77 |
| s200 | 31 | 0 % / 0 % | 0.128 / 0.128 units | 0.511 | 0.64 |
| s200-beyond-cap | 31 | 0 % / 0 % | 0.101 / 0.101 units | < 0.001 | 0.97 |
| s400 | 31 | 0 % / 0 % | 0.131 / 0.114 units | 0.001 | 0.85 |
| s400-beyond-cap | 31 | 0 % / 0 % | 0.121 / 0.121 units | 0.511 | 0.57 |
| s50 | 31 | 0 % / 0 % | 0.111 / 0.111 units | 0.037 | 0.76 |

### Effort-attainment frontier

6 problem(s).

| Measure | previous planner | shipped planner (previous search proposes the hardest plan, new ladder) |
|---|---|---|
| Runs (failed) | 186 (0) | 186 (0) |
| Lex-success | 100 % | 100 % |
| Lex-success, median over problems | 100 % | 100 % |
| Goal-1 regret, median [95 % interval] | 0.00 % [0.00, 0.00] | 0.00 % [0.00, 0.00] |
| Score vs reference, median | 100.0 % | 100.0 % |
| Runs reaching 95 % of the reference | 100 % | 100 % |
| Expected evaluations to 95 % [95 % interval] | 153 [133, 174] | 153 [133, 174] |
| Median evaluations / seconds to 95 % | 106 / 0.1 | 106 / 0.1 |
| Anytime score (area under the success curve) | 0.703 | 0.718 |
| Ladder area of returned plans | 0.085 | 0.401 |
| … as share of the ideal ladder | 17 % | 91 % |
| Ladder area of every plan seen | 0.545 | 0.549 |
| Distance to the best frontier known | 0.024 | 0.021 |
| Ladders distinct and ordered | 0 % | 12 % |
| Order violations per run | 0.60 | 0.00 |
| Plans returned per run | 2.97 | 2.89 |
| Quality-diversity score / coverage of what was seen | 0.363 / 97 % | 0.371 / 98 % |
| Own archive filled | 98 % | 80 % |
| Safety violations | 0 | 0 |
| Evaluations per run, median | 2675 | 4333 |
| Wall time per run, median (s) | 0.2 | 0.2 |

| Problem | Pairs | Lex-success (previous planner / shipped planner (previous search proposes the hardest plan, new ladder)) | Goal-1 regret, median (previous planner / shipped planner (previous search proposes the hardest plan, new ladder)) | p (corrected) | Â₁₂ |
|---|---|---|---|---|---|
| concave-10 | 31 | 100 % / 100 % | 0.000 / 0.000 units | 1.000 | 0.50 |
| concave-5 | 31 | 100 % / 100 % | 0.000 / 0.000 units | 1.000 | 0.52 |
| convex-10 | 31 | 100 % / 100 % | 0.000 / 0.000 units | 1.000 | 0.50 |
| convex-5 | 31 | 100 % / 100 % | 0.000 / 0.000 units | 1.000 | 0.50 |
| disconnected-10 | 31 | 100 % / 100 % | 0.000 / 0.000 units | < 0.001 | 0.73 |
| disconnected-5 | 31 | 100 % / 100 % | 0.000 / 0.000 units | < 0.001 | 0.94 |

### Uncertain physiology

4 problem(s).

| Measure | previous planner | shipped planner (previous search proposes the hardest plan, new ladder) |
|---|---|---|
| Runs (failed) | 124 (0) | 124 (0) |
| Lex-success | 50 % | 92 % |
| Lex-success, median over problems | 53 % | 94 % |
| Goal-1 regret, median [95 % interval] | 0.54 % [0.17, 8.26] | 0.07 % [0.05, 0.10] |
| Score vs reference, median | 99.8 % | 99.6 % |
| Runs reaching 95 % of the reference | 95 % | 100 % |
| Expected evaluations to 95 % [95 % interval] | 466 [345, 613] | 387 [330, 449] |
| Median evaluations / seconds to 95 % | 230 / 0.2 | 300 / 0.2 |
| Anytime score (area under the success curve) | 0.596 | 0.607 |
| Own archive filled | 70 % | 92 % |
| Goal 1: chosen-on vs independent draws (gap) | -0.000 | 0.000 |
| Runs whose plans keep every limit in ≥ 90 % of draws | 90 % (lowest 85.0 %) | 92 % (lowest 79.0 %) |
| Chance of keeping the limits (10,000 draws), median | 99.0 % | 100.0 % |
| Safety violations | 0 | 0 |
| Evaluations per run, median | 2993 | 2973 |
| Wall time per run, median (s) | 0.2 | 0.2 |

| Problem | Pairs | Lex-success (previous planner / shipped planner (previous search proposes the hardest plan, new ladder)) | Goal-1 regret, median (previous planner / shipped planner (previous search proposes the hardest plan, new ladder)) | p (corrected) | Â₁₂ |
|---|---|---|---|---|---|
| k2-s4 | 31 | 52 % / 94 % | 0.202 / 0.101 units | 0.124 | 0.59 |
| k2-s8 | 31 | 65 % / 94 % | 0.304 / 0.122 units | 0.196 | 0.33 |
| k3-s4 | 31 | 55 % / 84 % | 0.286 / 0.206 units | < 0.001 | 0.21 |
| k3-s8 | 31 | 29 % / 97 % | 30.717 / 0.200 units | 0.217 | 0.40 |

## Method

Seeds are paired: a seed fixes the random draws of both planners (common random numbers). Per problem the planners are compared with the paired Wilcoxon signed-rank test (exact up to 60 pairs) on the score of the first plan relative to the reference, corrected for the number of problems (Holm); suites are compared the same way over all pairs and corrected for the number of suites. Effect sizes are Vargha-Delaney Â₁₂ (0.56 small, 0.64 medium, 0.71 large). Intervals are percentile bootstrap intervals with 10,000 resamples. Constants are tuned only on the tuning split; the verdict comes from the held-out split. Both planners get the same tier budget; on problems with a plan ladder (the frontier suite and the real-engine suites) the new planner keeps its share for the Ideal plan (13 % on tier S) out of the search, as it does in the app, so it searches with fewer evaluations there.

Machine: AMD Ryzen 9 5950X 16-Core Processor, 32 cores, 63 GB, Node v26.11.1; 18 evaluation threads running the app's own worker code, 6 runs at a time; load average at the start 18.4 / 16.6 / 17.9. Duration 41.0 min.

Notes:

- 60 request/seed pair(s) were blocked by the safety screen and skipped.

