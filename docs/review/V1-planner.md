# V1b review: planner (pass 1)

Area: `src/engine/planner/**` (domain, optim, audit), reference docs/PLANNER_V2_SPEC.md (§1.3, §7, §12). Branch `wp/V1b`,
2026-10-03. Static reading plus targeted runs; the 40-minute `pnpm audit:planner` was not run (no fix touches search code).

## Findings

| ID | Severity | File:line | What is wrong | How confirmed | Fix or reason not fixed |
|---|---|---|---|---|---|
| V1b-01 | high | src/engine/planner/domain/safety.ts:201 | The adults-only gate was `age < 18`; an age that is not a number (damaged or imported profile) is not `< 18`, so the planner was not blocked. | Probe: `compileRequest` with `ageYears: NaN` gave `caps.blocked = null`, no problems. | **Fixed**: `!(age >= 18)` fails closed. Test `domain/__tests__/invalidBody.test.ts` (fails before, passes after). |
| V1b-02 | high | src/engine/planner/domain/context.ts:342-346 | Height, weight or body fat that are not numbers gave BMI / body fat NaN; every cap test (`bmi >= 30`, `bmi < 20` no-deficit, body-fat floor +2/+4/+6) is false on NaN, so the deficit and rate protections switched off silently and the planner ran. `weightKg: Infinity` also passed. | Probe: NaN height, NaN weight, NaN known body fat, Infinity weight → `blocked null`, `problems []`. | **Fixed**: the request is `invalid` with "Your height, weight and body fat estimate must be numbers to plan; please check your profile." Same test file (4 cases). Root cause (resolveProfile taking a NaN body fat as given) is engine: see "For other areas". |
| V1b-03 | medium | src/engine/planner/audit/levels.ts:242-256 | §12.6 "cards(X) ⊇ cards(M) ⊇ cards(S)": `monotoneViolations` skipped any pair where the longer tier was not `ok`, so a complete X run that lost Hard (noSafePlan) after M showed a ladder was not flagged. | New unit test in `audit/levels.test.ts` failed before the fix. | **Fixed**: a complete longer run that is not `ok` after an `ok` shorter run is a violation; a stopped one (`complete: false`) is not (§12.1 keeps the shown ladder). The committed coverage report has Hard 17/17/17, so no current cell changes. |
| V1b-04 | medium | src/engine/planner/domain/replan.ts:1316-1320 (with 248-249) | In the last 7 days of a plan, `prepare` extends the horizon to `todayIdx + 7` (§7.2 minimum), and `ok`/`proposal` records come back extended (day 22 → 29 days, … day 27 → 34). An `unchanged` result returns the old record (28 days) while its forecast bands cover the extended N. So the plan length near the end depends on whether the search changed anything; at day 27 an `unchanged` weekly re-plan leaves 1 day of plan and a 7-day forecast. | `replanEveryDay.test.ts` sweep (logged statuses and lengths per day). | Not fixed: whether a living plan should extend itself past `endDate` at all (or end, or ask) is a lifecycle decision (V1c / spec §7.2 owner). Either make `unchanged` also extend (new version each day in the last week) or stop extending and shrink the minimum. |
| V1b-05 | medium | src/engine/planner/optim/pipeline.ts:2997-3030 | A carried Medium is checked without an Easy (`judge(f)` with `E = null`, pairwise rule) and can stand as Hard + Medium with Easy collapsed `infeasible`. Such a Medium meets Easy's goal constraint (0.8·g_H ≥ 0.5·g_H) and is distinct from Hard, so it is itself a feasible Easy; it is not in `easyCands`, so Easy's proof of absence can be wrong. | Reading (no constructed run: needs a previous ladder with Medium where this run finds no Easy). | Not fixed: search code; changing the candidate set needs the 40-minute audit. Fix: add `carriedM` to the Easy candidates (checked with `checkEasy`) before choosing Easy. |
| V1b-06 | low | src/engine/planner/domain/__tests__/replan.fixtures.ts:46-60 | The default fixture plan (first B1 structure at `x0`) breaks energy availability (HC-E4, W-E07) itself, so light/weekly re-plans at 30 EU end `noSafePlan` on days 6, 28 and 35 (and `proposal` most other days). Not a planner bug, but the fixture is a weak "normal plan". | Sweep + diagnostics (`keep.violated`). | Not fixed (test data). The sweep asserts invariants that hold for any status. |
| V1b-07 | low | src/engine/planner/domain/replan.ts:246 | `Math.max(0, dayIndex(...))` with a malformed `req.today` is NaN (Math.max propagates NaN), and the run ends in a `RangeError: Invalid time value` from `dateAt`. | Reading of `dayIndex`/`dateAt` (`sensitivities.ts:66-75`). | Not fixed: callers pass ISO dates from the living layer; an exception is already loud. |
| V1b-08 | low | src/engine/planner/optim/ladder.ts:261-280 | `ladderDistinctness` treats a NaN Gower distance or NaN D gap as passing (all comparisons with NaN are false). | Reading. `features()` (domain/features.ts:185-218) returns means and counts only, so Gower inputs are finite today; not reachable. | Not fixed (not reachable). If a NaN feature is ever added, fail the check on non-finite numbers. |
| V1b-09 | low | src/engine/planner/audit/levels.ts:205-225 | The level audit skips its Easy/Medium checks when a number is not finite (`fin(...)` guards), so a rung with NaN goal-1 or distance would pass as a card. | Reading. | Not fixed: digests come from finite optimiser numbers (r4 rounds NaN to null); listed so pass 2 does not assume the audit catches NaN. |
| V1b-10 | low | src/engine/planner/optim/pipeline.ts:2966-2968, 3001-3003 | `checkEasy`/`checkMedium` put `carriedSafe/Valid/Chance: 0` in the collapse detail of own and search candidates too. | Reading. | Not fixed: harmless, `collapseText` and the audit read those keys only with `detail.carried`. |

