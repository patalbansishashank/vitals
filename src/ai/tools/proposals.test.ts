// @vitest-environment node
/** ToolRunner (R8 §5.2–§5.3, SUITE_SPEC §1.4, §1.6, §1.8): every confirmation class over the command port. */
import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../providers/types';
import { createMockPort, MOCK_COMMANDS } from './__fixtures__/mockCommands';
import { idempotencyKeyFor, ToolRunner, type ToolRunnerOptions } from './proposals';
import { ToolRegistry } from './registry';

const CONV = 'conv1';

function setup(extra: Partial<ToolRunnerOptions> = {}) {
  const port = createMockPort();
  let n = 0;
  const runner = new ToolRunner({
    registry: new ToolRegistry(MOCK_COMMANDS),
    port,
    now: () => '2026-10-01T10:00:00.000Z',
    newId: () => `p${++n}`,
    ...extra,
  });
  return { port, runner };
}

const call = (id: string, name: string, args: Record<string, unknown>, extra: Partial<ToolCall> = {}): ToolCall => ({ id, name, args, rawArgs: JSON.stringify(args), ...extra });
const meal = { components: [{ name: 'rice', grams: 150 }], method: 'described' };

describe('read', () => {
  it('dispatches as the AI and returns applied data', async () => {
    const { port, runner } = setup();
    const { envelope, message } = await runner.handleCall(CONV, call('c1', 'today_get', {}));
    expect(envelope).toEqual({ ok: true, status: 'applied', summary: 'Looked at today.', data: { date: '2026-10-01', remaining: { kcal: 900, proteinG: 60 } } });
    expect(port.calls[0]!.opts.actor).toEqual({ kind: 'ai', id: 'coach', conversationId: CONV, toolCallId: 'c1' });
    expect(message).toMatchObject({ role: 'tool', toolCallId: 'c1', toolName: 'today_get' });
    expect(message.isError).toBeUndefined();
    expect(JSON.parse((message.parts[0] as { text: string }).text)).toEqual(envelope);
  });

  it('strict nulls for optional fields are dropped before validation', async () => {
    const { port, runner } = setup();
    const { envelope } = await runner.handleCall(CONV, call('c1', 'today_get', { date: null }));
    expect(envelope.ok).toBe(true);
    expect(port.calls[0]!.input).toEqual({});
  });

  it('caps large results with a hint and cursor', async () => {
    const { runner } = setup({ resultTokenCap: 500 });
    const { envelope } = await runner.handleCall(CONV, call('c1', 'log_get', { from: '2026-01-01', to: '2026-09-30', detail: 'full' }));
    expect(envelope.data).toMatchObject({ truncated: true, hint: 'narrow the range or fields', nextCursor: 'cur_2' });
    expect(JSON.stringify(envelope.data).length).toBeLessThan(500 * 3.5 + 200);
  });

  it('job result → running with jobId', async () => {
    const { runner } = setup();
    const { envelope } = await runner.handleCall(CONV, call('c1', 'sim_what_if', { variants: [{ shiftDays: 2 }] }));
    expect(envelope).toMatchObject({ ok: true, status: 'running', jobId: 'job_1' });
    expect(envelope.summary).toContain('job status');
  });
});

describe('log', () => {
  it('applies with idempotency key, changeId and undoToken', async () => {
    const { port, runner } = setup();
    const { envelope } = await runner.handleCall(CONV, call('c1', 'log_meal', meal));
    expect(envelope).toMatchObject({ ok: true, status: 'applied', changeId: 'chg_1', undoToken: 'undo_1', summary: 'Logged 1 item(s).' });
    expect(port.calls[0]!.opts.idempotencyKey).toBe('conv1:c1');
    expect(port.calls[0]!.opts.dryRun).toBeUndefined();
  });

  it('a repeated call returns the stored result without dispatching again', async () => {
    const { port, runner } = setup();
    const first = await runner.handleCall(CONV, call('c1', 'log_meal', meal));
    const again = await runner.handleCall(CONV, call('c1', 'log_meal', meal));
    expect(again).toBe(first);
    expect(port.calls).toHaveLength(1);
    // Concurrent duplicates share one dispatch too.
    const [a, b] = await Promise.all([runner.handleCall(CONV, call('c2', 'log_meal', meal)), runner.handleCall(CONV, call('c2', 'log_meal', meal))]);
    expect(a).toBe(b);
    expect(port.calls).toHaveLength(2);
  });

  it('a fresh runner replaying the same key gets the port-stored result', async () => {
    const { port, runner } = setup();
    await runner.handleCall(CONV, call('c1', 'log_meal', meal));
    const runner2 = new ToolRunner({ registry: new ToolRegistry(MOCK_COMMANDS), port, now: () => 'x', newId: () => 'y' });
    const r = await runner2.handleCall(CONV, call('c1', 'log_meal', meal));
    expect(r.envelope.changeId).toBe('chg_1');
    expect(port.executed).toHaveLength(1);
  });

  it('undo goes through the port', async () => {
    const { port, runner } = setup();
    const { envelope } = await runner.handleCall(CONV, call('c1', 'log_measurement', { metric: 'weight', value: 81.4, unit: 'kg' }));
    expect(await runner.undo(envelope.undoToken!)).toEqual({ ok: true, status: 'applied', summary: 'Undone.' });
    expect(port.undone).toEqual(['undo_1']);
    expect((await runner.undo(envelope.undoToken!)).error?.code).toBe('not_found');
  });
});

