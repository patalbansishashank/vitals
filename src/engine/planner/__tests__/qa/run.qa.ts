// @vitest-environment node
/**
 * QA pass 2 planner runs (release gate v0.2): one full app-path planner run per request (`runLadderPlanner`, tier M,
 * ladder, Ideal, limit costs and time to target on, in-process), digested to qa/results/q2/planner/<key>.json; each
 * rung's schedule is replayed through the Simulator's own `simulate` call, as "Start this plan" would see it. The
 * checks read the digests (`checks.qa.ts`). Select requests with QA_KEYS=a,c,fuzz3 (default: all of `QA_KEYS`).
 * Run: pnpm vitest run --config src/engine/planner/__tests__/qa/vitest.qa.config.ts run.qa
 * QA_OUT_DIR=qa/results/e5b/planner writes elsewhere; QA_NO_BAND=1 turns the Medium band search (PLN-06) off.
 */
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'vitest';
import { simulate } from '../../../simulate';
import { toV1Result } from '../../domain/compat';
import { compileRequest } from '../../domain/context';
import { fastingKind } from '../../domain/fastMath';
import { runLadderPlanner } from '../../domain/ladderPlanner';
import { listableWarning } from '../../domain/planner';
import type { PlannerRequestV2, RungPlan } from '../../domain/types';
import type { PlannerResult } from '../../optim/pipeline';
import { OUT_DIR, QA_KEYS, qaRequest } from './requests';

const r3 = (v: number) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);

function rungDigest(req: PlannerRequestV2, r: RungPlan | NonNullable<Awaited<ReturnType<typeof runLadderPlanner>>['ideal']>) {
  const ctx = compileRequest(req);
  const sim = simulate({ ...req.profile, startDate: req.startDate ?? req.profile.startDate }, r.schedule, { record: 'full' });
  const warnings = sim.warnings
    .filter((w) => w.severity !== 'info')
    .map((w) => ({ id: w.id, severity: w.severity, days: `${w.startDay + 1}-${w.endDay + 1}`, listable: listableWarning(ctx, r.schedule, w.id) }));
  const s = r.summary;
  return {
    title: s.title,
    subtitle: s.subtitle,
    D: r3(s.difficulty.D),
    components: Object.fromEntries(s.difficulty.components.map((c) => [c.id, r3(c.value)])),
    outcomes: s.outcomes.map((o) => ({ label: o.label, unit: o.unit, start: r3(o.start), p50: r3(o.p50), change: r3(o.change), vsHard: r3(o.vsHard), pct: r3(o.percentOfAchievable), verdict: o.verdict })),
    fasting: { used: s.fasting.used, kind: fastingKind(r.schedule), longestFastH: s.fasting.longestFastH ?? 0, text: s.fasting.text, rival: s.fasting.rival ? { kind: s.fasting.rival.kind, longestFastH: s.fasting.rival.longestFastH, reason: s.fasting.rival.reason, detail: s.fasting.rival.detail } : null },
    explanation: r.explanation,
    safetyNotes: (r.safetyItems ?? []).map((x) => ({ rule: x.rule, severity: x.severity })),
    simulatorWarnings: warnings,
  };
}

const keys = (process.env['QA_KEYS'] ?? QA_KEYS.join(',')).split(',').filter(Boolean);

for (const key of keys)
  it(`planner run ${key}`, async () => {
    const req = qaRequest(key);
    const t0 = performance.now();
    const hold: { optim: PlannerResult<unknown> | null } = { optim: null };
    const v2 = await runLadderPlanner(req, { tier: 'M', onOptimResult: (r) => (hold.optim = r), ...(process.env['QA_NO_BAND'] ? { pipeline: { mediumBand: false } } : {}) });
    const wallMs = Math.round(performance.now() - t0);
    const optim = hold.optim;
    const v1 = toV1Result(v2);
    const I = v2.ideal;
    const digest = {
      key,
      tier: 'M',
      wallMsInProcess: wallMs,
      goals: req.goals.map((g) => `${g.direction} ${g.metric}${g.target !== undefined ? ` ${g.target}` : ''}`),
      status: v2.status,
      message: v2.message,
      fastingGate: v2.fasting,
      ladder: {
        collapsed: v2.ladder.collapsed,
        checks: v2.ladder.checks,
        frontierPoints: v2.ladder.frontier.length,
        // optimiser view (PLN-06): collapse details, pairwise Gower of the solved rungs, the Medium band search
        collapsedDetail: optim?.ladder?.collapsed ?? null,
        gower: optim?.ladder?.gower ?? null,
        mediumBand: optim?.ladder?.mediumBand ?? null,
        bandEU: optim?.provenance.stageEU['S5.band'] ?? 0,
      },
      rungs: Object.fromEntries(Object.entries(v2.rungs).map(([k, r]) => [k, rungDigest(req, r!)])),
      v1OptionIds: v1.options.map((o) => o.id),
      ideal: I
        ? {
            ...rungDigest(req, I),
            relaxed: I.relaxed,
            nothingBinds: I.nothingBinds,
            gapVsHard: I.gapVsHard.map((g) => ({ ...g, delta: r3(g.delta) })),
            interactionRemainder: I.interactionRemainder.map((g) => ({ ...g, delta: r3(g.delta) })),
            limitCosts: I.limitCosts.map((c) => ({ group: c.group, current: c.current, relaxedTo: c.relaxedTo, deltas: c.deltas.map((d) => ({ ...d, delta: r3(d.delta) })), text: c.text })),
          }
        : null,
    };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, `${key}.json`), `${JSON.stringify(digest, null, 1)}\n`);
  }, 3 * 3600_000);
