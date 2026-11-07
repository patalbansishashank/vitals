// @vitest-environment node
/**
 * Review release contracts of the validation package (D8-03, C1-C7), without the scenario runs:
 *
 *  - the evidence ledger: study-level split leakage, missing roles / tolerance types / inputs, frozen external evaluation
 *    semantics across model versions (golden fixture), study identity across scenarios, units;
 *  - provider/consumer round trips: the ledger and the run metadata the validation reports read (contract fingerprint,
 *    domain validity, per-series status, applied offsets) survive JSON (reload, sync, import) unchanged — unknowns stay
 *    unknown, versions and hashes keep their identity — and rebuilding is idempotent.
 */
import { compileSchedule } from '../core/compileSchedule';
import { ENGINE_VERSION } from '../core/defaults';
import { runEngine } from '../core/loop';
import { MODULES } from '../core/moduleRegistry';
import { buildModelParams } from '../core/paramsRegistry';
import { resolveProfile } from '../core/resolveProfile';
import { CONTRACT_FINGERPRINT } from '../../lib/bodyContracts';
import { MAN } from './fixtures/personas';
import { constantSchedule, neutralMacros, pctProgram } from './fixtures/programs';
import { freezeHashOf, ledgerSummary, releaseLedgerJson, type RunFacts } from './harness/ledgerReport';
import { ALL_SCENARIOS } from './scenarios';
import { KNOWN_MISSES, TRACKED_MISS_NOTES } from './knownMisses';
import {
  buildLedger,
  citedStudies,
  classFor,
  roleFor,
  studiesOf,
  validateLedger,
  type FrozenEvaluation,
  type LedgerEntry,
} from './ledger';

const PARAMS = buildModelParams(MODULES);
const LEDGER = buildLedger(ALL_SCENARIOS, PARAMS.defs);
const META = {
  modelVersion: ENGINE_VERSION,
  registryHash: PARAMS.registryHash,
  contracts: CONTRACT_FINGERPRINT,
};

/** A minimal study entry for the fixtures. */
function entry(over: Partial<LedgerEntry> & Pick<LedgerEntry, 'scenarioId'>): LedgerEntry {
  return {
    studies: ['fixture-2020'],
    arms: ['main'],
    outcomes: ['x'],
    evidenceClass: 'developmentFit',
    role: 'calibration',
    roleBasis: 'migrationDefault',
    influenced: [],
    inputs: {
      observed: [],
      protocol: ['intake: absolute kcal/d'],
      imputed: ['participants: one representative person from published group means'],
    },
    population: 'adult men, 30 y, BMI 25',
    endpoints: { x: 'scaleWake (morning scale weight)' },
    tolerances: { x: { type: 'design', source: 'fixture' } },
    protocolFidelity: 'unknown',
    evaluations: [],
    influencedVersions: [],
    ...over,
  };
}

const frozen = (modelVersion: string): FrozenEvaluation => ({
  modelVersion,
  freezeHash: 'f00d',
  protocol: 'frozen model and extraction protocol',
  extractedAfterFreeze: true,
  attempted: 4,
});

describe('evidence ledger: roles across model versions (golden fixture)', () => {
  it('a historical frozen-model external evaluation stays external for the version it evaluated, after it is read', () => {
    const e = entry({
      scenarioId: 'held',
      role: 'externalEvaluation',
      evidenceClass: 'externalEvaluation',
      evaluations: [frozen('1.2.0')],
    });
    expect(roleFor(e, '1.2.0')).toBe('externalEvaluation');
    expect(classFor(e, '1.2.0')).toBe('externalEvaluation');
  });

  it('a later revision tuned on it is development (calibration) for that revision; the historical role is not relabelled', () => {
    const e = entry({
      scenarioId: 'held',
      role: 'externalEvaluation',
      evidenceClass: 'externalEvaluation',
      evaluations: [frozen('1.2.0')],
      influencedVersions: ['1.3.0'],
    });
    expect(roleFor(e, '1.3.0')).toBe('calibration');
    expect(classFor(e, '1.3.0')).toBe('developmentFit');
    expect(roleFor(e, '1.2.0')).toBe('externalEvaluation');
  });

  it('a consulted holdout is development for any later version that has no frozen evaluation of its own', () => {
    const e = entry({
      scenarioId: 'held',
      role: 'externalEvaluation',
      evidenceClass: 'externalEvaluation',
      evaluations: [frozen('1.2.0')],
    });
    expect(roleFor(e, '1.4.0')).toBe('calibration');
  });

  it('an untouched holdout with no evaluation yet is external; verification and conditional dynamics never change class', () => {
    expect(
      roleFor(
        entry({ scenarioId: 'u', role: 'externalEvaluation', evidenceClass: 'externalEvaluation' }),
        '9.9.9',
      ),
    ).toBe('externalEvaluation');
    expect(classFor(entry({ scenarioId: 'v', evidenceClass: 'verification', role: null }), '9.9.9')).toBe(
      'verification',
    );
    expect(
      classFor(entry({ scenarioId: 'c', evidenceClass: 'conditionalDynamics', role: null }), '9.9.9'),
    ).toBe('conditionalDynamics');
  });
});

