/**
 * Keeps the activity intake snapshot (what the validation page shows) in step with the validation suite: re-runs the
 * suite's activity-intake rows, compares them with `activityIntake.snapshot.json`, and checks every row has copy.
 * Regenerate after an intended change: `VITALS_UPDATE_SNAPSHOTS=1 pnpm vitest run src/content/evidence/validation`.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateScenario, runScenario } from '@/engine/validation/harness/run';
import { KNOWN_MISSES } from '@/engine/validation/knownMisses';
import { SCENARIOS_ACTIVITY_INTAKE } from '@/engine/validation/scenarios/activityIntake';
import {
  ACTIVITY_INTAKE_GROUPS,
  ACTIVITY_INTAKE_MISS_REASONS,
  ACTIVITY_INTAKE_SNAPSHOT,
  activityIntakeGroups,
  type ActivityIntakeSnapshot,
} from '../activityIntake';

const SNAPSHOT_FILE = resolve(process.cwd(), 'src/content/evidence/validation/activityIntake.snapshot.json');

function runSuite(): ActivityIntakeSnapshot {
  const rows = SCENARIOS_ACTIVITY_INTAKE.flatMap((sc) => evaluateScenario(runScenario(sc))).map((o) => {
    const key = `${o.scenarioId}/${o.expectationId}`;
    const miss = KNOWN_MISSES[key];
    return {
      key,
      measured: Number(o.measured.toPrecision(6)),
      unit: o.unit,
      expected: o.expected,
      status: o.status,
      ...(miss ? { knownMiss: miss.cls === 'open' ? ('open' as const) : ('accepted' as const) } : {}),
    };
  });
  return { generated: new Date().toISOString().slice(0, 10), rows };
}

describe('activity intake validation snapshot', () => {
  const fresh = runSuite();

  it('matches a fresh run of the suite (regenerate when the model changes on purpose)', () => {
    if (process.env.VITALS_UPDATE_SNAPSHOTS) writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(fresh, null, 2)}\n`);
    const stored = process.env.VITALS_UPDATE_SNAPSHOTS ? fresh : ACTIVITY_INTAKE_SNAPSHOT;
    expect(stored.rows.map((r) => r.key)).toEqual(fresh.rows.map((r) => r.key));
    fresh.rows.forEach((r, i) => {
      const s = stored.rows[i]!;
      expect({ ...s, measured: 0 }, r.key).toEqual({ ...r, measured: 0 });
      expect(Math.abs(s.measured - r.measured), r.key).toBeLessThanOrEqual(1e-4 * Math.max(1, Math.abs(r.measured)));
    });
  }, 120_000);

  it('labels every row of the suite, and only rows that exist', () => {
    const keys = new Set(fresh.rows.map((r) => r.key));
    const labelled = ACTIVITY_INTAKE_GROUPS.flatMap((g) => Object.keys(g.rows).map((id) => `${g.scenarioId}/${id}`));
    expect([...keys].filter((k) => !labelled.includes(k))).toEqual([]);
    expect(labelled.filter((k) => !keys.has(k))).toEqual([]);
    expect(activityIntakeGroups().flatMap((g) => g.rows)).toHaveLength(keys.size);
  });

  it('explains every row that misses, and only those', () => {
    const missing = activityIntakeGroups()
      .flatMap((g) => g.rows)
      .filter((r) => r.verdict !== 'pass');
    expect(missing.filter((r) => !r.reason).map((r) => r.key)).toEqual([]);
    expect(missing.some((r) => r.verdict === 'miss')).toBe(false);
    const stale = Object.keys(ACTIVITY_INTAKE_MISS_REASONS).filter((k) => !missing.some((r) => r.key === k));
    expect(stale).toEqual([]);
  });
});