## Verified fine

- `stoppedResultWorse` (domain/stoppedLadder.ts): rule order noPlan → fewerRungs → weakerHard (2 % tolerance, sense-adjusted, reached/kept verdicts) → nothingNew matches §12.1; a new rung is never "nothing new".
- Easy search pure parts (optim/easySearch.ts): budget max(6 %, 400 EU), tier X 4 %; bisection ≤ 8 steps keeps the feasible upper end, returns null when α = 1 fails; stop rule (bound, 3 stalled generations) cannot stall before a first finite D; proof `bestG1` is over safe, other-goals-ok points with D ≤ D_H − 0.15.
- §12.8 margins: `mediumMargins` and `ladderDistinctness` use 0.08 / max(0.10, Gower(H,E)/3) with Easy, 0.15 / 0.20 without; Medium repeats Easy's failure with `viaEasy`.
- `kneeOf` guards degenerate spans; `staircase` drops non-finite points.
- `gMinMetric` matches the §1.3 table (strength is "% of baseline", so 5 is 5 %).
- Search termination: S4 emitter loop bounded by `max(used, reqs/3)` even when evaluations are cached (0 EU); CMA job loop by budget and `remaining()`; decode cycle loop advances ≥ 7 days.
- Re-plan on every day index −3 … 35 (light and weekly): no throw, past days unchanged, forecast starts at today, finite outcomes, new records ≥ today + 7 days (`replanEveryDay.test.ts`).
- Dates: `dayIndex`/`dateAt` are UTC calendar arithmetic (no DST drift); the 04:00 rollover is the living layer's (`req.today` comes in as a date).
- Difficulty components: inactive when limit − habit < ε (no division by zero); NaN raw value counts as 0.
- Ideal equals Hard: `hardAsIdeal` sets `nothingBinds: true` with `sameAsHard`; the genome and numbers paths of `idealSameAsHard` imply `nothingBinds` (vsHard within the quantum), so the audit's `sameAsHard ⇒ nothingBinds` check is consistent.
- `checkpointKeyOf` excludes `budget` and `previous` (X resumes a run of the same request).
- Planner hard blocks (minors, pregnancy, type 1 diabetes and listed drugs, screening) are SUITE safety gates, not banned levers; practical limits are relaxed in the Ideal with their costs.

## For other areas

| Area | Pointer | What |
|---|---|---|
| V1a (engine) | src/engine/core/resolveProfile.ts | A `knownBodyFatPct` of NaN is taken as given (body fat NaN) instead of falling back to the estimate; NaN/Infinity height or weight resolve without an error. The planner now refuses such requests (V1b-02), other consumers do not. |
| V1c (living) | replan callers, docs/PLANNER_V2_SPEC.md §7.2 | Decide V1b-04: should re-plans in the last 7 days extend the plan, and should `unchanged` then also extend? |
