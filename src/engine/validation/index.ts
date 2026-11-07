/**
 * WP-V validation package (docs/MODEL_SPEC.md §9): independent oracles, reference fixtures, the invariant harness and every
 * end-to-end published-study scenario of §9.2. Test-only code: nothing in the engine, the planner or the UI imports it,
 * except the planner/band work packages that reuse the §9.3 personas and the invariant functions.
 *
 *   oracle/       Hall 2011 / NIDDK Body Weight Planner port (O-1, O-2), 04 §4.11 daily carbohydrate balance (O-3)
 *   fixtures/     §9.3 personas (MAN, WOMAN, LEAN_MAN) and schedule/program builders in the real input schema
 *   harness/      scenario types and runner, report tables, stub detection, invariants O-4…O-12, Euler reference (O-10)
 *   scenarios/    one file per dossier group; `ALL_SCENARIOS` is the registry the tests run
 *   ledger.ts     evidence ledger (review D8-03): per scenario the study/cohort ids, evidence class (verification,
 *                 conditional dynamics, development fit, independent empirical validation), dataset role, influenced
 *                 parameters, observed/protocol/imputed inputs, population, endpoint operator and tolerance type
 *   harness/ledgerReport.ts   deterministic read-only generator of KNOWN_MISSES.md, the release ledger and the
 *                 evidence-class section of the internal report (printed by scenarios.test.ts; never writes files)
 *
 * Regenerate the report:  pnpm vitest run src/engine/validation --reporter=verbose   (capture recipe in KNOWN_MISSES.md)
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
export * from './ledger';
export { freezeHashOf, knownMissesMarkdown, ledgerMarkdown, ledgerSummary, releaseLedgerJson, type LedgerSummary, type RunFacts } from './harness/ledgerReport';
