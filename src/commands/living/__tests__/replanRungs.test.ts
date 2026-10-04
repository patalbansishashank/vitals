/**
 * Q4-09: every rung the Coach can start must stay adaptable. On the Medium and Hard plans of a 6 kg fat-loss ladder
 * every training-day change was refused as "no safe plan", even a re-plan with nothing changed; Easy accepted them.
 * The fixture holds the plans as the Coach started them (qa/scripts/Q4b/export-rungs.mjs). The Ideal cannot be started
 * as a plan; on this ladder it is the same as Hard (ladder.ideal.sameAsHard), so the Hard plan stands for it.
 * Cause: Hard and Medium carry a 24-h fast from Monday 19:30 to Tuesday 19:30; the Monday-Tuesday swap moved it over
 * Wednesday's session (src/living/edits.ts shiftEdit; see src/living/__tests__/swapEdit.test.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDocumentStore, createMemoryBackend, mintWriteToken } from '@/store';
import { getDocumentStore, setDocumentStore } from '@/state/runtime';
import { dispatch, type CommandResult } from '@/commands';
import { installLivingPorts } from '@/commands/livingWiring';
import { replan } from '@/engine/planner/domain/replan';
import type { AdaptOutput } from '@/commands/living/adapt';

type Docs = Record<'plans' | 'planVersions' | 'activePlan', Array<Record<string, unknown>>>;
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/q4b-rungs.json'), 'utf8')) as Record<'hard' | 'medium' | 'easy', Docs>;
const TODAY = '2026-10-02';

beforeAll(() => {
  installLivingPorts({ planner: { replan: (req, o) => replan(req, { tier: o?.tier ?? 'S' }) } });
});
afterEach(() => {
  vi.useRealTimers();
});

async function seed(docs: Docs): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'testdevice000004' }), validation: 'off' }));
  const store = getDocumentStore();
  await store.ready;
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    for (const d of docs.plans) await tx.put('plans', d as never);
    for (const d of docs.planVersions) await tx.append('planVersions', d as never);
    for (const d of docs.activePlan) await tx.put('activePlan', d as never);
  });
}

const out = (r: CommandResult): AdaptOutput => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as AdaptOutput;
};

describe.each([
  ['Hard', 'hard'],
  ['Medium', 'medium'],
  ['Easy', 'easy'],
  ['Ideal (= Hard on this ladder)', 'hard'],
] as const)('the %s plan the Coach started', (_label, rung) => {
  it('a re-plan with nothing changed gives a plan, never "no safe plan"', async () => {
    await seed(FIXTURE[rung]);
    const o = out(await dispatch('plan.replan', {}, { idempotencyKey: `replan-${rung}` }));
    expect(o.status).not.toBe('noSafePlan');
    expect(['unchanged', 'proposed', 'adopted']).toContain(o.status);
  }, 300_000);
  // "change my training days to Tue/Thu" as the Coach sends it (qa/fixtures/Q4/script.json J1-training-days)
  it.each([
    ['swap Monday and Tuesday', 'plan.shift', { from: '2026-10-05', days: 1, mode: 'swap', withDate: '2026-10-06' }],
    ['swap Wednesday and Thursday', 'plan.shift', { from: '2026-10-07', days: 1, mode: 'swap', withDate: '2026-10-08' }],
    ['no training on Friday', 'plan.editDay', { date: '2026-10-09', scope: 'day', patch: { habitualTraining: false, exercise: null } }],
  ])('%s gives a new version, never "no safe plan"', async (_name, id, input) => {
    await seed(FIXTURE[rung]);
    const o = out(await dispatch(id, input, { idempotencyKey: `${id}-${rung}` }));
    expect(o.status).not.toBe('noSafePlan');
    expect(['proposed', 'adopted']).toContain(o.status);
  }, 300_000);
});
