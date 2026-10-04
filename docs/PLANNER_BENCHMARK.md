# Planner benchmark

*Run 12a91nw of 2026-10-01; engine 1.0.0-contract, parameter set 3b70e02c, plan library 1.*

The planner searches for the plan that best serves your goals in priority order within your limits and the safety rules. This report measures how close its plans come to the best plan, how fast it gets there, and how well its easier and harder plans cover the trade-off between effort and result. Each problem is solved many times with different random seeds; the previous planner and the combined planner (previous search for the hardest plan, new ladder) get the same problems, the same evaluations and the same random draws, so their results can be compared run by run.

## What is shown and what is not

- On small real plan spaces (each searched exhaustively, every plan simulated), the plan returned first was within half the priority tolerance of the best plan on every goal in 68 % of runs; its median shortfall on goal 1 was 0.00 % of what goal 1 can gain in that space.
- On problems with planted priorities and a known best plan, the returned plan met every priority within half its tolerance in 95 % of runs.
- When the best plan hides in one plan shape among 50-400, the search found it (within tolerance) in 0 % of runs.
- On frontiers with a known shape, the returned plans covered a median 70 % of the area the ideal three-plan ladder covers.
- Under uncertain physiology, returned plans kept their limits in a median 99.0 % of 10,000 draws.
- No returned plan broke a safety limit or failed the independent plan check.
- On those small spaces the exhaustive best plan by the nominal model kept every safety limit in at least 90 % of 256 draws of the model's uncertain parameters in 6 of 6 spaces; among the 50 best plans, the best one that did was ranked 4, 2, 1, 37, 29, 9 by the nominal search. The full planner checks every returned plan this way before returning it.

Not shown by this benchmark:

- That plans are the best possible for full requests: there the reference is the best plan any run of the benchmark returned, not an exhaustive search.
- That the model of the body is right: every result here is measured inside the model. How the model compares with published studies is in the validation report.
- Wall times on other devices: they were measured on one machine shared with other work, so they are indicative only; evaluation counts are the stable cost measure.

## Headline results

Tier S, holdout split. "Better" needs a paired test below 0.05 after correcting for the number of suites and an effect size Â₁₂ of at least 0.56.

