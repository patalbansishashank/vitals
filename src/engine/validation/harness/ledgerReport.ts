/**
 * Deterministic, read-only report generator of the validation suite (review D8-03). From one run's outcomes, the scenario
 * list, the evidence ledger (`../ledger.ts`) and the register (`../knownMisses.ts`) it builds:
 *
 *   ledgerSummary         counts by evidence class (verification, conditional dynamics, development fit, independent
 *                         empirical validation), dataset role, independent study, population and model version; every
 *                         attempted row with its status (no data, error, skipped and aborted runs included); bias and MAE per
 *                         class and unit for point targets only (no aggregate across units or tolerance types; no coverage)
 *   releaseLedgerJson     the machine-readable release ledger, docs/validation/review-release-ledger.json
 *   ledgerMarkdown        the evidence-class section of docs/VALIDATION_REPORT_INTERNAL.md
 *   knownMissesMarkdown   the whole of src/engine/validation/KNOWN_MISSES.md
 *
 * `scenarios.test.ts` prints all four between BEGIN/END markers; the files are updated from that output (capture recipe in
 * KNOWN_MISSES.md), never written by the suite. Nothing here reads a clock or the machine, so equal outcomes give equal text.
 */
import { fnv1a } from '../../core/math';
import { KNOWN_MISSES, TRACKED_MISS_NOTES, type KnownMiss, type MissCause } from '../knownMisses';
import {
  EVIDENCE_CLASSES,
  LEDGER_SCHEMA_VERSION,
  classFor,
  populationGroupOf,
  roleFor,
  type DatasetRole,
  type EvidenceClass,
  type LedgerEntry,
} from '../ledger';
import type { Outcome, Scenario, Status } from './types';
import type { OutcomeProvenance } from '../provenance';

/** Facts of the run outside the expectation rows (all from the same run). */
export interface RunFacts {
  /** Scenario arms run. */
  arms: number;
  /** Arms the engine aborted on a state bound (`meta.aborted`). */
  aborted: number;
  /** Arms that ended at a numerical model limit (`meta.validity.status === 'modelLimit'`, D1-08). */
  modelLimit: number;
  /** Scenarios whose engine run threw. */
  failedScenarios: number;
  /** Arms breaking an O-4/O-5 conservation identity. */
  conservationViolations: number;
  /** O-5 day-0 morning-weight violations: arms with a habitual first night (gating) and others (reported). */
  t0Gating: number;
  t0Other: number;
}

export interface ReleaseMeta {
  modelVersion: string;
  registryHash: string;
  contracts: string;
}

export interface ClassTally {
  scenarios: number;
  studies: number;
  expectations: number;
  pass: number;
  registeredMiss: number;
  unregisteredMiss: number;
  knownMiss: number;
  nowPassing: number;
  qPass: number;
  qMiss: number;
  noData: number;
  error: number;
  skipped: number;
}

/** Bias and MAE of point targets (value checks) of one evidence class in one unit; never pooled across units. */
export interface ErrorMetric {
  evidenceClass: EvidenceClass;
  unit: string;
  n: number;
  bias: number;
  mae: number;
}

