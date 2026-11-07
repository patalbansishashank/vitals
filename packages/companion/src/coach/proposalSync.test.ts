// @vitest-environment node
/**
 * A plan change the server coach stages is the person's own pending-changes document (`pendingChanges`, the app's
 * `coach.pending`): it syncs to their other devices, and the SSE `proposal` event's `id` is that document's
 * pendingId, so Apply in Vitals finds it. The real person program runs in-process behind the real home pool and relay;
 * a fake Claude Code (`fixtures/fake-claude.mjs`) calls `profile_patch` on `/mcp` with the session's edit token.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEvoluSyncStore } from '@/sync/evolu/adapter';
import type { DocChange, SyncStore } from '@/sync/types';
import { createNodeEvoluPlatform } from '../evoluNode.ts';
import { openPersonProgram } from '../home/personProgram.ts';
import { loopbackRelayUrl } from '../home/serverConfig.ts';
import type { WorkerFactory } from '../home/workers.ts';
import { startCompanion } from '../server.ts';
import type { CoachEvent } from './backends.ts';

const FAKE = fileURLToPath(new URL('../../fixtures/fake-claude.mjs', import.meta.url));
const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'coach-proposal-'));
const done: Array<() => Promise<unknown>> = [];
afterAll(async () => {
  for (const d of done.reverse()) await d().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
});
beforeAll(async () => {
  await Promise.all([import('@/commands'), import('@/commands/bus'), import('@/commands/registry'), import('@/state/runtime'), import('@/agents/dispatcher'), import('@/commands/ai/agentDispatcher')]);
}, 120_000);

const SECRET = new Uint8Array(32).fill(7);

function waitFor<T>(s: SyncStore, pred: (c: DocChange) => T | undefined, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${what}`));
    }, ms);
    const off = s.subscribe((c) => {
      const v = pred(c);
      if (v === undefined) return;
      clearTimeout(t);
      off();
      resolve(v);
    });
  });
}

it('a coach proposal is the pendingChanges document on the person’s other device, with the event id as its pendingId', async () => {
  const inProcess: WorkerFactory = async (init) => {
    const p = await openPersonProgram(init, SECRET);
    return { call: (req) => p.handle(req), close: () => p.close() };
  };
  const home = join(dir, 'cli-home');
  mkdirSync(home);
  let port = 0;
  const c = await startCompanion({
    port: 0, dataDir: join(dir, 'relay'), allowedOrigins: [], log: () => undefined,
    home: {
      dataDir: join(dir, 'home'), publicOrigin: 'https://host.tail0.ts.net:8443', workerFactory: inProcess, relayUrl: () => loopbackRelayUrl({ host: '127.0.0.1', port }),
      rateLimit: { capacity: 1000, perMinute: 60_000 },
      coach: { claudePath: FAKE, isolation: 'none', runtimeDir: join(dir, 'run'), home, claudeConfigDir: join(home, '.claude') },
    },
  });
  port = c.port;
  done.push(() => c.close());
  const person = await c.home!.persons.add({ label: 'coach-proposal', timeZone: 'Europe/Berlin', secret: SECRET, relayUrl: null });
  const { token } = await c.home!.devices.mint(person.id, { kind: 'device', label: 'phone' });

  // the person's phone: its own replica of the same owner, connected first
  const b = createEvoluSyncStore({ platform: () => createNodeEvoluPlatform({ dataDir: join(dir, 'b'), instance: 'B' }), appName: 'vitals' });
  await b.open({ secret: SECRET, relayUrl: loopbackRelayUrl({ host: '127.0.0.1', port })!, deviceId: 'DEVICEB000000002', memoryOnly: true });
  done.push(() => b.close());
  const first = waitFor(b, (ch) => (ch.origin === 'remote' && ch.col === 'profile' ? true : undefined), 10_000, 'the first sync');
  await c.home!.pool.call(person.id, { op: 'dispatch', command: 'profile.patch', input: { heightCm: 170 }, source: 'ui' });
  await first;

  const staged = waitFor(b, (ch) => (ch.origin === 'remote' && ch.col === 'pendingChanges' ? ch : undefined), 10_000, 'the proposal on the phone');
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const s = (await (await fetch(`${c.url}/v1/coach/sessions`, { method: 'POST', headers: auth, body: JSON.stringify({ app: 'vitals' }) })).json()) as { sessionId: string };
  const raw = await (await fetch(`${c.url}/v1/coach/sessions/${s.sessionId}/messages`, { method: 'POST', headers: auth, body: JSON.stringify({ text: 'I am 171 cm [call:profile_patch {"heightCm":171}]' }) })).text();
  const events = raw.split('\n\n').filter((x) => x.startsWith('data: ')).map((x) => JSON.parse(x.slice(6)) as CoachEvent);
  const proposal = events.find((e): e is Extract<CoachEvent, { type: 'proposal' }> => e.type === 'proposal');
  expect(proposal, raw).toBeDefined();
  expect(events.at(-1)?.type).toBe('done');

  const doc = await staged;
  expect(doc.id).toBe(proposal!.id);
  expect((doc.doc?.value as { status?: string } | undefined)?.status).toBe('pending');
}, 60_000);