| Suite | Measure | previous planner | combined planner (previous search for the hardest plan, new ladder) | Difference | p (corrected) | Â₁₂ | Verdict |
|---|---|---|---|---|---|---|---|
| Full requests | lex-success (% of runs) | 27.1 | 28.7 | 1.7 | 1.000 | 0.51 (negligible) | no difference |
| Full requests | goal-1 regret (% of goal 1 range (median)) | 2.0 | 1.9 | -0.1 | 0.326 | 0.50 (negligible) | no difference |
| Full requests | time to 95 % (EU (expected running time)) | 1981 | 2221 | 240 | 0.033 | 0.48 (negligible) | no difference |
| Full requests | ladder hypervolume (returned plans (median)) | 0.498 | 0.591 | 0.093 | < 0.001 | 0.58 (small) | better |
| Small real plan spaces (exhaustive search) | lex-success (% of runs) | 66.7 | 68.3 | 1.6 | 1.000 | 0.51 (negligible) | no difference |
| Small real plan spaces (exhaustive search) | goal-1 regret (% of goal 1 range (median)) | 0.0 | 0.0 | 0.0 | 0.193 | 0.52 (negligible) | no difference |
| Small real plan spaces (exhaustive search) | time to 95 % (EU (expected running time)) | 118 | 125 | 7 | 1.000 | 0.50 (negligible) | no difference |
| Small real plan spaces (exhaustive search) | ladder hypervolume (returned plans (median)) | 0.408 | 0.401 | -0.007 | < 0.001 | 0.56 (small) | better |
| Continuous test functions | lex-success (% of runs) | 76.1 | 78.0 | 1.9 | 0.461 | 0.51 (negligible) | no difference |
| Continuous test functions | goal-1 regret (% of goal 1 range (median)) | 0.2 | 0.1 | -0.1 | < 0.001 | 0.64 (small) | better |
| Continuous test functions | time to 95 % (EU (expected running time)) | 886 | 751 | -135 | 0.027 | 0.49 (negligible) | no difference |
| Planted priorities | lex-success (% of runs) | 56.5 | 94.6 | 38.2 | < 0.001 | 0.69 (medium) | better |
| Planted priorities | goal-1 regret (% of goal 1 range (median)) | 0.4 | 0.1 | -0.3 | < 0.001 | 0.69 (medium) | better |
| Planted priorities | time to 95 % (EU (expected running time)) | 677 | 499 | -178 | 1.000 | 0.48 (negligible) | no difference |
| Needle among many plan shapes | lex-success (% of runs) | 0.0 | 0.0 | 0.0 | 1.000 | 0.50 (negligible) | no difference |
| Needle among many plan shapes | goal-1 regret (% of goal 1 range (median)) | 7.4 | 7.4 | -0.1 | < 0.001 | 0.58 (small) | better |
| Needle among many plan shapes | time to 95 % (EU (expected running time)) | – | – | – | 1.000 | 0.50 (negligible) | no difference |
| Effort-attainment frontier | lex-success (% of runs) | 100.0 | 100.0 | 0.0 | 1.000 | 0.50 (negligible) | no difference |
| Effort-attainment frontier | goal-1 regret (% of goal 1 range (median)) | 0.0 | 0.0 | 0.0 | 1.000 | 0.50 (negligible) | no difference |
| Effort-attainment frontier | time to 95 % (EU (expected running time)) | 153 | 153 | 0 | 1.000 | 0.50 (negligible) | no difference |
| Effort-attainment frontier | ladder hypervolume (returned plans (median)) | 0.085 | 0.276 | 0.192 | < 0.001 | 0.72 (large) | better |
| Uncertain physiology | lex-success (% of runs) | 50.0 | 88.7 | 38.7 | < 0.001 | 0.69 (medium) | better |
| Uncertain physiology | goal-1 regret (% of goal 1 range (median)) | 0.5 | 0.1 | -0.5 | < 0.001 | 0.73 (large) | better |
| Uncertain physiology | time to 95 % (EU (expected running time)) | 466 | 387 | -78 | 0.840 | 0.48 (negligible) | no difference |

## Acceptance gate

A new planner is accepted only if, on every suite, it is not worse by more than 2 points of lex-success and 1 % of goal 1 range in regret (one-sided, 95 % bootstrap bounds over paired runs), and it is better on at least one suite or equally good at least 20 % faster.

**Verdict: the combined planner (previous search for the hardest plan, new ladder) passes: non-inferior on every suite; better on T1, T3.**

| Suite | Pairs | Lex-success change (lower bound) | Regret change (upper bound) | Not worse | p (corrected) | Â₁₂ | Wall-time ratio | Better |
|---|---|---|---|---|---|---|---|---|
| Full requests | 240 | 1.7 (0.0) | 0.08 (0.29) | yes | 1.000 | 0.49 | 1.48 | no |
| Small real plan spaces (exhaustive search) | 186 | 1.6 (0.5) | -0.02 (0.04) | yes | 0.283 | 0.54 | 1.62 | no |
| Continuous test functions | 372 | 1.9 (0.5) | -1.30 (-1.11) | yes | < 0.001 | 0.64 | 0.98 | yes |
| Planted priorities | 186 | 38.2 (32.3) | -4.66 (-4.03) | yes | 1.000 | 0.49 | 0.98 | no |
| Needle among many plan shapes | 186 | 0.0 (0.0) | -0.08 (0.02) | yes | < 0.001 | 0.58 | 0.98 | yes |
| Effort-attainment frontier | 186 | 0.0 (0.0) | 0.00 (0.00) | yes | 1.000 | 0.50 | 1.18 | no |
| Uncertain physiology | 124 | 38.7 (30.6) | -4.84 (-4.01) | yes | 1.000 | 0.47 | 1.01 | no |

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

16 problem(s).

