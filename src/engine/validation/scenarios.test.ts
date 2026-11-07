// @vitest-environment node
/**
 * Runs every §9.2 scenario through the real engine and reports one table (WP-V).
 *
 *  - Regenerate the report:   pnpm vitest run src/engine/validation --reporter=verbose
 *  - Measure a half-finished engine anyway:   ENGINE_VALIDATION=force pnpm vitest run src/engine/validation
 *  - Whole-engine acceptance (gate only when all 16 modules exist): ENGINE_VALIDATION=complete pnpm vitest run src/engine/validation
 *
 * While any module is still a stub (`harness/stubs.ts`) the gating assertions are SKIPPED (`it.skipIf`) but the scenarios still run
 * and the table still prints, so the suite stays green and shows exactly what each finished module will be held to.
 * Gate semantics: M must pass, K is a tracked known miss (never fails), Q is qualitative (never fails). See harness/types.ts.
 *
 * D8-03 (review release): every scenario has an evidence-ledger entry (`ledger.ts`): verification, conditional dynamics,
 * development fit or independent empirical validation. The last tests print the regenerated KNOWN_MISSES.md, the release
 * ledger and the evidence-class section between BEGIN/END markers and fail when the committed files no longer match this
 * run (the files are updated from the printed text; the suite never writes them). Review-decision misses are re-run under
 * the labelled legacy scenario they name, which must still meet the target (D1-07, D3-08, D6-08, D7-07, D7-08).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ALL_SCENARIOS } from './scenarios';
import { describeOutcome, formatMarkdown, formatTable, tally } from './harness/report';
import { evaluateScenario, runScenario, type ScenarioRun } from './harness/run';
import { missingModules, readinessSummary, scenarioReady, stubModules } from './harness/stubs';
import type { Outcome, Scenario } from './harness/types';
import type { ArmView } from './harness/view';
import { KNOWN_MISSES } from './knownMisses';
import { buildLedger, validateLedger } from './ledger';
import {
  knownMissesMarkdown,
  ledgerMarkdown,
  ledgerSummary,
  releaseLedgerJson,
  type RunFacts,
} from './harness/ledgerReport';
import { ENGINE_VERSION } from '../core/defaults';
import { MODULES } from '../core/moduleRegistry';
import { buildModelParams } from '../core/paramsRegistry';
import { CONTRACT_FINGERPRINT } from '../../lib/bodyContracts';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PARAMS = buildModelParams(MODULES);
const LEDGER = buildLedger(ALL_SCENARIOS, PARAMS.defs);
const META = {
  modelVersion: ENGINE_VERSION,
  registryHash: PARAMS.registryHash,
  contracts: CONTRACT_FINGERPRINT,
};

// The first test of the file runs every scenario (several seconds); the default 5 s timeout is too short.
vi.setConfig({ testTimeout: 180_000 });

const cache = new Map<string, { run: ScenarioRun; outcomes: Outcome[] }>();

function resultOf(sc: Scenario): { run: ScenarioRun; outcomes: Outcome[] } {
  let r = cache.get(sc.id);
  if (!r) {
    const run = runScenario(sc);
    r = { run, outcomes: evaluateScenario(run) };
    cache.set(sc.id, r);
  }
  return r;
}

function outcomeOf(sc: Scenario, expectationId: string): Outcome {
  const o = resultOf(sc).outcomes.find((x) => x.expectationId === expectationId);
  if (!o) throw new Error(`no outcome ${sc.id}/${expectationId}`);
  return o;
}

describe('scenario registry', () => {
  it('has unique scenario ids and unique expectation ids per scenario', () => {
    const ids = ALL_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ALL_SCENARIOS) {
      const e = s.expectations.map((x) => x.id);
      expect(new Set(e).size, s.id).toBe(e.length);
      expect(s.expectations.length, s.id).toBeGreaterThan(0);
      expect(Object.keys(s.arms).length, s.id).toBeGreaterThan(0);
    }
  });

  it('every scenario compiles through the real schedule compiler and runs without throwing (stubs included)', () => {
    const failed: string[] = [];
    for (const s of ALL_SCENARIOS) {
      const r = resultOf(s).run;
      if (!r.views) failed.push(`${s.id}: ${r.error}`);
    }
    expect(failed).toEqual([]);
  });

  it('every expectation measures a finite number once the engine is running', () => {
    // With stub modules some series are constants, but every requested series must exist and be finite.
    const bad: string[] = [];
    for (const s of ALL_SCENARIOS) {
      if (!scenarioReady(s.requires)) continue;
      for (const o of resultOf(s).outcomes)
        if (o.status === 'no-data' || o.status === 'error') bad.push(describeOutcome(o));
    }
    expect(bad).toEqual([]);
  });
});

describe('§9.2 dossier targets', () => {
  for (const sc of ALL_SCENARIOS) {
    const ready = scenarioReady(sc.requires);
    describe(`${sc.dossier} ${sc.target} ${sc.title}${ready ? '' : ` [waiting for: ${missingModules(sc.requires).join(', ')}]`}`, () => {
      for (const ex of sc.expectations) {
        const gate = ex.gate ?? sc.gate;
        const km = KNOWN_MISSES[`${sc.id}/${ex.id}`];
        if (gate === 'M' && km) {
          // registered miss (knownMisses.ts): expected to fail; passing turns this red → delete the register entry
          (ready ? it.fails : it.skip)(
            `[M, ${km.cls === 'K' ? 'known miss' : 'open calibration'} · ${km.owner} · ${km.cause}] ${ex.label}`,
            () => {
              const o = outcomeOf(sc, ex.id);
              expect(o.status, describeOutcome(o)).toBe('pass');
            },
          );
        } else if (gate === 'M') {
          it.skipIf(!ready)(`[M] ${ex.label}`, () => {
            const o = outcomeOf(sc, ex.id);
            expect(o.status, describeOutcome(o)).toBe('pass');
          });
        } else if (gate === 'K') {
          // tracked known miss (§9 gate K): expected to miss; when it enters its band this turns red → promote it to M
          (ready ? it.fails : it.skip)(`[K] ${ex.label}`, () => {
            const o = outcomeOf(sc, ex.id);
            expect(o.status, describeOutcome(o)).toBe('now-passing');
          });
        } else {
          it.skipIf(!ready)(`[${gate}] ${ex.label} (non-gating)`, () => {
            const o = outcomeOf(sc, ex.id);
            expect(o.status, describeOutcome(o)).not.toBe('error');
          });
        }
      }
    });
  }
});

describe('known-miss register (knownMisses.ts)', () => {
  it('every entry names an existing must-pass expectation', () => {
    const stale: string[] = [];
    for (const key of Object.keys(KNOWN_MISSES)) {
      const [sid, eid] = key.split('/') as [string, string];
      const sc = ALL_SCENARIOS.find((s) => s.id === sid);
      const ex = sc?.expectations.find((e) => e.id === eid);
      if (!sc || !ex) stale.push(`${key}: no such expectation`);
      else if ((ex.gate ?? sc.gate) !== 'M') stale.push(`${key}: gate is ${ex.gate ?? sc.gate}, not M`);
    }
    expect(stale).toEqual([]);
  });
});

describe('review-decision misses stay attributable (knownMisses.ts legacyScenario)', () => {
  // Each row a 2026-10-18 review decision turned into a miss met its target under the labelled legacy scenario it names.
  // Re-running that scenario keeps the cause checkable: if the row stops passing there, the miss has another cause and
  // the register entry is wrong. Meeting a target under a scenario fitted to the same study is development, not validation.
  const rows = Object.entries(KNOWN_MISSES).filter(
    ([, m]) => m.cause === 'reviewDecision' && m.legacyScenario,
  );
  it.each(rows.map(([k, m]) => [k, m.decision ?? '?', m] as const))(
    '%s (%s) meets its target under the legacy scenario',
    (key, _d, m) => {
      const [sid, eid] = key.split('/') as [string, string];
      const sc = ALL_SCENARIOS.find((x) => x.id === sid)!;
      expect(sc, key).toBeDefined();
      if (!scenarioReady(sc.requires)) return;
      const values = Float64Array.from(PARAMS.values);
      for (const [id, v] of Object.entries(m.legacyScenario!)) {
        const i = PARAMS.index.get(id);
        expect(i, `${key}: unknown parameter ${id}`).toBeDefined();
        values[i!] = v;
      }
      const arms = Object.fromEntries(
        Object.entries(sc.arms).map(([a, spec]) => [
          a,
          { ...spec, options: { ...(spec.options ?? {}), paramOverrides: values } },
        ]),
      );
      const alt = evaluateScenario(runScenario({ ...sc, arms })).find((o) => o.expectationId === eid)!;
      expect(alt.status, describeOutcome(alt)).toBe('pass');
      // and the standard projection still misses (otherwise the register entry is stale and the it.fails above turns red)
      expect(outcomeOf(sc, eid).status).toBe('miss');
    },
  );
});

describe('validation evidence ledger (D8-03)', () => {
  it('every scenario has an entry with study ids, a role or class, visible inputs and a typed, sourced tolerance per row; no study-level split leakage', () => {
    expect(
      validateLedger(LEDGER, ALL_SCENARIOS, ENGINE_VERSION)
        .filter((i) => i.severity !== 'warning')
        .map((i) => `${i.scenarioId} ${i.kind}: ${i.detail}`),
    ).toEqual([]);
  });

  it('historical scenarios are development unless provenance establishes independence: this release has no independent holdout', () => {
    expect(LEDGER.filter((e) => e.evidenceClass === 'externalEvaluation')).toEqual([]);
    for (const e of LEDGER.filter((x) => x.evidenceClass === 'developmentFit')) {
      expect(e.role === 'estimation' || e.role === 'calibration', e.scenarioId).toBe(true);
      if (e.role === 'estimation') expect(e.influenced.length, e.scenarioId).toBeGreaterThan(0);
    }
  });

  it('shared-input oracle comparisons and model-value tables are conditional dynamics, never counted as human validation', () => {
    const cd = LEDGER.filter((e) => e.evidenceClass === 'conditionalDynamics').map((e) => e.scenarioId);
    for (const id of cd) expect(/^O-[123]|^20-4B3/.test(id), id).toBe(true);
    expect(cd).toContain('O-1-bwp-man-m25');
    expect(cd).toContain('O-3-carb-30pct');
  });

  it('D1-08: the Minnesota fixture is a mismatched-protocol challenge, its matched-input replay is labelled matched', () => {
    const byId = (id: string) => LEDGER.find((e) => e.scenarioId === id)!;
    expect(byId('01-7.1-minnesota').protocolFidelity).toBe('mismatched');
    expect(byId('01-7.1b-minnesota-matched').protocolFidelity).toBe('matched');
    expect(byId('01-7.1b-minnesota-matched').inputs.imputed.length).toBeGreaterThan(1);
    expect(byId('01-7.1-minnesota').studies).toEqual(byId('01-7.1b-minnesota-matched').studies);
  });
});

describe('conservation in every scenario arm (O-4, O-5)', () => {
  it('structural identities hold: hourly energy ≤ 1e-6 kcal, daily energy ≤ 1 kcal, scale = FM + FFM + labile water ≤ 1e-9 kg (runs for real)', () => {
    const bad: string[] = [];
    for (const s of ALL_SCENARIOS) {
      const r = resultOf(s).run;
      if (!r.views) continue;
      for (const [id, v] of Object.entries(r.views)) {
        const c = v.result.meta.checks;
        if (!c) {
          bad.push(`${s.id}/${id}: checks missing`);
          continue;
        }
        if (!(c.energyMaxAbsKcal <= 1e-6))
          bad.push(`${s.id}/${id}: hourly energy residual ${c.energyMaxAbsKcal}`);
        if (!(c.energyDayMaxAbsKcal <= 1))
          bad.push(`${s.id}/${id}: daily energy residual ${c.energyDayMaxAbsKcal}`);
        if (!(c.massMaxAbsKg <= 1e-9)) bad.push(`${s.id}/${id}: mass residual ${c.massMaxAbsKg}`);
      }
    }
    expect(bad).toEqual([]);
  });

  // O-5 second half (morning anchor, orchestrator ruling 2026-09-30): the entered weight is a wake-hour weight, so the day-0
  // wake-hour scale weight equals it — for every arm whose day 0 continues the habitual night up to the wake hour. Arms
  // whose plan changes that night (a fast overlay from 00:00, food or exercise before waking, another wake time) are listed
  // in the report but do not gate: their day-0 morning legitimately differs. Physiology-dependent, so it gates with the M rows.
  it.skipIf(!scenarioReady(ALL_SCENARIOS.flatMap((s) => s.requires)))(
    'day-0 wake-hour scale weight equals the entered weight ± 0.05 kg in every arm with a habitual first night (O-5)',
    () => {
      expect(t0Violations().gating).toEqual([]);
    },
  );
});

/** Day 0 continues the habitual night until the wake hour: no fast span, meal or session before it, habitual wake time. */
function habitualFirstNight(v: ArmView): boolean {
  const day = v.compiled.days[0];
  if (!day) return false;
  const weighIn = Math.ceil(day.sleepWakeH); // clock time of the morning weigh-in (core/math.wakeRecordHour)
  if (weighIn !== Math.ceil(v.profile.habits.wakeTimeH)) return false;
  if (v.compiled.fastSpans.some((f) => f.startHour < weighIn && f.endHour > 0)) return false;
  for (let i = 0; i < day.nMeals; i++) if (day.meals[i]!.clockH < weighIn) return false;
  for (let i = 0; i < day.nSessions; i++) if (day.sessions[i]!.startH < weighIn) return false;
  return true;
}

