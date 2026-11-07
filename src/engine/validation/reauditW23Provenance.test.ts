// @vitest-environment node
import { ENGINE_VERSION } from '../core/defaults';
import { MODULES } from '../core/moduleRegistry';
import { buildModelParams } from '../core/paramsRegistry';
import { CONTRACT_FINGERPRINT } from '../../lib/bodyContracts';
import { buildLedger, validateLedger } from './ledger';
import { PROVENANCE, provenanceOf } from './provenance';
import { ledgerSummary, releaseLedgerJson, type RunFacts } from './harness/ledgerReport';
import type { Outcome, Scenario } from './harness/types';
import { ALL_SCENARIOS } from './scenarios';

const params = buildModelParams(MODULES);
const meta = {
  modelVersion: ENGINE_VERSION,
  registryHash: params.registryHash,
  contracts: CONTRACT_FINGERPRINT,
};
const facts: RunFacts = {
  arms: 0,
  aborted: 0,
  modelLimit: 0,
  failedScenarios: 0,
  conservationViolations: 0,
  t0Gating: 0,
  t0Other: 0,
};
const ketoId = '06-V11-keto-ldl-by-bmi';
const limId = '06-V6-lim-2011-600kcal';
const murphyId = '09-4-murphy-koehler-deficit';
const scenarios = ALL_SCENARIOS.filter((sc) => [ketoId, limId, murphyId].includes(sc.id));
const ledger = buildLedger(scenarios, params.defs);
const outcomes: Outcome[] = scenarios.flatMap((sc) =>
  sc.expectations.map((ex) => ({
    scenarioId: sc.id,
    expectationId: ex.id,
    dossier: sc.dossier,
    target: sc.target,
    title: sc.title,
    label: ex.label,
    unit: ex.unit,
    gate: ex.gate ?? sc.gate,
    measured: 0,
    expected: '',
    error: 0,
    status: 'pass',
  })),
);
const summary = () => ledgerSummary(outcomes, scenarios, ledger, facts, meta, {});

