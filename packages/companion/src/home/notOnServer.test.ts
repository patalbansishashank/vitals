// @vitest-environment node
/**
 * Q10-07: the server's MCP list must not offer tools that answer `not_on_server` (docs/SERVER.md "Agents"). The real
 * person program's manifest, filtered as the agent route filters it for an edit-scope token.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { newOwnerSecret } from '@/sync/pairing';
import { answersNotOnServer, NOT_ON_SERVER_SEED } from '../agentsRemote.ts';
import { manifestForScope, type ToolManifest } from '../toolManifest.ts';
import { openPersonProgram } from './personProgram.ts';
import type { PersonResponse } from './personRpc.ts';

const root = join(process.env.TMPDIR ?? '/tmp', `not-on-server-${process.pid}`);
beforeAll(() => mkdirSync(root, { recursive: true }));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ok = <T>(r: PersonResponse): T => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value as T;
};

it('an edit-scope agent is not offered the planner-backed tools, and a re-plan names not_on_server', async () => {
  const p = await openPersonProgram({ personId: 'c'.repeat(16), dir: join(root, 'p'), timeZone: 'Europe/Berlin', deviceId: 'SERVERNOS0000001', relayUrl: null, instance: 'nos' }, newOwnerSecret());
  try {
    const manifest = ok<ToolManifest>(await p.handle({ op: 'agentManifest' }));
    const all = manifest.tools.map((t) => t.name);
    for (const name of ['plan_edit_day', 'plan_declare_event', 'plan_shift', 'plan_replan']) expect(all).toContain(name);
    const listed = manifestForScope(manifest, 'edit', new Set(NOT_ON_SERVER_SEED)).tools.map((t) => t.name);
    for (const name of ['plan_edit_day', 'plan_declare_event', 'plan_shift', 'plan_replan', 'planner_find']) expect(listed).not.toContain(name);
    expect(listed).toContain('log_steps');

    // the living re-plan port on the server: a precondition naming not_on_server, as the route's rule reads it
    const { getPorts } = await import('@/commands');
    const replan = getPorts().living!.planner!.replan({} as never, {});
    const err = await replan.then(() => null, (e: unknown) => e as { error?: { code: string; detail?: unknown } });
    expect(err?.error?.code).toBe('precondition_failed');
    expect(answersNotOnServer({ error: err!.error! })).toBe(true);
  } finally {
    await p.close();
  }
}, 120_000);

it('reads not_on_server as detail.reason or detail.rule', () => {
  expect(answersNotOnServer({ error: { detail: { reason: 'not_on_server' } } })).toBe(true);
  expect(answersNotOnServer({ error: { detail: { rule: 'not_on_server' } } })).toBe(true);
  expect(answersNotOnServer({ error: { detail: { reason: 'timeout' } } })).toBe(false);
  expect(answersNotOnServer({})).toBe(false);
});