describe('evidence ledger: registry checks', () => {
  const sc = (id: string) => ({
    ...ALL_SCENARIOS[0]!,
    id,
    expectations: [{ ...ALL_SCENARIOS[0]!.expectations[0]!, id: 'x' }],
  });

  it('detects study-level split leakage: one study cannot be development and external evaluation for the same version', () => {
    const dev = entry({ scenarioId: 'a', studies: ['shared-2021'] });
    const ext = entry({
      scenarioId: 'b',
      studies: ['shared-2021'],
      role: 'externalEvaluation',
      evidenceClass: 'externalEvaluation',
      evaluations: [frozen('9.9.9')],
    });
    const issues = validateLedger([dev, ext], [sc('a'), sc('b')], '9.9.9');
    expect(issues.map((i) => i.kind)).toContain('splitLeakage');
    // a different study in the holdout is fine
    expect(
      validateLedger([dev, { ...ext, studies: ['other-2021'] }], [sc('a'), sc('b')], '9.9.9').filter(
        (i) => i.kind === 'splitLeakage',
      ),
    ).toEqual([]);
  });

  it('detects arms of one study split across partitions (the split unit is the study, not the arm or row)', () => {
    const armA = entry({ scenarioId: 'a', studies: ['trial-2019'], arms: ['low'] });
    const armB = entry({
      scenarioId: 'b',
      studies: ['trial-2019'],
      arms: ['high'],
      role: 'externalEvaluation',
      evidenceClass: 'externalEvaluation',
      evaluations: [frozen('9.9.9')],
    });
    expect(validateLedger([armA, armB], [sc('a'), sc('b')], '9.9.9').map((i) => i.kind)).toContain(
      'splitLeakage',
    );
  });

  it('detects missing dataset roles, tolerance types, inputs, entries and unfrozen evaluations', () => {
    const kinds = (es: LedgerEntry[], ids = es.map((e) => e.scenarioId)) =>
      validateLedger(es, ids.map(sc), '9.9.9').map((i) => i.kind);
    expect(kinds([entry({ scenarioId: 'a', role: null })])).toContain('missingRole');
    expect(kinds([entry({ scenarioId: 'a', tolerances: {} })])).toContain('missingTolerance');
    expect(kinds([entry({ scenarioId: 'a', tolerances: { x: { type: 'design', source: ' ' } } })])).toContain(
      'missingTolerance',
    );
    expect(
      kinds([entry({ scenarioId: 'a', inputs: { observed: [], protocol: [], imputed: [] } })]),
    ).toContain('missingInputs');
    expect(kinds([entry({ scenarioId: 'a', studies: [] })])).toContain('missingStudy');
    expect(kinds([], ['a'])).toContain('missingEntry');
    expect(
      kinds([
        entry({
          scenarioId: 'a',
          role: 'externalEvaluation',
          evidenceClass: 'externalEvaluation',
          evaluations: [{ ...frozen('9.9.9'), extractedAfterFreeze: false }],
        }),
      ]),
    ).toContain('unfrozenEvaluation');
  });

  it('the real ledger passes every check, records a typed tolerance per row and keeps imputed inputs visible', () => {
    expect(
      validateLedger(LEDGER, ALL_SCENARIOS, ENGINE_VERSION).filter((i) => i.severity !== 'warning'),
    ).toEqual([]);
    for (const e of LEDGER) {
      if (e.evidenceClass !== 'verification')
        expect(e.inputs.imputed.length + e.inputs.observed.length, e.scenarioId).toBeGreaterThan(0);
      for (const id of e.outcomes)
        expect(e.tolerances[id]!.source.length, `${e.scenarioId}/${id}`).toBeGreaterThan(0);
    }
  });
});