| Measure | previous planner | combined planner (previous search for the hardest plan, new ladder) |
|---|---|---|
| Runs (failed) | 240 (0) | 240 (0) |
| Lex-success | 27 % | 29 % |
| Lex-success, median over problems | 17 % | 23 % |
| Goal-1 regret, median [95 % interval] | 1.95 % [1.32, 2.72] | 1.86 % [1.32, 2.55] |
| Score vs reference, median | 94.7 % | 94.7 % |
| Runs reaching 95 % of the reference | 73 % | 79 % |
| Expected evaluations to 95 % [95 % interval] | 1981 [1682, 2332] | 2221 [1883, 2622] |
| Median evaluations / seconds to 95 % | 788 / 5.5 | 987 / 6.1 |
| Anytime score (area under the success curve) | 0.451 | 0.502 |
| Ladder area of returned plans | 0.498 | 0.591 |
| Ladder area of every plan seen | 0.753 | 0.784 |
| Distance to the best frontier known | 0.038 | 0.022 |
| Ladders distinct and ordered | 1 % | 62 % |
| Order violations per run | 1.15 | 0.00 |
| Plans returned per run | 2.63 | 1.63 |
| Own archive filled | 28 % | 30 % |
| Goal 1: chosen-on vs independent draws (gap) | -0.001 | -0.001 |
| Runs whose plans keep every limit in ≥ 90 % of draws | 92 % (lowest 77.3 %) | 96 % (lowest 82.4 %) |
| Fasting-served requests: a plan fasts or a fasting plan was compared | 100 % | 100 % |
| Safety violations | 0 | 0 |
| Evaluations per run, median | 2824 | 4035 |
| Wall time per run, median (s) | 18.6 | 27.9 |

| Problem | Pairs | Lex-success (previous planner / combined planner (previous search for the hardest plan, new ladder)) | Goal-1 regret, median (previous planner / combined planner (previous search for the hardest plan, new ladder)) | p (corrected) | Â₁₂ |
|---|---|---|---|---|---|
| a | 15 | 7 % / 7 % | 0.434 / 0.434 kg | 1.000 | 0.49 |
| af | 15 | 27 % / 27 % | 2.523 / 2.545 index | 1.000 | 0.47 |
| b | 15 | 0 % / 0 % | -0.039 / -0.039 kg | 1.000 | 0.52 |
| c | 15 | 7 % / 13 % | 0.052 / 0.062 kg | 1.000 | 0.50 |
| d | 15 | 33 % / 33 % | 0.100 / 0.100 kg | 1.000 | 0.53 |
| e | 15 | 13 % / 13 % | 0.047 / 0.046 kg | 1.000 | 0.52 |
| fuzz10 | 15 | 7 % / 27 % | 0.002 / 0.000 kg | 1.000 | 0.45 |
| fuzz11 | 15 | 20 % / 20 % | 0.000 / 0.000 mL/kg/min | 1.000 | 0.53 |
| fuzz12 | 15 | 7 % / 7 % | 0.024 / 0.024 mmol/L | 1.000 | 0.51 |
| fuzz13 | 15 | 33 % / 33 % | 0.063 / 0.063 kg | 1.000 | 0.48 |
| fuzz14 | 15 | 93 % / 93 % | 0.000 / 0.000 kg | 1.000 | 0.50 |
| fuzz15 | 15 | 7 % / 0 % | 0.226 / 0.218 kg | 1.000 | 0.43 |
| fuzz16 | 15 | 13 % / 7 % | 0.212 / 0.239 kg | 1.000 | 0.48 |
| fuzz17 | 15 | 53 % / 60 % | 0.161 / 0.150 kg | 1.000 | 0.51 |
| fuzz18 | 15 | 20 % / 27 % | 0.080 / 0.074 kg | 1.000 | 0.52 |
| fuzz19 | 15 | 93 % / 93 % | 0.020 / 0.020 kg | 1.000 | 0.50 |

### Small real plan spaces (exhaustive search)

6 problem(s).