export interface LedgerSummary {
  schemaVersion: number;
  /** Identical detailed outcome set consumed by the machine ledger and summaries. */
  outcomeEntries: Array<{
    scenarioId: string;
    expectationId: string;
    evidenceClass: EvidenceClass;
    status: Status;
    measured: number | null;
    provenance: OutcomeProvenance | null;
  }>;
  unknownProvenance: string[];
  modelVersion: string;
  registryHash: string;
  contracts: string;
  /** Hash of the frozen model, contracts and scenario set this release was evaluated with. */
  freezeHash: string;
  scenarios: number;
  expectations: number;
  gates: {
    M: { rows: number; pass: number; registered: number; unregistered: number };
    K: { rows: number; stillMissing: number; nowPassing: number };
    Q: { rows: number; inDirection: number };
  };
  classes: Record<EvidenceClass, ClassTally>;
  roles: Record<DatasetRole, { scenarios: number; studies: number }>;
  /** Distinct study/cohort ids per evidence class (the split unit), separate from expectation counts. */
  independentStudies: Record<EvidenceClass, number>;
  populations: Record<string, { scenarios: number; expectations: number }>;
  modelVersions: Record<string, { externalEvaluations: number; developmentStudies: number }>;
  register: {
    rows: number;
    byCls: { K: number; open: number };
    byCause: Record<MissCause, number>;
    byOwner: Record<string, { K: number; open: number }>;
    reviewDecisions: Record<string, number>;
  };
  runs: RunFacts;
  errorMetrics: ErrorMetric[];
  /** Sign/order checks in the stated direction, per class. */
  directionMetrics: Array<{ evidenceClass: EvidenceClass; n: number; inDirection: number }>;
  /**
   * D4-08 validity matrix: per endpoint operator, the planner goals it stands for, the studies, populations and rows behind
   * it and how many are independent (none in this release). Code checks and model consistency are not in this matrix.
   */
  endpoints: Array<{
    endpoint: string;
    goals: string[];
    scenarios: number;
    studies: number;
    populations: string[];
    rows: number;
    met: number;
    knownMisses: number;
    independent: number;
  }>;
  /** Rows whose status needs attention (all visible). */
  nowPassing: string[];
  unregisteredMisses: string[];
  noData: string[];
  errors: string[];
  coverage: { available: false; reason: string };
}

const emptyTally = (): ClassTally => ({
  scenarios: 0,
  studies: 0,
  expectations: 0,
  pass: 0,
  registeredMiss: 0,
  unregisteredMiss: 0,
  knownMiss: 0,
  nowPassing: 0,
  qPass: 0,
  qMiss: 0,
  noData: 0,
  error: 0,
  skipped: 0,
});
const keyOf = (o: Pick<Outcome, 'scenarioId' | 'expectationId'>): string =>
  `${o.scenarioId}/${o.expectationId}`;
const round = (x: number, d = 4): number => Number(x.toFixed(d));

function addStatus(t: ClassTally, o: Outcome, register: Readonly<Record<string, KnownMiss>>): void {
  t.expectations++;
  const s: Status = o.status;
  if (s === 'pass') t.pass++;
  else if (s === 'miss') {
    if (register[keyOf(o)]) t.registeredMiss++;
    else t.unregisteredMiss++;
  } else if (s === 'known-miss') t.knownMiss++;
  else if (s === 'now-passing') t.nowPassing++;
  else if (s === 'q-pass') t.qPass++;
  else if (s === 'q-miss') t.qMiss++;
  else if (s === 'no-data') t.noData++;
  else if (s === 'error') t.error++;
  else t.skipped++;
}

/** Freeze hash of a release: model, parameters, contracts and the scenario set (sorted ids). */
export function freezeHashOf(meta: ReleaseMeta, scenarios: readonly Pick<Scenario, 'id'>[]): string {
  return fnv1a(
    `ledger${LEDGER_SCHEMA_VERSION}|${meta.modelVersion}|${meta.registryHash}|${meta.contracts}|${scenarios
      .map((s) => s.id)
      .sort()
      .join(',')}`,
  );
}

