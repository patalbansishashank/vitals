/**
 * Scenario contract of the validation suite (MODEL_SPEC §9.2-9.3).
 *
 * A Scenario is DATA: one or more arms, each a real `PersonProfile` + `Schedule` (the engine's input schema, compiled by
 * `core/compileSchedule`), plus expectations. An expectation measures one number from the arm results and checks it
 * against a published target and tolerance. Gate semantics follow §9 exactly:
 *   M — must pass in CI (once the modules it needs are implemented)
 *   K — tracked known miss: reported with its current error, never gating, listed in KNOWN_MISSES.md
 *   Q — qualitative / direction: reported, never gating
 */
import type { PersonProfile, ResolvedProfile, RunOptions, Schedule, SimulationResult, CompiledSchedule } from '../../types';
import type { ModuleId } from '../../types/signals';
import type { ArmView } from './view';

export type Gate = 'M' | 'K' | 'Q';

/** Spec §9 test levels: I = full-engine scenario, O = oracle comparison, U = module unit (not represented here). */
export type Level = 'I' | 'O';

export interface ArmSpec {
  /** Human label (e.g. 'RC', 'RF', 'PRO'). */
  label?: string;
  profile: PersonProfile;
  schedule: Schedule;
  /** Overrides of the default run options (`record: 'daily'`, burn-in 14 d, checks on). */
  options?: RunOptions;
}

/** What a measure function sees. */
export interface MeasureCtx {
  /** Arm view by id (defaults to the only arm, `main`). */
  arm(id?: string): ArmView;
  readonly main: ArmView;
  readonly arms: Readonly<Record<string, ArmView>>;
}

export type Check =
  /** |measured − target| ≤ tol (absolute, in the expectation's unit). */
  | { kind: 'value'; target: number; tol: number }
  /** lo ≤ measured ≤ hi. */
  | { kind: 'range'; lo: number; hi: number }
  /** measured > min (direction). */
  | { kind: 'above'; min: number }
  /** measured < max (direction). */
  | { kind: 'below'; max: number };

export interface Expectation {
  /** Short id unique inside the scenario (e.g. 'bw24wk'). */
  id: string;
  label: string;
  unit: string;
  measure: (c: MeasureCtx) => number;
  check: Check;
  /** Overrides the scenario gate for this expectation (e.g. one K item inside an otherwise M scenario). */
  gate?: Gate;
  /** Published source of the target (author year, dossier §). */
  source?: string;
  /** Free text: caveats, mapping choices, why it is a known miss. */
  note?: string;
}

export interface Scenario {
  /** Globally unique, sortable: `<dossier>-<target>-<slug>`, e.g. `01-7.1-minnesota`. */
  id: string;
  /** Dossier number(s) as in the §9.2 table, e.g. '01', '20'. */
  dossier: string;
  /** Target id inside the dossier §7 list (e.g. '7.1', 'V3', '#5'). */
  target: string;
  title: string;
  level: Level;
  /** Default gate of the scenario's expectations. */
  gate: Gate;
  /** Modules that must be implemented before the assertions gate. */
  requires: readonly ModuleId[];
  arms: Readonly<Record<string, ArmSpec>>;
  expectations: readonly Expectation[];
  /** How the study was mapped onto the input schema; what is approximated. */
  notes?: string;
  /** Publication(s). */
  citation: string;
}

export type Status =
  | 'pass'
  | 'miss' // gate M, out of tolerance (gating)
  | 'known-miss' // gate K, out of tolerance (non-gating)
  | 'now-passing' // gate K, inside tolerance: promote to M
  | 'q-pass'
  | 'q-miss'
  | 'no-data' // measure returned NaN / series not recorded
  | 'error' // engine threw
  | 'skipped';

export interface Outcome {
  scenarioId: string;
  dossier: string;
  target: string;
  title: string;
  expectationId: string;
  label: string;
  unit: string;
  gate: Gate;
  measured: number;
  /** Rendered expectation, e.g. '52.7 ± 2' or '> 0'. */
  expected: string;
  /** Signed distance from the acceptance region (0 when inside): value → measured − target. */
  error: number;
  status: Status;
  note?: string;
  errorMessage?: string;
}

export interface ArmRun {
  id: string;
  profile: ResolvedProfile;
  compiled: CompiledSchedule;
  result: SimulationResult;
}