function t0Violations(): { gating: string[]; other: string[] } {
  const gating: string[] = [];
  const other: string[] = [];
  for (const s of ALL_SCENARIOS) {
    const r = resultOf(s).run;
    if (!r.views) continue;
    for (const [id, v] of Object.entries(r.views)) {
      const err = v.result.meta.checks?.t0WeightErrKg ?? Number.NaN;
      if (Math.abs(err) <= 0.05) continue;
      const line = `${s.id}/${id}: day-0 wake scale ${(v.profile.weightKg + err).toFixed(3)} kg vs entered ${v.profile.weightKg} kg`;
      (habitualFirstNight(v) ? gating : other).push(line);
    }
  }
  return { gating, other };
}

/** Run facts outside the rows (D8-03: aborted and model-limit runs are reported, never dropped). */
function runFacts(): RunFacts {
  let arms = 0;
  let aborted = 0;
  let modelLimit = 0;
  let failed = 0;
  let conservation = 0;
  for (const s of ALL_SCENARIOS) {
    const r = resultOf(s).run;
    if (!r.views) {
      failed++;
      continue;
    }
    for (const v of Object.values(r.views)) {
      arms++;
      if (v.result.meta.aborted) aborted++;
      if (v.result.meta.validity?.status === 'modelLimit') modelLimit++;
      const c = v.result.meta.checks;
      if (!c || !(c.energyMaxAbsKcal <= 1e-6) || !(c.energyDayMaxAbsKcal <= 1) || !(c.massMaxAbsKg <= 1e-9))
        conservation++;
    }
  }
  const t0 = t0Violations();
  return {
    arms,
    aborted,
    modelLimit,
    failedScenarios: failed,
    conservationViolations: conservation,
    t0Gating: t0.gating.length,
    t0Other: t0.other.length,
  };
}