describe('edit', () => {
  it('stages a proposal from a dry run without a key', async () => {
    const { port, runner } = setup();
    const { envelope, message } = await runner.handleCall(CONV, call('c1', 'plan_shift', { days: 2 }));
    expect(envelope.status).toBe('pending_user');
    expect(envelope.ok).toBe(true);
    expect(envelope.summary).toContain('stop here and wait');
    expect(envelope.data).toEqual({ proposalId: 'p1', preview: { shiftDays: 2, goalDateMoves: 2 } });
    expect(message.isError).toBeUndefined();
    expect(port.calls[0]!.opts).toMatchObject({ dryRun: true });
    expect(port.calls[0]!.opts.idempotencyKey).toBeUndefined();
    expect(port.executed).toHaveLength(0);
    expect(runner.pending()).toEqual([
      expect.objectContaining({ id: 'p1', conversationId: CONV, toolCallId: 'c1', commandId: 'plan.shift', input: { days: 2 }, status: 'pending', createdAt: '2026-10-01T10:00:00.000Z' }),
    ]);
  });

  it('apply dispatches as the user on behalf of the AI with the same key; twice returns the first result', async () => {
    const { port, runner } = setup();
    await runner.handleCall(CONV, call('c1', 'plan_shift', { days: 2 }));
    const r1 = await runner.apply('p1');
    expect(r1).toMatchObject({ ok: true, status: 'applied', changeId: 'chg_1', undoToken: 'undo_1' });
    const applied = port.calls.at(-1)!;
    expect(applied.opts.actor).toEqual({ kind: 'user', id: 'local-user', onBehalfOf: { kind: 'ai', id: 'coach', conversationId: CONV, toolCallId: 'c1' } });
    expect(applied.opts.idempotencyKey).toBe('conv1:c1');
    expect(applied.opts.dryRun).toBeUndefined();
    const count = port.calls.length;
    expect(await runner.apply('p1')).toBe(r1);
    expect(port.calls).toHaveLength(count);
    expect(runner.pending()).toEqual([]);
    expect(runner.drainNotes()).toEqual(['[system note: proposal p1 applied]']);
    expect(runner.drainNotes()).toEqual([]);
  });

  it('discard marks it and leaves a note; discarded proposals cannot be applied', async () => {
    const { port, runner } = setup();
    await runner.handleCall(CONV, call('c1', 'profile_patch', { activity: 'moderate' }));
    expect(runner.discard('p1')).toBe(true);
    expect(runner.discard('p1')).toBe(false);
    expect(runner.proposal('p1')!.status).toBe('discarded');
    expect(runner.drainNotes()).toEqual(['[system note: proposal p1 discarded]']);
    expect((await runner.apply('p1')).error?.code).toBe('conflict');
    expect(port.executed).toHaveLength(0);
    expect((await runner.apply('nope')).error?.code).toBe('not_found');
  });

  it('autoApplyEdit applies directly with an undo token', async () => {
    const seen: unknown[] = [];
    const { port, runner } = setup({
      autoApplyEdit: (def, input, preview) => {
        seen.push([def.id, input, preview]);
        return Math.abs((input as { days: number }).days) <= 3;
      },
    });
    const small = await runner.handleCall(CONV, call('c1', 'plan_shift', { days: 2 }));
    expect(small.envelope).toMatchObject({ ok: true, status: 'applied', undoToken: 'undo_1' });
    // the person's auto-apply setting applies it as the person, on behalf of the Coach (an AI write would be staged)
    expect(port.executed[0]!.opts).toMatchObject({ idempotencyKey: 'conv1:c1', actor: { kind: 'user', onBehalfOf: { kind: 'ai', conversationId: CONV, toolCallId: 'c1' } } });
    expect(runner.proposal('p1')!.status).toBe('applied');
    const big = await runner.handleCall(CONV, call('c2', 'plan_shift', { days: 10 }));
    expect(big.envelope.status).toBe('pending_user');
    expect(seen[0]).toEqual(['plan.shift', { days: 2 }, { shiftDays: 2, goalDateMoves: 2 }]);
  });

  it('safety_blocked passes allowed alternatives through', async () => {
    const { runner } = setup();
    const { envelope, message } = await runner.handleCall(CONV, call('c1', 'plan_shift', { days: 20 }));
    expect(envelope).toMatchObject({ ok: false, status: 'rejected', summary: 'Shifting the plan by more than 14 days is not allowed.' });
    expect(envelope.error?.code).toBe('safety_blocked');
    expect(envelope.data).toEqual({ allowedAlternatives: ['Shift by up to 14 days', 'Pause the plan instead'] });
    expect(message.isError).toBe(true);
    expect(runner.pending()).toEqual([]);
  });
});