export function ledgerSummary(
  outcomes: readonly Outcome[],
  scenarios: readonly Scenario[],
  ledger: readonly LedgerEntry[],
  facts: RunFacts,
  meta: ReleaseMeta,
  register: Readonly<Record<string, KnownMiss>> = KNOWN_MISSES,
): LedgerSummary {
  const byId = new Map(ledger.map((e) => [e.scenarioId, e]));
  const scById = new Map(scenarios.map((s) => [s.id, s]));
  const classes = Object.fromEntries(EVIDENCE_CLASSES.map((c) => [c, emptyTally()])) as Record<
    EvidenceClass,
    ClassTally
  >;
  const studySets = Object.fromEntries(EVIDENCE_CLASSES.map((c) => [c, new Set<string>()])) as Record<
    EvidenceClass,
    Set<string>
  >;
  const roles: LedgerSummary['roles'] = {
    estimation: { scenarios: 0, studies: 0 },
    calibration: { scenarios: 0, studies: 0 },
    externalEvaluation: { scenarios: 0, studies: 0 },
  };
  const roleStudies: Record<DatasetRole, Set<string>> = {
    estimation: new Set(),
    calibration: new Set(),
    externalEvaluation: new Set(),
  };
  const populations: LedgerSummary['populations'] = {};
  const classScenarios = Object.fromEntries(EVIDENCE_CLASSES.map((c) => [c, new Set<string>()])) as Record<
    EvidenceClass,
    Set<string>
  >;
  const roleScenarios: Record<DatasetRole, Set<string>> = {
    estimation: new Set(),
    calibration: new Set(),
    externalEvaluation: new Set(),
  };
  const outcomeEntries: LedgerSummary['outcomeEntries'] = [];
  const unknownProvenance: string[] = [];
  for (const o of outcomes) {
    const e = byId.get(o.scenarioId);
    const p = e?.provenance?.[o.expectationId];
    const c = outcomeClass(e, p, meta.modelVersion);
    outcomeEntries.push({
      scenarioId: o.scenarioId,
      expectationId: o.expectationId,
      evidenceClass: c,
      status: o.status,
      measured: Number.isFinite(o.measured) ? o.measured : null,
      provenance: p ?? null,
    });
    classScenarios[c].add(o.scenarioId);
    if (!p || p.status === 'unknown') unknownProvenance.push(keyOf(o));
    // Cohorts are the split unit. Unknown and imputed rows never supply human study counts.
    if (p && p.status === 'curated' && p.kind !== 'imputation' && p.kind !== 'verification') {
      for (const source of p.sources) studySets[c].add(source.cohortId);
      const r = e ? roleFor(e, meta.modelVersion) : null;
      if (r && p.kind === 'humanStudy') {
        roleScenarios[r].add(o.scenarioId);
        for (const source of p.sources) roleStudies[r].add(source.cohortId);
      }
    }
  }
  for (const sc of scenarios) {
    const g = populationGroupOf(sc);
    populations[g] = populations[g] ?? { scenarios: 0, expectations: 0 };
    populations[g].scenarios++;
    populations[g].expectations += outcomes.filter((o) => o.scenarioId === sc.id).length;
  }
  for (const c of EVIDENCE_CLASSES) {
    classes[c].scenarios = classScenarios[c].size;
    classes[c].studies = studySets[c].size;
  }
  for (const r of Object.keys(roles) as DatasetRole[]) {
    roles[r].scenarios = roleScenarios[r].size;
    roles[r].studies = roleStudies[r].size;
  }

  const gates: LedgerSummary['gates'] = {
    M: { rows: 0, pass: 0, registered: 0, unregistered: 0 },
    K: { rows: 0, stillMissing: 0, nowPassing: 0 },
    Q: { rows: 0, inDirection: 0 },
  };
  const errAcc = new Map<
    string,
    { evidenceClass: EvidenceClass; unit: string; n: number; sum: number; abs: number }
  >();
  const dirAcc = new Map<EvidenceClass, { n: number; ok: number }>();
  const nowPassing: string[] = [];
  const unregisteredMisses: string[] = [];
  const noData: string[] = [];
  const errors: string[] = [];
  for (const o of outcomes) {
    const e = byId.get(o.scenarioId);
    const c = outcomeClass(e, e?.provenance?.[o.expectationId], meta.modelVersion);
    addStatus(classes[c], o, register);
    const k = keyOf(o);
    if (o.gate === 'M') {
      gates.M.rows++;
      if (o.status === 'pass') gates.M.pass++;
      else if (register[k]) gates.M.registered++;
      else gates.M.unregistered++;
    } else if (o.gate === 'K') {
      gates.K.rows++;
      if (o.status === 'now-passing') gates.K.nowPassing++;
      else gates.K.stillMissing++;
    } else {
      gates.Q.rows++;
      if (o.status === 'q-pass') gates.Q.inDirection++;
    }
    if (o.status === 'now-passing' || (o.status === 'pass' && register[k])) nowPassing.push(k);
    if (o.status === 'miss' && !register[k]) unregisteredMisses.push(k);
    if (o.status === 'no-data') noData.push(k);
    if (o.status === 'error') errors.push(k);
    // point targets: bias and MAE in the outcome's own unit; sign/order checks: direction share
    const sc = scById.get(o.scenarioId);
    const ex = sc?.expectations.find((x) => x.id === o.expectationId);
    if (ex && Number.isFinite(o.measured)) {
      if (ex.check.kind === 'value') {
        const key = `${c}|${o.unit}`;
        const a = errAcc.get(key) ?? { evidenceClass: c, unit: o.unit, n: 0, sum: 0, abs: 0 };
        const d = o.measured - ex.check.target;
        a.n++;
        a.sum += d;
        a.abs += Math.abs(d);
        errAcc.set(key, a);
      } else if (ex.check.kind === 'above' || ex.check.kind === 'below') {
        const a = dirAcc.get(c) ?? { n: 0, ok: 0 };
        a.n++;
        if (o.status === 'pass' || o.status === 'q-pass' || o.status === 'now-passing') a.ok++;
        dirAcc.set(c, a);
      }
    }
  }

  const byCause = {
    structure: 0,
    ruling: 0,
    dossier: 0,
    calibration: 0,
    mapping: 0,
    reviewDecision: 0,
  } as Record<MissCause, number>;
  const byOwner: Record<string, { K: number; open: number }> = {};
  const reviewDecisions: Record<string, number> = {};
  let K = 0;
  let open = 0;
  for (const m of Object.values(register)) {
    byCause[m.cause]++;
    byOwner[m.owner] = byOwner[m.owner] ?? { K: 0, open: 0 };
    byOwner[m.owner]![m.cls === 'K' ? 'K' : 'open']++;
    if (m.cls === 'K') K++;
    else open++;
    if (m.decision) reviewDecisions[m.decision] = (reviewDecisions[m.decision] ?? 0) + 1;
  }

  // Explicit goal/operator/population/intervention links only; no bucket or label defaults.
  const ep = new Map<
    string,
    {
      goals: string[];
      scenarios: Set<string>;
      studies: Set<string>;
      pops: Set<string>;
      rows: number;
      met: number;
      km: number;
      ext: Set<string>;
    }
  >();
  for (const row of outcomeEntries) {
    const p = row.provenance;
    if (!p || p.status !== 'curated' || p.kind !== 'humanStudy' || !p.supportedGoals.length) continue;
    if (row.evidenceClass !== 'developmentFit' && row.evidenceClass !== 'externalEvaluation') continue;
    const name = `${p.operator.estimand} [${p.operator.unit}; ${p.operator.timeBasis}]`;
    const a = ep.get(name) ?? {
      goals: [...p.supportedGoals],
      scenarios: new Set(),
      studies: new Set(),
      pops: new Set(),
      rows: 0,
      met: 0,
      km: 0,
      ext: new Set(),
    };
    a.scenarios.add(row.scenarioId);
    for (const source of p.sources) {
      a.studies.add(source.cohortId);
      if (row.evidenceClass === 'externalEvaluation') a.ext.add(source.cohortId);
    }
    a.pops.add(p.scope.population);
    a.rows++;
    if (row.status === 'pass' || row.status === 'q-pass') a.met++;
    if (
      (row.status === 'miss' && register[`${row.scenarioId}/${row.expectationId}`]) ||
      row.status === 'known-miss'
    )
      a.km++;
    ep.set(name, a);
  }
  const endpoints = [...ep.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([endpoint, a]) => ({
      endpoint,
      goals: a.goals,
      scenarios: a.scenarios.size,
      studies: a.studies.size,
      populations: [...a.pops].sort(),
      rows: a.rows,
      met: a.met,
      knownMisses: a.km,
      independent: a.ext.size,
    }));

  const devStudies = new Set([...studySets.developmentFit]);
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    outcomeEntries,
    unknownProvenance,
    modelVersion: meta.modelVersion,
    registryHash: meta.registryHash,
    contracts: meta.contracts,
    freezeHash: freezeHashOf(meta, scenarios),
    scenarios: scenarios.length,
    expectations: outcomes.length,
    gates,
    classes,
    roles,
    independentStudies: Object.fromEntries(EVIDENCE_CLASSES.map((c) => [c, studySets[c].size])) as Record<
      EvidenceClass,
      number
    >,
    populations: Object.fromEntries(Object.entries(populations).sort(([a], [b]) => a.localeCompare(b))),
    modelVersions: {
      [meta.modelVersion]: {
        externalEvaluations: studySets.externalEvaluation.size,
        developmentStudies: devStudies.size,
      },
    },
    register: {
      rows: K + open,
      byCls: { K, open },
      byCause,
      byOwner: Object.fromEntries(Object.entries(byOwner).sort(([a], [b]) => a.localeCompare(b))),
      reviewDecisions: Object.fromEntries(
        Object.entries(reviewDecisions).sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
    runs: facts,
    errorMetrics: [...errAcc.values()]
      .sort((a, b) => a.evidenceClass.localeCompare(b.evidenceClass) || a.unit.localeCompare(b.unit))
      .map((a) => ({
        evidenceClass: a.evidenceClass,
        unit: a.unit,
        n: a.n,
        bias: round(a.sum / a.n),
        mae: round(a.abs / a.n),
      })),
    directionMetrics: EVIDENCE_CLASSES.filter((c) => dirAcc.has(c)).map((c) => ({
      evidenceClass: c,
      n: dirAcc.get(c)!.n,
      inDirection: dirAcc.get(c)!.ok,
    })),
    endpoints,
    nowPassing,
    unregisteredMisses,
    noData,
    errors,
    coverage: {
      available: false,
      reason:
        'tolerances are dossier design bands, not predictive intervals; interval coverage needs calibrated intervals and untouched outcomes',
    },
  };
}

/** The machine-readable release ledger (docs/validation/review-release-ledger.json): the summary plus one row per study. */
export function releaseLedgerJson(
  summary: LedgerSummary,
  ledger: readonly LedgerEntry[],
): Record<string, unknown> {
  const studies = new Map<
    string,
    {
      id: string;
      studyIds: string[];
      armAssociations: Array<{
        scenarioId: string;
        expectationId: string;
        studyId: string;
        armIds: readonly string[];
      }>;
      classes: EvidenceClass[];
      roles: DatasetRole[];
      roleBasis: string;
      scenarios: string[];
      influenced: string[];
      protocolFidelity: string[];
    }
  >();
  const byId = new Map(ledger.map((e) => [e.scenarioId, e]));
  for (const outcome of summary.outcomeEntries) {
    const p = outcome.provenance;
    const e = byId.get(outcome.scenarioId);
    if (!p || !e || p.status !== 'curated' || p.kind === 'imputation' || p.kind === 'verification') continue;
    for (const source of p.sources) {
      const id = source.cohortId;
      const row = studies.get(id) ?? {
        id,
        studyIds: [],
        armAssociations: [],
        classes: [],
        roles: [],
        roleBasis: p.model.roleBasis,
        scenarios: [],
        influenced: [],
        protocolFidelity: [],
      };
      if (!row.studyIds.includes(source.studyId)) row.studyIds.push(source.studyId);
      row.armAssociations.push({
        scenarioId: outcome.scenarioId,
        expectationId: outcome.expectationId,
        studyId: source.studyId,
        armIds: source.armIds,
      });
      if (!row.classes.includes(outcome.evidenceClass)) row.classes.push(outcome.evidenceClass);
      const role = roleFor(e, summary.modelVersion);
      if (role && p.kind === 'humanStudy' && !row.roles.includes(role)) row.roles.push(role);
      if (!row.scenarios.includes(e.scenarioId)) row.scenarios.push(e.scenarioId);
      for (const influenced of p.model.influenced)
        if (!row.influenced.includes(influenced)) row.influenced.push(influenced);
      if (!row.protocolFidelity.includes(e.protocolFidelity)) row.protocolFidelity.push(e.protocolFidelity);
      if (p.model.roleBasis === 'documented') row.roleBasis = 'documented';
      studies.set(id, row);
    }
  }
  return {
    ...summary,
    capture:
      'pnpm vitest run src/engine/validation/scenarios.test.ts --reporter=verbose (block BEGIN release-ledger … END release-ledger)',
    studies: [...studies.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function outcomeClass(
  entry: LedgerEntry | undefined,
  p: OutcomeProvenance | undefined,
  modelVersion: string,
): EvidenceClass {
  if (p?.kind === 'imputation' || p?.kind === 'verification') return 'verification';
  if (p?.kind === 'conditionalDynamics') return 'conditionalDynamics';
  return entry ? classFor(entry, modelVersion) : 'developmentFit';
}

const CLASS_NAME: Readonly<Record<EvidenceClass, string>> = {
  verification: 'Verification (identities, anchors, invariances)',
  conditionalDynamics: 'Conditional dynamics (shared-input model comparisons)',
  developmentFit: 'Development fit (studies the model was built or tuned against)',
  externalEvaluation: 'Independent empirical validation (untouched, frozen-model holdouts)',
};

const num = (x: number): string => {
  if (!Number.isFinite(x)) return 'n/a';
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return x.toExponential(2);
  return String(Number(x.toPrecision(3)));
};

/** Evidence-class section of the internal report (markdown; same numbers as the release ledger). */
export function ledgerMarkdown(s: LedgerSummary): string {
  const L: string[] = [];
  L.push('## Evidence classes (review D8-03)');
  L.push('');
  L.push(
    `Engine ${s.modelVersion}, parameter set ${s.registryHash}, contracts ${s.contracts}; freeze hash ${s.freezeHash}. ${s.scenarios} scenarios, ${s.expectations} expectations.`,
  );
  L.push('');
  L.push(
    '| evidence class | scenarios | independent studies | rows | met (M) | registered misses | unregistered misses | K still missing | K now passing | Q in direction | no data | errors |',
  );
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of EVIDENCE_CLASSES) {
    const t = s.classes[c];
    L.push(
      `| ${CLASS_NAME[c]} | ${t.scenarios} | ${t.studies} | ${t.expectations} | ${t.pass} | ${t.registeredMiss} | ${t.unregisteredMiss} | ${t.knownMiss} | ${t.nowPassing} | ${t.qPass} / ${t.qPass + t.qMiss} | ${t.noData} | ${t.error} |`,
    );
  }
  L.push('');
  L.push(
    `Dataset roles of the study scenarios: estimation ${s.roles.estimation.scenarios} scenarios (${s.roles.estimation.studies} studies whose numbers are cited by a parameter), calibration ${s.roles.calibration.scenarios} (${s.roles.calibration.studies} studies visible while the model was tuned; development by default because no provenance establishes independence), external evaluation ${s.roles.externalEvaluation.scenarios} (${s.roles.externalEvaluation.studies} studies).`,
  );
  L.push('');
  L.push(
    `Runs: ${s.runs.arms} arms, ${s.runs.aborted} aborted on a state bound, ${s.runs.modelLimit} ended at a model limit, ${s.runs.failedScenarios} scenarios failed to run; conservation (O-4/O-5) violations ${s.runs.conservationViolations}; day-0 morning-weight violations ${s.runs.t0Gating} gating, ${s.runs.t0Other} in arms whose plan changes the first night. Rows with no data: ${s.noData.length}; errors: ${s.errors.length}; registered rows now passing: ${s.nowPassing.length}${s.nowPassing.length ? ` (${s.nowPassing.join(', ')})` : ''}.`,
  );
  L.push('');
  L.push(
    `Provenance schema ${s.schemaVersion}: ${s.outcomeEntries.length} detailed arm/outcome entries; ${s.unknownProvenance.length} unresolved rows, excluded from goal-specific empirical coverage. Unknown study-population scope and derived thresholds without a matching goal estimand also supply no goal coverage. Pure imputation/software rows count as verification per outcome. Scenario counts may overlap classes in mixed scenarios.`,
  );
  L.push('');
  L.push(
    'Populations (scenarios / expectations): ' +
      Object.entries(s.populations)
        .map(([k, v]) => `${k} ${v.scenarios} / ${v.expectations}`)
        .join('; ') +
      '.',
  );
  L.push('');
  L.push(
    'Bias and mean absolute error of point targets, per evidence class and unit (engine − target; not pooled across units, tolerance types or classes):',
  );
  L.push('');
  L.push('| evidence class | unit | rows | bias | MAE |');
  L.push('|---|---|---|---|---|');
  for (const m of s.errorMetrics)
    L.push(`| ${m.evidenceClass} | ${m.unit} | ${m.n} | ${num(m.bias)} | ${num(m.mae)} |`);
  L.push('');
  L.push(
    'Sign and order checks in the stated direction: ' +
      s.directionMetrics.map((d) => `${d.evidenceClass} ${d.inDirection} of ${d.n}`).join('; ') +
      `. Interval coverage: not reported (${s.coverage.reason}).`,
  );
  L.push('');
  L.push(
    'Validity matrix (D4-08): study evidence behind each endpoint the planner can optimise, by population; code checks, conservation and shared-input model comparisons are not counted here. "Independent" counts studies held out under a frozen model.',
  );
  L.push('');
  L.push(
    '| endpoint operator | planner goals | studies | populations | rows | met | known misses | independent studies |',
  );
  L.push('|---|---|---|---|---|---|---|---|');
  for (const e of s.endpoints)
    L.push(
      `| ${e.endpoint} | ${e.goals.join(', ') || '–'} | ${e.studies} | ${e.populations.join('; ')} | ${e.rows} | ${e.met} | ${e.knownMisses} | ${e.independent} |`,
    );
  return L.join('\n');
}

const CAUSE_TITLE: Readonly<Record<MissCause, string>> = {
  structure: 'Model structure (mechanism absent or simplified by design)',
  ruling: 'Consequence of a ruling',
  reviewDecision: 'Consequence of a review decision (2026-10-18)',
  dossier: 'Dossier targets conflict',
  mapping: 'Scenario mapping limits',
  calibration: 'Open calibration items',
};
const CAUSE_ORDER: readonly MissCause[] = [
  'structure',
  'ruling',
  'reviewDecision',
  'dossier',
  'mapping',
  'calibration',
];

/** The whole KNOWN_MISSES.md, regenerated from the run's outcomes and the register (no dates or machine data). */
export function knownMissesMarkdown(
  outcomes: readonly Outcome[],
  s: LedgerSummary,
  register: Readonly<Record<string, KnownMiss>> = KNOWN_MISSES,
): string {
  const esc = (x: string) => x.replace(/\|/g, '\\|');
  const byKey = new Map(outcomes.map((o) => [keyOf(o), o]));
  const L: string[] = [];
  L.push('# Known misses and validation status');
  L.push('');
  L.push(
    `Regenerated from the validation run of engine ${s.modelVersion} (parameter set ${s.registryHash}, contracts ${s.contracts}, freeze hash ${s.freezeHash}) by \`harness/ledgerReport.ts\`: ` +
      `${s.scenarios} scenarios, ${s.expectations} expectations. Must-pass (M): ${s.gates.M.rows} rows — ${s.gates.M.pass} pass, ${s.gates.M.registered} registered misses (${s.register.byCls.K} accepted, ${s.register.byCls.open} open calibration items), ${s.gates.M.unregistered} unregistered. ` +
      `Tracked known misses (K): ${s.gates.K.rows}, ${s.gates.K.stillMissing} still missing, ${s.gates.K.nowPassing} now passing. Qualitative (Q): ${s.gates.Q.inDirection} of ${s.gates.Q.rows} in the stated direction (non-gating).`,
  );
  L.push('');
  L.push(
    'Capture recipe (the suite never rewrites this file): `pnpm vitest run src/engine/validation/scenarios.test.ts --reporter=verbose` prints this file between `BEGIN known-misses` and `END known-misses`, ' +
      'the release ledger (`docs/validation/review-release-ledger.json`) between `BEGIN release-ledger` and `END release-ledger`, and the evidence-class section of `docs/VALIDATION_REPORT_INTERNAL.md` between `BEGIN evidence-classes` and `END evidence-classes`. ' +
      'The suite fails when the committed release ledger no longer matches the run, so the counts here, in the internal report and in the public report come from the same outcomes.',
  );
  L.push('');
  L.push(
    'Evidence classes (D8-03): every row is verification, conditional dynamics (shared-input model comparison), development fit or independent empirical validation; this release has ' +
      `${s.independentStudies.externalEvaluation} independent (untouched) studies, ${s.independentStudies.developmentFit} development studies and ${s.independentStudies.conditionalDynamics} shared-input model references. A known miss is a challenge target, never a widened tolerance.`,
  );
  L.push('');
  L.push('## How the suite gates');
  L.push('');
  L.push(
    '- The suite is green when every M row passes **or** is registered in `knownMisses.ts`, and every K row still misses. Registered M rows and K rows run as `it.fails`: when one starts passing the suite turns red — delete its register entry (or promote the K row to M) and regenerate this file.',
  );
  L.push(
    "- Tolerances are the dossiers' own and are never loosened. `owner` is the module whose equations or parameters produce the miss (or `scenario`); `cls` K = accepted (structure, ruling, review decision, dossier conflict, mapping limit), open = calibration item; `cause` groups the rows below.",
  );
  L.push(
    '- A review-decision row names the decision and the labelled legacy scenario under which it met its target; the suite re-runs that scenario and checks the row still passes there, so the miss stays attributable to the decision. Passing under a scenario fitted to the same study is a development fit, never validation.',
  );
  L.push(
    '- The day-0 weigh-in check (O-5, morning anchor) gates every arm whose first night is the habitual one; conservation (O-4) gates every arm.',
  );
  L.push('');
  L.push('## Tracked known misses (scenario gate K)');
  L.push('');
  L.push('| scenario / expectation | expected | engine | status | why |');
  L.push('|---|---|---|---|---|');
  for (const o of outcomes) {
    if (o.gate !== 'K') continue;
    const n = TRACKED_MISS_NOTES[keyOf(o)];
    L.push(
      `| ${esc(`${keyOf(o)} — ${o.label}`)} | ${esc(`${o.expected} ${o.unit}`.trim())} | ${num(o.measured)} | ${o.status} | ${esc(n ? `${n.owner} — ${n.note}` : 'no note in TRACKED_MISS_NOTES')} |`,
    );
  }
  L.push('');
  L.push('## Registered must-pass misses, by cause');
  for (const cause of CAUSE_ORDER) {
    const rows = Object.entries(register).filter(([, m]) => m.cause === cause);
    if (!rows.length) continue;
    L.push('');
    L.push(`### ${CAUSE_TITLE[cause]} (${rows.length} rows)`);
    L.push('');
    L.push('| scenario / expectation | owner | expected | engine | why |');
    L.push('|---|---|---|---|---|');
    for (const [k, m] of rows) {
      const o = byKey.get(k);
      const label = o ? `${k} — ${o.label}` : `${k} — (no such expectation)`;
      const expected = o ? `${o.expected} ${o.unit}`.trim() : m.target;
      const engine = o ? num(o.measured) : 'n/a';
      L.push(
        `| ${esc(label)} | ${m.owner} (${m.cls}) | ${esc(expected)} | ${engine}${o && o.status === 'pass' ? ' (**now passing**)' : ''} | ${esc(m.note)} |`,
      );
    }
  }
  L.push('');
  L.push('## Counts by owner');
  L.push('');
  L.push('| owner | K | open | total |');
  L.push('|---|---|---|---|');
  for (const [owner, c] of Object.entries(s.register.byOwner))
    L.push(`| ${owner} | ${c.K} | ${c.open} | ${c.K + c.open} |`);
  L.push('');
  L.push(
    'Review decisions behind registered rows: ' +
      (Object.entries(s.register.reviewDecisions)
        .map(([d, n]) => `${d} ${n}`)
        .join(', ') || 'none') +
      '.',
  );
  L.push('');
  return L.join('\n');
}