| Measure | previous planner | combined planner (previous search for the hardest plan, new ladder) |
|---|---|---|
| Runs (failed) | 186 (0) | 186 (0) |
| Lex-success | 67 % | 68 % |
| Lex-success, median over problems | 89 % | 94 % |
| Goal-1 regret, median [95 % interval] | 0.00 % [0.00, 0.00] | 0.00 % [0.00, 0.00] |
| Score vs reference, median | 99.5 % | 100.0 % |
| Runs reaching 95 % of the reference | 99 % | 99 % |
| Expected evaluations to 95 % [95 % interval] | 118 [76, 174] | 125 [76, 193] |
| Median evaluations / seconds to 95 % | 17 / 0.3 | 17 / 0.3 |
| Anytime score (area under the success curve) | 0.851 | 0.859 |
| Ladder area of returned plans | 0.408 | 0.401 |
| Ladder area of every plan seen | 0.561 | 0.584 |
| Distance to the best frontier known | 0.017 | 0.009 |
| Ladders distinct and ordered | 3 % | 46 % |
| Order violations per run | 0.38 | 0.00 |
| Plans returned per run | 1.95 | 1.47 |
| Own archive filled | 11 % | 13 % |
| Safety violations | 0 | 0 |
| Evaluations per run, median | 2684 | 3897 |
| Wall time per run, median (s) | 17.0 | 27.7 |

| Problem | Pairs | Lex-success (previous planner / combined planner (previous search for the hardest plan, new ladder)) | Goal-1 regret, median (previous planner / combined planner (previous search for the hardest plan, new ladder)) | p (corrected) | Â₁₂ |
|---|---|---|---|---|---|
| a | 31 | 77 % / 87 % | -0.004 / -0.004 kg | 0.292 | 0.54 |
| af | 31 | 100 % / 100 % | 0.000 / 0.000 index | 0.039 | 0.63 |
| b | 31 | 0 % / 0 % | -0.071 / -0.071 kg | 0.062 | 0.44 |
| c | 31 | 23 % / 23 % | 0.403 / 0.402 kg | 0.270 | 0.42 |
| d | 31 | 100 % / 100 % | 0.000 / 0.000 kg | 0.292 | 0.55 |
| e | 31 | 100 % / 100 % | 0.001 / 0.000 kg | < 0.001 | 0.84 |

### Continuous test functions

12 problem(s).

| Measure | previous planner | combined planner (previous search for the hardest plan, new ladder) |
|---|---|---|
| Runs (failed) | 372 (0) | 372 (0) |
| Lex-success | 76 % | 78 % |
| Lex-success, median over problems | 100 % | 100 % |
| Goal-1 regret, median [95 % interval] | 0.18 % [0.15, 0.22] | 0.09 % [0.04, 0.11] |
| Score vs reference, median | 99.8 % | 99.9 % |
| Runs reaching 95 % of the reference | 79 % | 84 % |
| Expected evaluations to 95 % [95 % interval] | 886 [715, 1078] | 751 [621, 908] |
| Median evaluations / seconds to 95 % | 107 / 0.1 | 130 / 0.1 |
| Anytime score (area under the success curve) | 0.641 | 0.641 |
| Own archive filled | 100 % | 100 % |
| Safety violations | 0 | 0 |
| Evaluations per run, median | 2670 | 2550 |
| Wall time per run, median (s) | 0.2 | 0.2 |

| Problem | Pairs | Lex-success (previous planner / combined planner (previous search for the hardest plan, new ladder)) | Goal-1 regret, median (previous planner / combined planner (previous search for the hardest plan, new ladder)) | p (corrected) | Â₁₂ |
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

| Measure | previous planner | combined planner (previous search for the hardest plan, new ladder) |
|---|---|---|
| Runs (failed) | 186 (0) | 186 (0) |
| Lex-success | 56 % | 95 % |
| Lex-success, median over problems | 60 % | 95 % |
| Goal-1 regret, median [95 % interval] | 0.39 % [0.16, 3.78] | 0.06 % [0.05, 0.09] |
| Score vs reference, median | 99.6 % | 99.6 % |
| Runs reaching 95 % of the reference | 90 % | 100 % |
| Expected evaluations to 95 % [95 % interval] | 677 [540, 837] | 499 [446, 555] |
| Median evaluations / seconds to 95 % | 289 / 0.2 | 392 / 0.2 |
| Anytime score (area under the success curve) | 0.598 | 0.596 |
| Own archive filled | 72 % | 95 % |
| Safety violations | 0 | 0 |
| Evaluations per run, median | 2671 | 2545 |
| Wall time per run, median (s) | 0.2 | 0.2 |