describe('destructive', () => {
  it('never dispatches from the model; creates a typed-confirmation proposal', async () => {
    const { port, runner } = setup();
    const { envelope, message } = await runner.handleCall(CONV, call('c1', 'plan_end', { reason: 'done' }));
    expect(envelope).toMatchObject({ ok: false, status: 'rejected', error: { code: 'confirmation_required' } });
    expect(message.isError).toBe(true);
    expect(port.calls).toHaveLength(0);
    expect(runner.pending()).toEqual([expect.objectContaining({ id: 'p1', requiresTypedConfirmation: true, preview: null })]);
  });

  it('apply without confirmation is an error and does not dispatch; with one it applies', async () => {
    const { port, runner } = setup();
    await runner.handleCall(CONV, call('c1', 'plan_end', { reason: 'done' }));
    expect((await runner.apply('p1')).error?.code).toBe('confirmation_required');
    expect(port.calls).toHaveLength(0);
    const token = { commandId: 'plan.end', nonce: 'n' };
    const r = await runner.apply('p1', { confirmation: token });
    expect(r).toMatchObject({ ok: true, status: 'applied' });
    expect(port.calls[0]!.opts.confirmation).toBe(token);
  });
});

describe('rejections', () => {
  it('unknown tool', async () => {
    const { port, runner } = setup();
    const { envelope, message } = await runner.handleCall(CONV, call('c1', 'nope_tool', {}));
    expect(envelope).toMatchObject({ ok: false, status: 'rejected', error: { code: 'not_found' } });
    expect(message.isError).toBe(true);
    expect(port.calls).toHaveLength(0);
  });

  it('parse error and schema-invalid args give is_error messages the model can act on', async () => {
    const { port, runner } = setup();
    const bad = await runner.handleCall(CONV, call('c1', 'log_meal', {}, { rawArgs: '{"comp', parseError: 'Unexpected end' }));
    expect(bad.envelope.error?.code).toBe('invalid_input');
    expect(bad.envelope.summary).toContain('not valid JSON');
    const inv = await runner.handleCall(CONV, call('c2', 'log_measurement', { metric: 'height', value: -1 }));
    expect(inv.message.isError).toBe(true);
    expect(inv.envelope.summary).toContain('/metric: must be one of "weight", "waist", "bodyFat" (got "height")');
    expect(inv.envelope.summary).toContain('/value: must be greater than 0');
    expect(inv.envelope.error?.detail?.path).toBe('/metric');
    expect(port.calls).toHaveLength(0);
    // Not stored: the corrected call with the same id goes through.
    const ok = await runner.handleCall(CONV, call('c2', 'log_measurement', { metric: 'weight', value: 80 }));
    expect(ok.envelope.ok).toBe(true);
  });

  it('per-turn limits reset with beginTurn', async () => {
    const { port, runner } = setup();
    for (let i = 0; i < 3; i++) expect((await runner.handleCall(CONV, call(`j${i}`, 'job_status', { jobId: 'x' }))).envelope.ok).toBe(true);
    const over = await runner.handleCall(CONV, call('j3', 'job_status', { jobId: 'x' }));
    expect(over.envelope.error?.code).toBe('rate_limited');
    expect(over.envelope.summary).toContain('at most 3 times');
    expect(port.calls).toHaveLength(3);
    const d1 = await runner.handleCall(CONV, call('d1', 'plan_end', { reason: 'done' }));
    const d2 = await runner.handleCall(CONV, call('d2', 'plan_end', { reason: 'done' }));
    expect(d1.envelope.error?.code).toBe('confirmation_required');
    expect(d2.envelope.error?.code).toBe('rate_limited');
    runner.beginTurn();
    expect((await runner.handleCall(CONV, call('j4', 'job_status', { jobId: 'x' }))).envelope.ok).toBe(true);
  });
});

describe('idempotency keys', () => {
  it('uses conversationId:toolCallId when short', async () => {
    expect(await idempotencyKeyFor('01J9ZCONVERSATIONULID00000', 'call_abc')).toBe('01J9ZCONVERSATIONULID00000:call_abc');
  });

  it('hashes long ids deterministically to ≤ 64 chars', async () => {
    const conv = '01J9ZCONVERSATIONULID00000';
    const tc = 'toolu_01A09q90qw90lq917835lq9ABCDEFGHIJKLMNOP';
    const k1 = await idempotencyKeyFor(conv, tc);
    expect(k1).toMatch(/^h:[0-9a-f]{62}$/);
    expect(k1).toHaveLength(64);
    expect(await idempotencyKeyFor(conv, tc)).toBe(k1);
    expect(await idempotencyKeyFor(conv, `${tc}X`)).not.toBe(k1);
    const { port, runner } = setup();
    await runner.handleCall(conv, call(tc, 'log_meal', meal));
    expect(port.calls[0]!.opts.idempotencyKey).toBe(k1);
  });
});
