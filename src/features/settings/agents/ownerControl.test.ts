import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, defineCommand } from '@/commands';
import { createBusAgentDispatcher } from '@/commands/ai/agentDispatcher';
import { T } from '@/commands/schema';
import { freshState } from '@/commands/__tests__/harness';
import type { Actor } from '@/commands/types';
import { runOwnerControl } from '@/commands/ownerControl';

let executedAs: Actor | null = null;
defineCommand({
  id: 'test.ownerDelete' as never,
  version: 1,
  title: 'Owner control confirmation test',
  description: 'Test-only destructive command.',
  input: T.Object({ value: T.Number() }),
  output: T.Object({ deleted: T.Boolean() }),
  perm: 'destructive',
  surfaces: ['ui'],
  undo: { kind: 'none' },
  idempotency: 'natural',
  sideEffects: [],
  execute: (ctx) => {
    executedAs = ctx.actor;
    return { deleted: true };
  },
});
const fullRows = Array.from({ length: 500 }, (_, index) => ({ index, value: 'Complete prescription data '.repeat(5) }));
defineCommand({
  id: 'test.ownerRead' as never,
  version: 1,
  title: 'Owner complete result test',
  description: 'Test-only large read.',
  input: T.Object({}),
  output: T.Object({ rows: T.Array(T.OpenObject()) }),
  perm: 'read',
  surfaces: ['ui', 'ai', 'mcp', 'webmcp'],
  undo: { kind: 'none' },
  idempotency: 'none',
  sideEffects: [],
  execute: () => ({ rows: fullRows }),
});
beforeEach(() => {
  freshState({ cleared: true });
  executedAs = null;
});

describe('owner-delegated app commands', () => {
  it('returns complete data to the owner client while ordinary agent results keep their context cap', async () => {
    const normal = createBusAgentDispatcher();
    const capped = await normal.call('test.ownerRead', {}, { actor: { kind: 'mcp', id: 'codex' }, stage: false });
    expect(capped.data).toMatchObject({ truncated: true });
    const full = await runOwnerControl({ client: 'codex', tool: 'app_execute', args: { commandId: 'test.ownerRead', input: {} } });
    expect(full.data).toEqual({ rows: fullRows });
  });
  it('can discover UI-only commands and their schemas without hiding unimplemented features', async () => {
    const result = await runOwnerControl({
      client: 'codex',
      tool: 'app_commands',
      args: { query: 'safety.setFastingOptIn', schemas: true },
    });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      total: 1,
      commands: [{ id: 'safety.setFastingOptIn', implemented: true, inputSchema: { type: 'object' } }],
    });
  });

  it('applies a staged edit through the real command bus, while ordinary agents still stage it', async () => {
    const normal = createBusAgentDispatcher({ directApply: () => false });
    const staged = await normal.call(
      'profile.patch',
      { weightKg: 74.8 },
      { actor: { kind: 'mcp', id: 'codex' }, stage: false },
    );
    expect(staged.status).toBe('pending_user');
    const applied = await runOwnerControl({
      client: 'codex',
      tool: 'app_execute',
      args: { commandId: 'coach.applyPending', input: { pendingId: staged.changeId } },
    });
    expect(applied).toMatchObject({ ok: true, status: 'applied', data: { applied: true } });
    const read = await dispatch('profile.get', {});
    expect(read).toMatchObject({ ok: true, output: { profile: { weightKg: 74.8 } } });
  });

  it('validates the exact command input before writing', async () => {
    const bad = await runOwnerControl({
      client: 'codex',
      tool: 'profile_patch',
      args: { weightKg: 'not a weight' },
    });
    expect(bad).toMatchObject({ ok: false, status: 'rejected', error: { code: 'invalid_input' } });
  });

  it('retains explicit destructive confirmation and records delegated authorship', async () => {
    const call = {
      client: 'codex',
      tool: 'app_execute',
      args: { commandId: 'test.ownerDelete', input: { value: 1 } },
    };
    expect(await runOwnerControl(call)).toMatchObject({
      ok: false,
      error: { code: 'confirmation_required' },
    });
    expect(executedAs).toBeNull();
    const result = await runOwnerControl({ ...call, args: { ...call.args, confirm: true } });
    expect(result).toMatchObject({ ok: true, data: { deleted: true } });
    expect(executedAs).toMatchObject({ kind: 'user', onBehalfOf: { kind: 'mcp', id: 'codex' } });
  });

  it('does not turn malformed input into command execution', async () => {
    expect(
      await runOwnerControl({
        client: 'codex',
        tool: 'app_execute',
        args: { commandId: 'profile.patch', input: null },
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });
});
