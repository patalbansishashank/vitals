# Work-package brief for engine module engineers (read before your WP section)

You implement one work package (WP) of `docs/MODEL_SPEC.md` §11.3. Many engineers work in parallel; the only thing
keeping the engine coherent is that everyone follows the spec and stays inside their own paths.

## Read, in this order
1. `docs/MODEL_SPEC.md` §0 (conventions), your module section(s) in §1, the rows of §2 (ownership + rulings) that
   mention your module, §3 (evaluation order), the §4 signal rows you read or write, §6 for the metrics you record,
   §7 for events you emit, §9 for your validation targets, and `docs/MODEL_SPEC_REVIEW.md` if present (items for your
   module marked APPLIED or decided).
2. The dossier sections your spec section cites (`research/NN-*.md`) — the spec is normative for structure and
   rulings; the dossier is the source for equations, parameter values, ranges, grades and validation numbers.
3. `src/engine/types/**` (contracts), `src/engine/core/moduleKit.ts` and `src/engine/core/loop.ts` (how modules are
   called), your stub `src/engine/model/<module>/index.ts`, and one finished module if any exists.

## Rules
- **Own only your paths.** Never edit `src/engine/types/**`, `src/engine/core/**`, another module, or the spec. If
  you need a contract change (new signal, new input field, changed unit), do not make it: finish everything else,
  and list the request precisely in your final reply under "CONTRACT REQUESTS".
- Read other modules' outputs only through the `SignalBus` fields the spec lists for you. Until those modules exist
  their signals hold the safe defaults written by the stubs — your unit tests must therefore drive your module
  directly with hand-built bus/input values, not through the full loop.
- Every constant is a `ParamDef` in your module's `params` (id, value, unit, low, high, grade, source = author year +
  PMID/DOI, dossier §, status verified | proposed-fit | unverified). Copy numbers exactly from the dossier/spec.
  Never invent a value; if the spec and dossier disagree, follow the spec and report it.
- Hot path: no allocation inside `stepHour` / `endOfDay` / `record`; precompute `exp(-dt/τ)` factors in `init`;
  plain numbers; no closures created per step; no `Math.random`, no `Date`, no DOM. Clamp stores at their physical
  bounds; never produce NaN/Infinity (add a dev-only assert helper if the kit offers one).
- Units exactly as the spec states for each state and signal; put the unit in a doc comment on every field.
- Keep the exported state interface name of the stub; extend its fields freely.
- Tests (Vitest, colocated in your folder): every validation target the spec assigns to your WP with the stated
  tolerance; unit tests of each equation against worked numbers from the dossier; property tests (bounds,
  monotonicity, steady state at maintenance stays steady for 30 simulated days, zero-intake for 21 days stays finite).
  A target you cannot meet stays in the suite as `it.fails` with a comment and is reported — never loosen silently.
- Performance: your module's cost over a 180-day run must stay within the budget in the WP table (default 0.5 ms).
  Measure with a micro-benchmark test in your folder and report the number.

## Verify before you finish
`pnpm exec tsc -b --noEmit` (no errors in your paths), `pnpm exec eslint <your paths>`, `pnpm vitest run <your paths>`.
Other engineers' folders may be temporarily red; report but ignore errors that are clearly theirs.

## Final reply (≤ 25 lines)
What you implemented (state, signals written, metrics recorded), test results with counts, each validation target
met / missed (with numbers), measured ms per 180-day run, CONTRACT REQUESTS, spec/dossier discrepancies found, and
calibration items you believe the integration pass must revisit.
