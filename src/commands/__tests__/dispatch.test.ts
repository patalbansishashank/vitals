/**
 * The dispatcher pipeline (SUITE_SPEC §1.3–§1.7): validation, surfaces, idempotency replay, confirmation tokens,
 * staging of agent proposals, rate limits, preconditions and safety gates, dry runs, jobs and stubs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDocumentStore } from '@/state/runtime';
import { useProfileStore } from '@/state/profileStore';
import { useScheduleStore } from '@/state/scheduleStore';
import { useSettingsStore } from '@/state/settingsStore';
import { allCommands, dispatch, dispatchSync, jobs, mintConfirmation, on, outputOf, settleCommits, type BusEvent, type CommandResult } from '..';
import { AI, MCP, freshState } from './harness';
import { stub } from '../defs/_shared';
import { T } from '../schema';

const err = (r: CommandResult) => (r.ok ? null : r.error);

beforeEach(() => {
  freshState({ cleared: true });
});

describe('validation and surfaces', () => {
  it('rejects unknown commands and invalid input with a JSON pointer', async () => {
    expect(err(await dispatch('nope.nothing' as never, {}))?.code).toBe('not_found');
    const r = await dispatch('profile.patch', { weightKg: 'heavy' } as never);
    expect(err(r)).toMatchObject({ code: 'invalid_input', detail: { path: '/weightKg' } });
    expect(err(await dispatch('profile.patch', { weight: 80 } as never))?.detail?.path).toBe('/weight');
  });

  it('keeps UI-only commands away from agents, with the written reason', async () => {
    const r = await dispatch('safety.commitScreening', { answers: {}, at: '2026-10-01T09:00:00.000Z' }, { actor: AI, idempotencyKey: 'k' });
    expect(err(r)).toMatchObject({ code: 'surface_forbidden', message: "requires the person's own consent in the app" });
    expect(err(await dispatch('nav.open', { route: 'body' }, { actor: MCP }))?.code).toBe('surface_forbidden');
  });

  it('lets the AI change display settings only', async () => {
    expect((await dispatch('settings.update', { patch: { theme: 'dark' } }, { actor: AI })).ok).toBe(true);
    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(err(await dispatch('settings.update', { patch: { lastExportAt: '2026-10-01T09:00:00.000Z' } }, { actor: AI }))?.code).toBe('surface_forbidden');
  });
});

describe('bus events', () => {
  it('a read emits "read", never "committed"; a write emits "committed" with its ChangeSet (Q3-J5-09)', async () => {
    const seen: BusEvent[] = [];
    const off = on((e) => void seen.push(e));
    await dispatch('profile.get', {});
    await dispatch('profile.patch', { weightKg: 81 });
    off();
    expect(seen.filter((e) => e.type === 'committed').map((e) => e.type === 'committed' && e.commandId)).toEqual(['profile.patch']);
    expect(seen.find((e) => e.type === 'committed')).toMatchObject({ changeSet: { commandId: 'profile.patch' } });
    expect(seen.find((e) => e.type === 'read')).toMatchObject({ commandId: 'profile.get', actor: { kind: 'user' } });
  });
});

describe('idempotency', () => {
  it('replays a keyed command from the ledger instead of running it twice', async () => {
    const opts = { actor: AI, idempotencyKey: `${AI.conversationId}:call-7` };
    const a = outputOf(await dispatch('scenario.create', { starter: 'blank', name: 'Retry me' }, opts));
    const b = outputOf(await dispatch('scenario.create', { starter: 'blank', name: 'Retry me' }, opts));
    expect(a?.scenarioId).toBeTruthy();
    expect(b?.scenarioId).toBe(a?.scenarioId);
    expect(useScheduleStore.getState().scenarios.filter((s) => s.name.startsWith('Retry me'))).toHaveLength(1);
  });

  it('requires a key from agents for keyed commands; the UI gets a per-click nonce', async () => {
    expect(err(await dispatch('scenario.create', { starter: 'blank' }, { actor: AI }))?.code).toBe('invalid_input');
    await dispatch('scenario.create', { name: 'X' });
    await dispatch('scenario.create', { name: 'X' });
    expect(useScheduleStore.getState().scenarios.filter((s) => s.name.startsWith('X'))).toHaveLength(2);
  });

  it("previews an agent's keyed command as a dry run without a key (nothing is written)", async () => {
    const before = useScheduleStore.getState().scenarios.length;
    const r = await dispatch('scenario.create', { starter: 'blank', name: 'Preview' }, { actor: AI, dryRun: true });
    expect(r.ok).toBe(true);
    expect(useScheduleStore.getState().scenarios).toHaveLength(before);
  });
});

describe('destructive commands and confirmation tokens', () => {
  it('needs a token minted for exactly this command and input, once', async () => {
    expect(err(await dispatch('data.eraseAll', {}))?.code).toBe('confirmation_required');
    const forOther = mintConfirmation('data.import', {});
    expect(err(await dispatch('data.eraseAll', {}, { confirmation: forOther }))?.detail?.rule).toBe('confirmation:mismatch');
    const forged = { ...mintConfirmation('data.eraseAll', {}), mac: '00' };
    expect(err(await dispatch('data.eraseAll', {}, { confirmation: forged }))?.detail?.rule).toBe('confirmation:forged');
    const token = mintConfirmation('data.eraseAll', {});
    expect((await dispatch('data.eraseAll', {}, { confirmation: token })).ok).toBe(true);
    expect(err(await dispatch('data.eraseAll', {}, { confirmation: token }))?.detail?.rule).toBe('confirmation:used');
  });

  it('expires tokens after 60 s', async () => {
    const old = mintConfirmation('data.eraseAll', {}, new Date(Date.now() - 61_000));
    expect(err(await dispatch('data.eraseAll', {}, { confirmation: old }))?.detail?.rule).toBe('confirmation:expired');
  });
});

describe('agent proposals (consequential writes are staged)', () => {
  it('stages an AI profile edit, then applies it as the person', async () => {
    const before = useProfileStore.getState().weightKg;
    const r = await dispatch('profile.patch', { weightKg: 77 }, { actor: AI, idempotencyKey: 'c1:t1' });
    expect(r.ok && 'pending' in r).toBe(true);
    expect(useProfileStore.getState().weightKg).toBe(before);
    const pending = outputOf(await dispatch('coach.pending', {}))!;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ commandId: 'profile.patch', status: 'pending' });
    const applied = await dispatch('coach.applyPending', { pendingId: pending[0]!.pendingId });
    expect(applied.ok).toBe(true);
    expect(useProfileStore.getState().weightKg).toBe(77);
    expect(outputOf(await dispatch('coach.pending', {}))).toHaveLength(0);
  });

  it('refuses a stale proposal (something it touches changed since)', async () => {
    await dispatch('profile.patch', { weightKg: 80 });
    await settleCommits();
    const r = await dispatch('profile.patch', { heightCm: 181 }, { actor: AI });
    const pendingId = r.ok && 'pending' in r ? r.pending.pendingId : '';
    await dispatch('profile.patch', { weightKg: 81 });
    await settleCommits();
    const applied = await dispatch('coach.applyPending', { pendingId });
    expect(err(applied)?.code).toBe('conflict');
    await settleCommits();
    expect(getDocumentStore().peek<{ status: string }>('pendingChanges', pendingId)?.status).toBe('stale');
  });

  it('never executes destructive commands for agents', async () => {
    expect(err(await dispatch('plan.end', { reason: 'abandoned' }, { actor: MCP, idempotencyKey: 'x' }))?.code).toBe('confirmation_required');
  });
});

describe('limits, gates, stubs, dry runs, jobs', () => {
  it('rate-limits tool calls per turn', async () => {
    const turn = { actor: { ...AI, toolCallId: undefined }, correlationId: 'turn-1' };
    for (let i = 0; i < 20; i++) expect((await dispatch('settings.get', {}, turn)).ok).toBe(true);
    expect(err(await dispatch('settings.get', {}, turn))?.code).toBe('rate_limited');
  });

  it('blocks agents behind the safety gate the screens apply', async () => {
    freshState({ cleared: false });
    const sid = useScheduleStore.getState().activeId!;
    expect(err(await dispatch('sim.run', { scenarioId: sid }, { actor: AI }))).toMatchObject({ code: 'safety_blocked', detail: { gate: 'screeningReady' } });
    // the person's own screens sit behind the onboarding route gate
    expect((await dispatch('sim.run', { scenarioId: sid })).ok).toBe(true);
  });

  it('answers stub commands with their owner', async () => {
    // every shipped command is implemented now (E5b took the last five); a stub declared here answers with its owner
    stub({ id: 'app.testStubOnly', title: 'Stub', description: 'A stub for this test.', input: T.Object({}), perm: 'read', owner: 'E99 (test)', uiOwner: 'none' });
    const r = await dispatch('app.testStubOnly', {} as never, { idempotencyKey: 'k' });
    expect(err(r)).toMatchObject({ code: 'precondition_failed', detail: { precondition: 'implemented', owner: 'E99 (test)' } });
    const stubs = allCommands().filter((d) => d.notImplemented && !(d.input as { required?: string[] }).required?.length);
    expect(stubs.length).toBeGreaterThan(0);
    for (const d of stubs.slice(0, 5)) expect(err(await dispatch(d.id, {}, { idempotencyKey: `k-${d.id}` }))?.detail?.owner, d.id).toBe(d.notImplemented!.owner);
  });

  it('computes a dry run without changing anything', async () => {
    const sid = useScheduleStore.getState().activeId!;
    const before = useScheduleStore.getState().scenarios.find((s) => s.id === sid)!.schedule;
    const r = await dispatch('scenario.edit', { id: sid, ops: [{ op: 'setHorizon', days: 28 }] }, { dryRun: true });
    expect(r.ok && 'changeSet' in r && r.changeSet?.docs.map((d) => d.col)).toEqual(['scenarios']);
    expect(useScheduleStore.getState().scenarios.find((s) => s.id === sid)!.schedule).toBe(before);
  });

  it('runs a simulation as a job and reports its status and result', async () => {
    const sid = useScheduleStore.getState().activeId!;
    const r = await dispatch('sim.run', { scenarioId: sid });
    if (!r.ok || !('job' in r)) throw new Error('expected a job');
    const status = await jobs.wait(r.job.jobId);
    expect(status.state).toBe('done');
    expect(outputOf(await dispatch('job.status', { jobId: r.job.jobId }))?.state).toBe('done');
    const res = outputOf(await dispatch('job.result', { jobId: r.job.jobId }))?.result as { scenarioId: string; final: Record<string, number> };
    expect(res.scenarioId).toBe(sid);
    expect(res.final.scaleWeight).toBeLessThan(80);
    const series = outputOf(await dispatch('sim.series', { source: { scenarioId: sid }, series: ['scaleWeight', 'nope'], resolution: 'week' }));
    expect(series?.missing).toEqual(['nope']);
    expect(series?.series.scaleWeight?.[0]).toBeCloseTo(79.85, 1);
  });

  it('refuses asynchronous executors through dispatchSync', () => {
    expect(() => dispatchSync('evidence.search', { q: 'protein' })).toThrow(/asynchronous/);
  });

  it('declares every write command with an impact and every surface gap with a reason', () => {
    for (const d of allCommands()) {
      if (d.perm === 'write') expect(d.impact, d.id).toBeDefined();
      for (const s of ['ui', 'ai', 'webmcp', 'mcp'] as const) if (!d.surfaces.includes(s)) expect(d.excludedReason?.[s], `${d.id} ${s}`).toBeTruthy();
    }
  });
});