| Problem | Pairs | Lex-success (previous planner / combined planner (previous search for the hardest plan, new ladder)) | Goal-1 regret, median (previous planner / combined planner (previous search for the hardest plan, new ladder)) | p (corrected) | Â₁₂ |
|---|---|---|---|---|---|
| k2-s4 | 31 | 48 % / 100 % | 16.202 / 0.057 units | < 0.001 | 0.80 |
| k2-s8 | 31 | 71 % / 100 % | 0.396 / 0.113 units | 1.000 | 0.45 |
| k3-s4 | 31 | 77 % / 100 % | 0.421 / 0.336 units | 1.000 | 0.45 |
| k3-s8 | 31 | 16 % / 90 % | 9.679 / 0.161 units | 0.007 | 0.65 |
| k4-s4 | 31 | 39 % / 87 % | 11.219 / 0.256 units | < 0.001 | 0.17 |
| k4-s8 | 31 | 87 % / 90 % | 0.852 / 0.381 units | 0.208 | 0.35 |

### Needle among many plan shapes

6 problem(s).

| Measure | previous planner | combined planner (previous search for the hardest plan, new ladder) |
|---|---|---|
| Runs (failed) | 186 (0) | 186 (0) |
| Lex-success | 0 % | 0 % |
| Lex-success, median over problems | 0 % | 0 % |
| Goal-1 regret, median [95 % interval] | 7.45 % [7.39, 8.09] | 7.38 % [7.13, 7.39] |
| Score vs reference, median | 92.6 % | 92.6 % |
| Runs reaching 95 % of the reference | 0 % | 0 % |
| Expected evaluations to 95 % [95 % interval] | – [–, –] | – [–, –] |
| Median evaluations / seconds to 95 % | – / – | – / – |
| Anytime score (area under the success curve) | 0.443 | 0.439 |
| Own archive filled | 100 % | 100 % |
| Safety violations | 0 | 0 |
| Evaluations per run, median | 2681 | 2545 |
| Wall time per run, median (s) | 0.2 | 0.1 |

| Problem | Pairs | Lex-success (previous planner / combined planner (previous search for the hardest plan, new ladder)) | Goal-1 regret, median (previous planner / combined planner (previous search for the hardest plan, new ladder)) | p (corrected) | Â₁₂ |
|---|---|---|---|---|---|
| s100 | 31 | 0 % / 0 % | 0.105 / 0.104 units | 0.118 | 0.77 |
| s200 | 31 | 0 % / 0 % | 0.128 / 0.128 units | 0.511 | 0.64 |
| s200-beyond-cap | 31 | 0 % / 0 % | 0.101 / 0.101 units | < 0.001 | 0.97 |
| s400 | 31 | 0 % / 0 % | 0.131 / 0.114 units | 0.001 | 0.85 |
| s400-beyond-cap | 31 | 0 % / 0 % | 0.121 / 0.121 units | 0.511 | 0.57 |
| s50 | 31 | 0 % / 0 % | 0.111 / 0.111 units | 0.037 | 0.76 |

### Effort-attainment frontier

6 problem(s).

| Measure | previous planner | combined planner (previous search for the hardest plan, new ladder) |
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
| Ladder area of returned plans | 0.085 | 0.276 |
| … as share of the ideal ladder | 17 % | 70 % |
| Ladder area of every plan seen | 0.545 | 0.547 |
| Distance to the best frontier known | 0.024 | 0.021 |
| Ladders distinct and ordered | 0 % | 47 % |
| Order violations per run | 0.60 | 0.00 |
| Plans returned per run | 2.97 | 1.61 |
| Quality-diversity score / coverage of what was seen | 0.363 / 97 % | 0.369 / 98 % |
| Own archive filled | 98 % | 77 % |
| Safety violations | 0 | 0 |
| Evaluations per run, median | 2675 | 3889 |
| Wall time per run, median (s) | 0.2 | 0.2 |