describe('A2-030 checked arm/outcome provenance', () => {
  it('display labels and citations cannot change sources, operators, units, or goal coverage', () => {
    const renamed = scenarios.map((sc) => ({
      ...sc,
      title: 'renamed',
      citation: 'Unrelated 2099',
      expectations: sc.expectations.map((ex) => ({ ...ex, label: 'LDL lean fat liver weight CRP VO2max' })),
    }));
    const rebuilt = buildLedger(renamed, params.defs);
    expect(rebuilt).toEqual(ledger);
    expect(ledgerSummary(outcomes, renamed, rebuilt, facts, meta, {})).toEqual(summary());
  });

  it('maps each ketogenic LDL arm to its actual cohort and time, never all citations to all rows', () => {
    const lean = provenanceOf(ketoId, 'lean')!;
    const normal = provenanceOf(ketoId, 'normal')!;
    const obese = provenanceOf(ketoId, 'obese')!;
    expect([lean, normal, obese].map((p) => p.sources)).toEqual([
      [{ studyId: 'buren-2021', cohortId: 'buren-2021', armIds: ['lean'] }],
      [{ studyId: 'retterstol-2018', cohortId: 'retterstol-2018', armIds: ['normal'] }],
      [{ studyId: 'petersen-2026', cohortId: 'petersen-2026', armIds: ['obese'] }],
    ]);
    expect(normal.operator).toMatchObject({ series: ['ldl'], unit: 'mmol/L', timeBasis: 'day 21 (3 weeks)' });
    expect(normal.operator.transformation).toContain('change from initial');
    expect(normal.tolerance.check).toEqual({ kind: 'range', lo: 0.45, hi: 1.8 });
    expect([lean, normal, obese].map((p) => p.supportedGoals)).toEqual([['ldl'], ['ldl'], ['ldl']]);
  });

  it('Lim is absolute IHTG percentage at day 56 with its original check', () => {
    const p = provenanceOf(limId, 'ihtg')!;
    expect(p.operator).toMatchObject({
      series: ['liverFat'],
      transformation: 'absolute liver fat percentage',
      timeBasis: 'day 56 (8 weeks)',
      unit: '%',
    });
    expect(p.sources).toEqual([{ studyId: 'lim-2011', cohortId: 'lim-2011', armIds: ['main'] }]);
    expect(p.tolerance.check).toEqual({ kind: 'value', target: 2.9, tol: 2.9 * 0.2 });
  });

  it('Murphy zero is a kcal/day interpolation across exactly the five RT arms, not a measured lean-kg endpoint', () => {
    const p = provenanceOf(murphyId, 'zero')!;
    expect(p.participatingArmIds).toEqual(['d0', 'd250', 'd500', 'd750', 'd1000']);
    expect(p.sources).toEqual([
      { studyId: 'murphy-2022', cohortId: 'murphy-2022', armIds: p.participatingArmIds },
    ]);
    expect(p.operator).toMatchObject({
      unit: 'kcal/d',
      timeBasis: 'day 84 (12 weeks)',
      series: ['leanTissue'],
    });
    expect(p.operator.transformation).toContain('linear interpolation');
    expect(p.operator.estimand).toContain('zero net lean change');
    expect(p.supportedGoals).toEqual([]); // a calorie threshold is not a lean-kg endpoint
    expect(p.tolerance.check).toEqual({ kind: 'range', lo: 500, hi: 700 });
    expect(provenanceOf(murphyId, 'monotone')!.participatingArmIds).toEqual(['d1000', 'd0']);
    expect(provenanceOf(murphyId, 'gainAt0')!.kind).toBe('imputation');
  });

  it('an added imputation row cannot increase strength, CRP or VO2max empirical counts', () => {
    const sc = scenarios[0]!;
    const base = summary();
    const imputed = {
      ...structuredClone(ledger[0]!),
      provenance: {
        extra: {
          ...structuredClone(provenanceOf(ketoId, 'normal')!),
          kind: 'imputation' as const,
          supportedGoals: ['strength', 'crp', 'vo2max'],
        },
      },
    };
    const o = { ...outcomes[0]!, scenarioId: sc.id, expectationId: 'extra', label: 'carbohydrate oxidation' };
    const after = ledgerSummary([...outcomes, o], scenarios, [imputed, ...ledger.slice(1)], facts, meta, {});
    const onlyExtra = ledgerSummary([o], [sc], [imputed], facts, meta, {});
    expect(onlyExtra.endpoints).toEqual([]);
    expect(onlyExtra.independentStudies.developmentFit).toBe(0);
    expect(onlyExtra.classes.verification.expectations).toBe(1);
    expect(
      after.endpoints.filter((e) => e.goals.some((g) => ['strength', 'crp', 'vo2max'].includes(g))),
    ).toEqual(base.endpoints.filter((e) => e.goals.some((g) => ['strength', 'crp', 'vo2max'].includes(g))));
  });

  it('detailed arm/outcome inputs, scopes, operators and numerical tolerances round-trip in the identical report artifact', () => {
    const s = summary();
    const artifact = releaseLedgerJson(s, ledger);
    expect(JSON.parse(JSON.stringify(artifact))).toEqual(artifact);
    expect(artifact.outcomeEntries).toEqual(s.outcomeEntries);
    expect(s.outcomeEntries).toHaveLength(outcomes.length);
    expect(
      s.outcomeEntries.find((r) => r.scenarioId === limId && r.expectationId === 'ihtg')!.provenance,
    ).toEqual(PROVENANCE[limId]!.outcomes.ihtg);
    expect(s.endpoints.every((e) => e.independent === 0)).toBe(true);
    expect(s.endpoints.flatMap((e) => e.goals)).not.toContain('leanTissue');
    expect(s.classes.developmentFit.studies).toBe(5); // three keto cohorts, Lim, Murphy; each counted once
  });

  it.each(['operator', 'unit', 'time', 'source-arm', 'check'])('rejects a mismatched %s mapping', (field) => {
    const changed = structuredClone(ledger);
    const p = changed.find((e) => e.scenarioId === ketoId)!.provenance!.normal!;
    if (field === 'operator') p.operator.transformation = 'absolute';
    if (field === 'unit') p.operator.unit = 'kg';
    if (field === 'time') p.operator.timeBasis = 'day 84';
    if (field === 'source-arm')
      p.sources = [{ studyId: 'buren-2021', cohortId: 'buren-2021', armIds: ['lean'] }];
    if (field === 'check') p.tolerance.check = { kind: 'range', lo: 0, hi: 100 };
    expect(
      validateLedger(changed, scenarios, ENGINE_VERSION).filter((i) => i.kind === 'provenanceMismatch'),
    ).toHaveLength(1);
  });

  it('unknown mappings stay explicit and add no invented goal coverage', () => {
    const unknown = { ...scenarios[0]!, id: 'future-unmapped' } satisfies Scenario;
    const es = buildLedger([unknown], params.defs);
    const issues = validateLedger(es, [unknown], ENGINE_VERSION);
    expect(issues.filter((i) => i.kind === 'unknownProvenance')).toHaveLength(unknown.expectations.length);
    expect(es[0]!.studies).toEqual([]);
    expect(
      ledgerSummary([{ ...outcomes[0]!, scenarioId: unknown.id }], [unknown], es, facts, meta, {}).endpoints,
    ).toEqual([]);
  });

  it('classifies mixed Minnesota imputation and reference-port rows per outcome', () => {
    const id = '01-7.1b-minnesota-matched';
    expect(provenanceOf(id, 'baseline')!.kind).toBe('imputation');
    expect(provenanceOf(id, 'bwpBw24wk')!.kind).toBe('conditionalDynamics');
    expect(provenanceOf(id, 'vsBwp')!.kind).toBe('conditionalDynamics');
    expect(provenanceOf(id, 'bw24wk')!.kind).toBe('humanStudy');
    const artifact = releaseLedgerJson(summary(), ledger);
    expect(artifact.studies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'retterstol-2018',
          armAssociations: [
            expect.objectContaining({ scenarioId: ketoId, expectationId: 'normal', armIds: ['normal'] }),
          ],
        }),
      ]),
    );
  });

  it('checks the entire current extraction without changing a numerical target or tolerance', () => {
    const entries = buildLedger(ALL_SCENARIOS, params.defs);
    expect(
      validateLedger(entries, ALL_SCENARIOS, ENGINE_VERSION).filter((i) => i.severity !== 'warning'),
    ).toEqual([]);
    for (const sc of ALL_SCENARIOS) for (const ex of sc.expectations) {
      const p = provenanceOf(sc.id, ex.id)!;
      expect(p.tolerance.check).toEqual(ex.check);
      if (p.scope.studyPopulation.startsWith('unknown')) expect(p.supportedGoals).toEqual([]);
    }
  });
});
