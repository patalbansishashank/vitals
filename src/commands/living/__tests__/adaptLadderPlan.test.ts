/**
 * Q3-J5-01: a plan the ladder search accepted must stay adaptable. The Medium rung of a quick ladder (−24 % energy, close
 * to the deficit and rate caps) was refused by every adaptation on day 1: before the first check-in the re-plan judged it
 * at the energy-bias band the ladder never applied, and the search's finalists all failed the as-prescribed cushion.
 * Re-plan, a meal out, travelling and a push-back must each give a plan (unchanged or a new version), on day 1 and day 10.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDocumentStore, createMemoryBackend, mintWriteToken } from '@/store';
import { getDocumentStore, setDocumentStore } from '@/state/runtime';
import { dispatch, type CommandResult } from '@/commands';
import { installLivingPorts } from '@/commands/livingWiring';
import { replan } from '@/engine/planner/domain/replan';
import { addDays } from '@/living';
import type { AdaptOutput } from '@/commands/living/adapt';

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/q3b-medium-plan.json'), 'utf8')) as Record<'plans' | 'planVersions' | 'activePlan', Array<Record<string, unknown>>>;
const START = '2026-10-02';

beforeAll(() => {
  installLivingPorts({ planner: { replan: (req, o) => replan(req, { tier: o?.tier ?? 'S' }) } });
});
afterEach(() => {
  vi.useRealTimers();
});

async function seedAt(today: string): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${today}T12:00:00`));
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'testdevice000003' }), validation: 'off' }));
  const store = getDocumentStore();
  await store.ready;
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    for (const d of FIXTURE.plans) await tx.put('plans', d as never);
    for (const d of FIXTURE.planVersions) await tx.append('planVersions', d as never);
    for (const d of FIXTURE.activePlan) await tx.put('activePlan', d as never);
  });
}

const out = (r: CommandResult): AdaptOutput => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as AdaptOutput;
};

describe.each([
  ['day 1', 0],
  ['day 10', 9],
])('a quick-ladder Medium plan on %s', (_label, dayIdx) => {
  const today = addDays(START, dayIdx);
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ['re-plan', 'plan.replan', {}],
    ['meal out', 'plan.declareEvent', { kind: 'socialMeal', from: addDays(today, 1), to: addDays(today, 1) }],
    ['travelling', 'plan.declareEvent', { kind: 'travel', from: addDays(today, 2), to: addDays(today, 3) }],
    ['push back', 'plan.shift', { from: addDays(today, 4), days: 1, mode: 'pushBack' }],
  ];
  it.each(cases)('%s gives a plan, never "no safe plan"', async (_name, id, input) => {
    await seedAt(today);
    const o = out(await dispatch(id, input, { idempotencyKey: `${id}-${dayIdx}-${JSON.stringify(input)}` }));
    expect(o.status).not.toBe('noSafePlan');
    if (id === 'plan.replan') expect(['unchanged', 'proposed', 'adopted']).toContain(o.status);
    else {
      expect(['proposed', 'adopted']).toContain(o.status);
      expect(o.version).toBe(2);
    }
  }, 300_000);
});
