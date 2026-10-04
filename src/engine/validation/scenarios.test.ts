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
 */
import { ALL_SCENARIOS } from './scenarios';
import { describeOutcome, formatMarkdown, formatTable, tally } from './harness/report';
import { evaluateScenario, runScenario, type ScenarioRun } from './harness/run';
import { missingModules, readinessSummary, scenarioReady, stubModules } from './harness/stubs';
import type { Outcome, Scenario } from './harness/types';
import type { ArmView } from './harness/view';
import { KNOWN_MISSES } from './knownMisses';

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
      for (const o of resultOf(s).outcomes) if (o.status === 'no-data' || o.status === 'error') bad.push(describeOutcome(o));
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
          (ready ? it.fails : it.skip)(`[M, ${km.cls === 'K' ? 'known miss' : 'open calibration'} · ${km.owner} · ${km.cause}] ${ex.label}`, () => {
            const o = outcomeOf(sc, ex.id);
            expect(o.status, describeOutcome(o)).toBe('pass');
          });
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
        if (!(c.energyMaxAbsKcal <= 1e-6)) bad.push(`${s.id}/${id}: hourly energy residual ${c.energyMaxAbsKcal}`);
        if (!(c.energyDayMaxAbsKcal <= 1)) bad.push(`${s.id}/${id}: daily energy residual ${c.energyDayMaxAbsKcal}`);
        if (!(c.massMaxAbsKg <= 1e-9)) bad.push(`${s.id}/${id}: mass residual ${c.massMaxAbsKg}`);
      }
    }
    expect(bad).toEqual([]);
  });

  // O-5 second half (morning anchor, orchestrator ruling 2026-09-30): the entered weight is a wake-hour weight, so the day-0
  // wake-hour scale weight equals it — for every arm whose day 0 continues the habitual night up to the wake hour. Arms
  // whose plan changes that night (a fast overlay from 00:00, food or exercise before waking, another wake time) are listed
  // in the report but do not gate: their day-0 morning legitimately differs. Physiology-dependent, so it gates with the M rows.
  it.skipIf(!scenarioReady(ALL_SCENARIOS.flatMap((s) => s.requires)))('day-0 wake-hour scale weight equals the entered weight ± 0.05 kg in every arm with a habitual first night (O-5)', () => {
    expect(t0Violations().gating).toEqual([]);
  });
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

describe('validation report', () => {
  it('prints the scenario table (regenerates the KNOWN_MISSES data)', () => {
    const outcomes: Outcome[] = [];
    for (const s of ALL_SCENARIOS) outcomes.push(...resultOf(s).outcomes);
    const header = { title: `Vitals engine validation: ${ALL_SCENARIOS.length} scenarios, ${outcomes.length} expectations`, readiness: readinessSummary(), placeholder: stubModules().length > 0 };
    console.log(formatTable(outcomes, header));
    const t = tally(outcomes);
    const t0 = t0Violations();
    console.log(
      [
        `O-5 day-0 wake-hour scale-weight violations (> 0.05 kg from the entered weight), arms with a habitual first night: ${t0.gating.length}${t0.gating.length ? '\n  ' + t0.gating.slice(0, 12).join('\n  ') : ''}`,
        `   arms whose plan changes the first night (fast from 00:00, food/exercise before waking, other wake time; not gating): ${t0.other.length}${t0.other.length ? '\n  ' + t0.other.join('\n  ') : ''}`,
        `gating misses: ${t.miss}   known misses: ${t['known-miss']}   now passing (promote K to M): ${t['now-passing']}   no data: ${t['no-data']}   errors: ${t.error}`,
        'Markdown form of the K / miss rows for KNOWN_MISSES.md:',
        formatMarkdown(outcomes.filter((o) => o.status === 'known-miss' || o.status === 'miss' || o.status === 'now-passing'), header),
      ].join('\n'),
    );
    expect(outcomes.length).toBeGreaterThan(0);
  });
});