| Problem | Pairs | Lex-success (previous planner / combined planner (previous search for the hardest plan, new ladder)) | Goal-1 regret, median (previous planner / combined planner (previous search for the hardest plan, new ladder)) | p (corrected) | Â₁₂ |
|---|---|---|---|---|---|
| concave-10 | 31 | 100 % / 100 % | 0.000 / 0.000 units | 1.000 | 0.50 |
| concave-5 | 31 | 100 % / 100 % | 0.000 / 0.000 units | 1.000 | 0.50 |
| convex-10 | 31 | 100 % / 100 % | 0.000 / 0.000 units | 1.000 | 0.50 |
| convex-5 | 31 | 100 % / 100 % | 0.000 / 0.000 units | 1.000 | 0.50 |
| disconnected-10 | 31 | 100 % / 100 % | 0.000 / 0.000 units | 1.000 | 0.50 |
| disconnected-5 | 31 | 100 % / 100 % | 0.000 / 0.000 units | 1.000 | 0.50 |

### Uncertain physiology

4 problem(s).

| Measure | previous planner | combined planner (previous search for the hardest plan, new ladder) |
|---|---|---|
| Runs (failed) | 124 (0) | 124 (0) |
| Lex-success | 50 % | 89 % |
| Lex-success, median over problems | 53 % | 89 % |
| Goal-1 regret, median [95 % interval] | 0.54 % [0.17, 8.26] | 0.06 % [0.05, 0.09] |
| Score vs reference, median | 99.8 % | 99.7 % |
| Runs reaching 95 % of the reference | 95 % | 100 % |
| Expected evaluations to 95 % [95 % interval] | 466 [348, 613] | 387 [330, 450] |
| Median evaluations / seconds to 95 % | 230 / 0.2 | 300 / 0.2 |
| Anytime score (area under the success curve) | 0.596 | 0.607 |
| Own archive filled | 70 % | 92 % |
| Goal 1: chosen-on vs independent draws (gap) | -0.000 | 0.000 |
| Runs whose plans keep every limit in ≥ 90 % of draws | 90 % (lowest 85.0 %) | 69 % (lowest 63.0 %) |
| Chance of keeping the limits (10,000 draws), median | 99.0 % | 99.0 % |
| Safety violations | 0 | 0 |
| Evaluations per run, median | 2993 | 2973 |
| Wall time per run, median (s) | 0.2 | 0.2 |

| Problem | Pairs | Lex-success (previous planner / combined planner (previous search for the hardest plan, new ladder)) | Goal-1 regret, median (previous planner / combined planner (previous search for the hardest plan, new ladder)) | p (corrected) | Â₁₂ |
|---|---|---|---|---|---|
| k2-s4 | 31 | 52 % / 90 % | 0.202 / 0.094 units | 0.024 | 0.71 |
| k2-s8 | 31 | 65 % / 90 % | 0.304 / 0.122 units | 0.714 | 0.47 |
| k3-s4 | 31 | 55 % / 87 % | 0.286 / 0.140 units | < 0.001 | 0.28 |
| k3-s8 | 31 | 29 % / 87 % | 30.717 / 0.162 units | 0.714 | 0.46 |

## Speed of a full planner run

Each row is one complete run as the app makes it, timed alone on 8 evaluation threads. The full app run is the shipped planner (combined search) with the plan ladder, the Ideal plan with what each limit costs, and time to target; the previous planner row is its search alone on the same problem (its explanation and time-to-target steps no longer exist and are not timed). Tier X was given a 32k-evaluation budget here; in the app it is open-ended.