function allOutcomes(): Outcome[] {
  const outcomes: Outcome[] = [];
  for (const s of ALL_SCENARIOS) outcomes.push(...resultOf(s).outcomes);
  return outcomes;
}

const readDoc = (f: string): string | null => {
  try {
    return fs.readFileSync(path.join(ROOT, f), 'utf8');
  } catch {
    return null;
  }
};

describe('validation report', () => {
  it('prints the scenario table (regenerates the KNOWN_MISSES data)', () => {
    const outcomes: Outcome[] = [];
    for (const s of ALL_SCENARIOS) outcomes.push(...resultOf(s).outcomes);
    const header = {
      title: `Vitals engine validation: ${ALL_SCENARIOS.length} scenarios, ${outcomes.length} expectations`,
      readiness: readinessSummary(),
      placeholder: stubModules().length > 0,
    };
    console.log(formatTable(outcomes, header));
    const t = tally(outcomes);
    const t0 = t0Violations();
    console.log(
      [
        `O-5 day-0 wake-hour scale-weight violations (> 0.05 kg from the entered weight), arms with a habitual first night: ${t0.gating.length}${t0.gating.length ? '\n  ' + t0.gating.slice(0, 12).join('\n  ') : ''}`,
        `   arms whose plan changes the first night (fast from 00:00, food/exercise before waking, other wake time; not gating): ${t0.other.length}${t0.other.length ? '\n  ' + t0.other.join('\n  ') : ''}`,
        `gating misses: ${t.miss}   known misses: ${t['known-miss']}   now passing (promote K to M): ${t['now-passing']}   no data: ${t['no-data']}   errors: ${t.error}`,
        'Markdown form of the K / miss rows for KNOWN_MISSES.md:',
        formatMarkdown(
          outcomes.filter(
            (o) => o.status === 'known-miss' || o.status === 'miss' || o.status === 'now-passing',
          ),
          header,
        ),
      ].join('\n'),
    );
    expect(outcomes.length).toBeGreaterThan(0);
  });
});

