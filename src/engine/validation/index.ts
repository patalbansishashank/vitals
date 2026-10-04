/**
 * WP-V validation package (docs/MODEL_SPEC.md §9): independent oracles, reference fixtures, the invariant harness and every
 * end-to-end published-study scenario of §9.2. Test-only code: nothing in the engine, the planner or the UI imports it,
 * except the planner/band work packages that reuse the §9.3 personas and the invariant functions.
 *
 *   oracle/       Hall 2011 / NIDDK Body Weight Planner port (O-1, O-2), 04 §4.11 daily carbohydrate balance (O-3)
 *   fixtures/     §9.3 personas (MAN, WOMAN, LEAN_MAN) and schedule/program builders in the real input schema
 *   harness/      scenario types and runner, report tables, stub detection, invariants O-4…O-12, Euler reference (O-10)
 *   scenarios/    one file per dossier group; `ALL_SCENARIOS` is the registry the tests run
 *
 * Regenerate the report:  pnpm vitest run src/engine/validation --reporter=verbose   (see KNOWN_MISSES.md)
 */
export * from './harness/types';
export { ArmView } from './harness/view';
export { above, below, range, rel, val, runArm, runScenario, evaluateScenario, evaluateExpectation } from './harness/run';
export { formatTable, formatMarkdown, tally, describeOutcome } from './harness/report';
export { ALL_MODULES, REQUIRES, engineIsComplete, isStubModule, missingModules, readinessSummary, scenarioReady, stubModules, validationMode } from './harness/stubs';
export * from './harness/invariants';
export { compareHourlyToEuler, eulerHourly } from './harness/euler';
export * from './oracle/bwp';
export { bwpForArm, bwpInputFromProfile, bwDiffVsBwp, fatDiffVsBwp, intakeKcalFromArm } from './oracle/bwpAdapter';
export { dailyFuelBalance, glycogenTauDays, steadyGlycogenG } from './oracle/dailyFuel';
export { LEAN_MAN, MAN, PERSONAS, WOMAN, person, personWithTdee, tdee0Of } from './fixtures/personas';
export * from './fixtures/programs';
export { ALL_SCENARIOS, scenarioById } from './scenarios';