| Request | Tier | Planner | Wall time (s) | Evaluations used / budget | Plans | Ideal, limit costs | Status |
|---|---|---|---|---|---|---|---|
| reference request a | S | full app run | 13.3 | 4,186 / 4,500 | 2 | yes, 3 | ok |
| reference request a | S | previous planner | 5.7 | 2,832 / 3,000 | 2 | – | ok |
| reference request a | M | full app run | 31.2 | 16,760 / 18,000 | 2 | yes, 3 | ok |
| reference request a | M | previous planner | 17.8 | 11,046 / 12,000 | 3 | – | ok |
| reference request a | L | full app run | 91.9 | 55,356 / 60,000 | 2 | yes, 3 | ok |
| reference request a | L | previous planner | 55.6 | 36,188 / 40,000 | 3 | – | ok |
| reference request a | X | full app run | 47.5 | 28,932 / 32,100 | 1 | yes, 3 | ok |
| reference request b | S | full app run | 11.8 | 4,093 / 4,500 | 1 | yes, 4 | ok |
| reference request b | S | previous planner | 6.0 | 2,810 / 3,000 | 3 | – | ok |
| reference request b | M | full app run | 34.3 | 16,488 / 18,000 | 1 | yes, 3 | ok |
| reference request b | M | previous planner | 19.8 | 11,003 / 12,000 | 3 | – | ok |
| reference request b | L | full app run | 101.2 | 55,068 / 60,000 | 1 | yes, 1 | ok |
| reference request b | L | previous planner | 61.8 | 36,289 / 40,000 | 3 | – | ok |
| reference request b | X | full app run | 51.6 | 27,652 / 32,100 | 1 | yes, 3 | ok |

## How the shipped planner was chosen

All runs on the held-out problems (tier S; 31 seeds per synthetic problem and small real space, 15 per full request), each
against the previous planner on the same problems, evaluations and random draws. The acceptance rule never changed.

| Run | Candidate | Full requests: lex-success (previous → candidate) | Full requests: goal-1 regret, mean change and its upper bound (margin 1 point) | Verdict |
|---|---|---|---|---|
| abbsm4 | new planner alone | 23.8 % → 15.4 % | +2.7 points (upper 3.3) | not shown to be non-inferior on full requests; better ladders on the small real spaces and frontier problems |
| 18qebli | combined planner, same total budget (previous search on part of it) | 24.2 % → 19.2 % | +2.2 points | not shown to be non-inferior on full requests, small real spaces and frontiers |
| h895wg, jmt5h, 1imbir4 | combined planner, previous search on its full budget, new ladder on top | 27.1 % → 28.3-28.8 % | +2.8 to +3.2 points | not non-inferior: in 7 of 240 full requests the ladder step returned no plan |
| 12a91nw | the same, falling back to the new planner alone when the ladder step returns no plan | 27.1 % → 28.8 % | +0.1 points (upper 0.3) | **passes**: non-inferior on every suite, better on two |

The app therefore uses the combined planner: the previous search picks the hardest plan, the new search builds the easier
plans, the plan with your limits removed, and what each limit costs. It spends about a third more evaluations than the
previous planner alone (the speed table above). The new planner alone remains available for development. In this report
the full requests come from run 12a91nw; the other suites and the speed table come from run h895wg, which used the same
combined planner before its last two corrections (they only change which plan is kept as the hardest one and what
happens when the ladder step returns nothing).

## Method

Seeds are paired: a seed fixes the random draws of both planners (common random numbers). Per problem the planners are compared with the paired Wilcoxon signed-rank test (exact up to 60 pairs) on the score of the first plan relative to the reference, corrected for the number of problems (Holm); suites are compared the same way over all pairs and corrected for the number of suites. Effect sizes are Vargha-Delaney Â₁₂ (0.56 small, 0.64 medium, 0.71 large). Intervals are percentile bootstrap intervals with 10,000 resamples. Constants are tuned only on the tuning split; the verdict comes from the held-out split. Both planners get the same tier budget; on problems with a plan ladder (the frontier suite and the real-engine suites) the new planner keeps its share for the Ideal plan (13 % on tier S) out of the search, as it does in the app, so it searches with fewer evaluations there.

Machine: AMD Ryzen 9 5950X 16-Core Processor, 32 cores, 63 GB, Node v26.10.0; 18 evaluation threads running the app's own worker code, 6 runs at a time; load average at the start 23.3 / 22.6 / 22.2. Duration 32.8 min.