describe('regenerated reports derive from this run (D8-03)', () => {
  // Engine-complete runs only: with stub modules the numbers are placeholders and the committed files describe the engine.
  const complete = scenarioReady(ALL_SCENARIOS.flatMap((s) => s.requires));

  it('prints KNOWN_MISSES.md, the release ledger and the evidence-class section (capture blocks)', () => {
    const outcomes = allOutcomes();
    const summary = ledgerSummary(outcomes, ALL_SCENARIOS, LEDGER, runFacts(), META);
    console.log(
      ['BEGIN known-misses', knownMissesMarkdown(outcomes, summary), 'END known-misses'].join('\n'),
    );
    console.log(
      [
        'BEGIN release-ledger',
        JSON.stringify(releaseLedgerJson(summary, LEDGER), null, 1),
        'END release-ledger',
      ].join('\n'),
    );
    console.log(['BEGIN evidence-classes', ledgerMarkdown(summary), 'END evidence-classes'].join('\n'));
    // every attempted row is accounted for, including unavailable and failed ones
    const t = summary.classes;
    const rows = Object.values(t).reduce((a, c) => a + c.expectations, 0);
    expect(rows).toBe(outcomes.length);
    expect(summary.gates.M.rows + summary.gates.K.rows + summary.gates.Q.rows).toBe(outcomes.length);
  });

  it.skipIf(!complete)(
    'the committed release ledger, KNOWN_MISSES.md and both validation reports match this run',
    () => {
      const outcomes = allOutcomes();
      const summary = ledgerSummary(outcomes, ALL_SCENARIOS, LEDGER, runFacts(), META);
      const json = releaseLedgerJson(summary, LEDGER);
      const committed = readDoc('docs/validation/review-release-ledger.json');
      expect(
        committed,
        'docs/validation/review-release-ledger.json is missing: paste the release-ledger block',
      ).not.toBeNull();
      expect(
        JSON.parse(committed!),
        'docs/validation/review-release-ledger.json is stale: paste the release-ledger block printed above',
      ).toEqual(JSON.parse(JSON.stringify(json)));
      expect(
        readDoc('src/engine/validation/KNOWN_MISSES.md'),
        'KNOWN_MISSES.md is stale: paste the known-misses block printed above',
      ).toBe(knownMissesMarkdown(outcomes, summary));
      // headline counts of the internal and the public report come from the same outcomes
      const m = summary.gates.M;
      for (const f of ['docs/VALIDATION_REPORT_INTERNAL.md', 'docs/VALIDATION_REPORT.md']) {
        const text = readDoc(f) ?? '';
        expect(text, f).toContain(`${summary.scenarios} scenarios, ${summary.expectations} expectations`);
        expect(text, f).toContain(`**${m.pass} of ${m.rows} met**`);
        expect(text, f).toContain(`${summary.gates.Q.inDirection} of ${summary.gates.Q.rows}`);
      }
      expect(
        readDoc('docs/VALIDATION_REPORT_INTERNAL.md'),
        'internal report: paste the evidence-classes block',
      ).toContain(ledgerMarkdown(summary));
      // the public "How each result counts" table carries the same per-class numbers in plain words
      const pub = readDoc('docs/VALIDATION_REPORT.md') ?? '';
      const PUBLIC_CLASS = {
        verification: 'software and physics checks',
        conditionalDynamics: 'reference-model comparisons',
        developmentFit: 'fits to the studies the model was built from',
        externalEvaluation: 'comparisons with studies the model never saw',
      } as const;
      for (const [c, name] of Object.entries(PUBLIC_CLASS) as [keyof typeof PUBLIC_CLASS, string][]) {
        const t = summary.classes[c];
        expect(pub, `public evidence-kind row ${name}`).toContain(
          `| ${name} | ${t.scenarios} | ${t.studies} | ${t.expectations} | ${t.pass} | ${t.registeredMiss + t.unregisteredMiss} |`,
        );
      }
    },
  );
});