describe('evidence ledger: study identity and units', () => {
  it('parses author-year citations into stable study ids (particles, diacritics, two-author forms)', () => {
    expect(citedStudies('Longland et al. 2016 Am J Clin Nutr 103:738')).toEqual(['longland-2016']);
    expect(citedStudies('Yang & Van Itallie 1976 J Clin Invest')).toEqual(['yang-1976']);
    expect(citedStudies('Ogłodek et al. 2021 (dossier 20 ref [10])')).toEqual(['oglodek-2021']);
    expect(citedStudies('Van Itallie 1976')).toEqual(['van-itallie-1976']);
  });

  it('one study keeps one id across scenarios (Longland in the negative control and the protein scenario; Minnesota and its replay; CALERIE cohorts)', () => {
    const ids = (id: string) => LEDGER.find((e) => e.scenarioId === id)!.studies;
    expect(ids('O-2-negative-control-longland')).toEqual(['longland-2016']);
    expect(LEDGER.filter((e) => e.studies.includes('longland-2016')).length).toBeGreaterThanOrEqual(2);
    expect(ids('01-7.1-minnesota')).toEqual(['minnesota-1950']);
    expect(ids('01-7.1b-minnesota-matched')).toEqual(['minnesota-1950']);
    expect(ids('01-7.3-calerie1')).toEqual(['calerie-1']);
    expect(studiesOf({ id: 'x', title: 'CALERIE-2, 2 y', citation: 'Ravussin 2015', dossier: '01' })).toEqual(
      ['calerie-2'],
    );
  });

  it("every expectation states a unit from the suite's unit vocabulary (units verified)", () => {
    const UNIT =
      /^(kg|g|mg|g\/d|g\/kg\/d|g N|g N\/d|kcal|kcal\/d|kcal\/kg FFM\/d|kJ\/d|MJ\/d|%|% points|% diff|% of G_ref|% of goal 1|pts|ratio|mmol\/L|mmol\/kg|mmol\/L·h|mM|mg\/dL|µU\/mL|mU\/L|ng\/mL|g\/L|mmHg|cm|cm\/kg|h|d|wk|min|PAL|RQ|score|index|1|kcal\/d per kg|L|L\/d|mL\/kg\/min|steps|sets|kg\/wk|g\/d per kg|nmol\/L|pmol\/L|µmol\/L|ms|kcal\/h|g\/h|mmol|%E|times|fraction|frac|index points|mmol·h\/L|count|g N\/kg|kg\/d|mmHg\/kg|rel|k|cm\/%|prob|flag)$/;
    const bad: string[] = [];
    for (const s of ALL_SCENARIOS)
      for (const e of s.expectations) if (!UNIT.test(e.unit)) bad.push(`${s.id}/${e.id}: "${e.unit}"`);
    expect(bad).toEqual([]);
  });
});

describe('register metadata', () => {
  it('every gate-K row has an owner and a reason; every review-decision row names its decision', () => {
    for (const s of ALL_SCENARIOS)
      for (const e of s.expectations)
        if ((e.gate ?? s.gate) === 'K')
          expect(TRACKED_MISS_NOTES[`${s.id}/${e.id}`], `${s.id}/${e.id}`).toBeDefined();
    for (const [k, m] of Object.entries(KNOWN_MISSES))
      if (m.cause === 'reviewDecision') expect(m.decision, k).toMatch(/^D\d-\d{2}$/);
  });
});

describe('provider/consumer round trips (C1-C7) and idempotent migration', () => {
  it('the ledger survives JSON (reload, sync, import) unchanged and rebuilding it is idempotent', () => {
    const again = buildLedger(ALL_SCENARIOS, PARAMS.defs);
    expect(again).toEqual(LEDGER);
    const json = JSON.parse(JSON.stringify(LEDGER)) as LedgerEntry[];
    expect(json).toEqual(LEDGER);
    for (const e of json)
      expect(classFor(e, ENGINE_VERSION)).toBe(
        classFor(
          LEDGER.find((x) => x.scenarioId === e.scenarioId)!,
          ENGINE_VERSION,
        ),
      );
    // twice through JSON is the same as once (idempotent across repeated sync/import)
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it('the release summary keeps version and hash identity and counts every attempted row, unavailable and failed ones included', () => {
    const facts: RunFacts = {
      arms: 2,
      aborted: 1,
      modelLimit: 1,
      failedScenarios: 0,
      conservationViolations: 0,
      t0Gating: 0,
      t0Other: 0,
    };
    const sc = ALL_SCENARIOS.find((s) => s.id === 'O-1-bwp-man-m25')!;
    const base = {
      scenarioId: sc.id,
      dossier: sc.dossier,
      target: sc.target,
      title: sc.title,
      unit: 'kg',
      gate: 'M' as const,
      expected: '0 ± 1.5',
    };
    const outcomes = [
      { ...base, expectationId: 'bw182', label: 'a', measured: 0.4, error: 0.4, status: 'pass' as const },
      {
        ...base,
        expectationId: 'bw365',
        label: 'b',
        measured: Number.NaN,
        error: Number.NaN,
        status: 'no-data' as const,
      },
      {
        ...base,
        expectationId: 'fm182',
        label: 'c',
        measured: Number.NaN,
        error: Number.NaN,
        status: 'error' as const,
        errorMessage: 'x',
      },
      {
        ...base,
        expectationId: 'fm365',
        label: 'd',
        measured: Number.NaN,
        error: Number.NaN,
        status: 'skipped' as const,
      },
    ];
    const s = ledgerSummary(
      outcomes,
      [sc],
      LEDGER.filter((e) => e.scenarioId === sc.id),
      facts,
      META,
      {},
    );
    expect(s.modelVersion).toBe(ENGINE_VERSION);
    expect(s.contracts).toBe(CONTRACT_FINGERPRINT);
    expect(s.freezeHash).toBe(freezeHashOf(META, [sc]));
    const cd = s.classes.conditionalDynamics;
    expect([cd.pass, cd.noData, cd.error, cd.skipped, cd.expectations]).toEqual([1, 1, 1, 1, 4]);
    expect(s.noData).toEqual([`${sc.id}/bw365`]);
    expect(s.errors).toEqual([`${sc.id}/fm182`]);
    expect([s.runs.aborted, s.runs.modelLimit]).toEqual([1, 1]);
    const json = releaseLedgerJson(
      s,
      LEDGER.filter((e) => e.scenarioId === sc.id),
    );
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    expect(s.coverage.available).toBe(false);
  });

  it('engine run metadata the reports read round-trips: contract fingerprint, per-series status and its fields, applied offsets', () => {
    const rp = resolveProfile(MAN);
    const cs = compileSchedule(constantSchedule(10, pctProgram('m', 90, neutralMacros('male'))), rp);
    const r = runEngine(rp, cs, {
      record: 'daily',
      burnInDays: 14,
      intakeOffsetKcal: [{ fromDay: 2, kcal: -100 }],
    });
    expect(r.meta.contracts).toBe(CONTRACT_FINGERPRINT);
    const meta = JSON.parse(JSON.stringify(r.meta)) as typeof r.meta;
    expect(meta.contracts).toBe(r.meta.contracts);
    expect(meta.outputStatus).toEqual(r.meta.outputStatus);
    expect(meta.offsetsApplied).toEqual(r.meta.offsetsApplied);
    expect(meta.validity).toEqual(r.meta.validity);
    // an applied offset is booked per day with its request; absent days stay absent (unknown is not zero)
    const applied = meta.offsetsApplied ?? [];
    expect(applied.length).toBeGreaterThan(0);
    for (const a of applied)
      expect(Number.isFinite(a.requestedKcal) && Number.isFinite(a.appliedKcal)).toBe(true);
    expect(applied.every((a) => a.day >= 2)).toBe(true);
  });
});
