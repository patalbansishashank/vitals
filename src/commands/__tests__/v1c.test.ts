/**
 * Review V1c: double submits of keyed commands and proposals, and the persisted idempotency ledger.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, resetBusState, settleCommits } from '..';
import { getDocumentStore } from '@/state/runtime';
import { defineCommand } from '../registry';
import { T } from '../schema';
import { UNDO } from '../defs/_shared';
import { AI, freshState } from './harness';

let runs = 0;
defineCommand({
  id: 'data.v1cSlowKeyed',
  version: 1,
  title: 'Slow keyed write',
  description: 'Test only.',
  input: T.Object({}),
  output: T.Object({ n: T.Number() }),
  perm: 'write',
  impact: 'low',
  surfaces: ['ui', 'ai'],
  excludedReason: { webmcp: 'test', mcp: 'test' },
  undo: UNDO.none,
  idempotency: 'key',
  sideEffects: [],
  execute: async (ctx) => {
    await new Promise((r) => setTimeout(r, 20));
    await ctx.docs.put('pendingChanges', { _id: ctx.newId(), commandId: 'data.v1cSlowKeyed', input: {}, actor: AI, createdAt: ctx.now, expiresAt: ctx.now, preview: {}, baseRevs: {}, status: 'test' });
    return { n: ++runs };
  },
});

let applies = 0;
defineCommand({
  id: 'data.v1cConsequential',
  version: 1,
  title: 'Consequential write',
  description: 'Test only.',
  input: T.Object({}),
  output: T.Object({ n: T.Number() }),
  perm: 'write',
  impact: 'consequential',
  surfaces: ['ui', 'ai'],
  excludedReason: { webmcp: 'test', mcp: 'test' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async () => {
    await new Promise((r) => setTimeout(r, 20));
    return { n: ++applies };
  },
});

beforeEach(() => {
  applies = 0;
  freshState({ cleared: true });
  runs = 0;
});

describe('V1c idempotency', () => {
  it('two concurrent dispatches with the same key run the command once', async () => {
    const opts = { actor: AI, idempotencyKey: 'same-key' };
    const [a, b] = await Promise.all([dispatch('data.v1cSlowKeyed' as never, {}, opts), dispatch('data.v1cSlowKeyed' as never, {}, opts)]);
    await settleCommits();
    expect(runs).toBe(1);
    expect(a).toEqual(b);
  });
});

describe('V1c persisted ledger', () => {
  it('a retry after a reload (in-memory ledger gone) replays the stored result', async () => {
    const opts = { actor: AI, idempotencyKey: 'reload-key' };
    const a = await dispatch('data.v1cSlowKeyed' as never, {}, opts);
    await settleCommits();
    expect(getDocumentStore().peek('commandLedger', 'data.v1cSlowKeyed|reload-key')).toBeTruthy();
    resetBusState();
    const b = await dispatch('data.v1cSlowKeyed' as never, {}, opts);
    expect(runs).toBe(1);
    expect(b).toEqual(a);
  });
});

describe('V1c proposals', () => {
  it('a double click on "apply" applies a proposal once', async () => {
    const r = await dispatch('data.v1cConsequential' as never, {}, { actor: AI });
    const pendingId = r.ok && 'pending' in r ? r.pending.pendingId : '';
    expect(pendingId).toBeTruthy();
    applies = 0; // staging previews the command once (a dry run)
    const [x, y] = await Promise.all([dispatch('coach.applyPending', { pendingId }), dispatch('coach.applyPending', { pendingId })]);
    await settleCommits();
    expect(applies).toBe(1);
    expect([x.ok, y.ok].sort()).toEqual([false, true]);
    const z = await dispatch('coach.applyPending', { pendingId });
    expect(z.ok).toBe(false);
    expect(applies).toBe(1);
  });
});

describe('V1c plan lifecycle double submit', () => {
  it('two taps on "start" start one plan', async () => {
    const created = await dispatch('scenario.create', { starter: 'blank', name: 'Start me' });
    const scenarioId = created.ok && 'output' in created ? (created.output as { scenarioId: string }).scenarioId : '';
    await settleCommits();
    // tomorrow, in local time: a plan cannot start in the past, so a fixed date goes stale
    const startDate = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA');
    const input = { source: { scenarioId }, startDate };
    const [a, b] = await Promise.all([dispatch('plan.start' as never, input as never), dispatch('plan.start' as never, input as never)]);
    await settleCommits();
    const plans = getDocumentStore().peekAll('plans');
    expect({ a: a.ok, b: b.ok, plans: plans.length }).toEqual({ a: true, b: false, plans: 1 });
  });
});

describe('V1c log edits', () => {
  const idOf = (r: { ok: boolean }) => (r as { output?: { entryId: string } }).output!.entryId;
  const effective = async () => {
    const r = await dispatch('log.get' as never, { from: '2026-01-01', to: '2027-12-31' } as never);
    return (r as { output: Array<{ id: string; kind: string; steps?: number }> }).output;
  };

  it('editing an entry that was already edited is refused (no second, forked copy)', async () => {
    const a = idOf(await dispatch('log.steps' as never, { date: '2026-10-02', steps: 1000 } as never));
    await settleCommits();
    expect((await dispatch('log.edit' as never, { entryId: a, patch: { steps: 2000 } } as never)).ok).toBe(true);
    await settleCommits();
    const stale = await dispatch('log.edit' as never, { entryId: a, patch: { steps: 3000 } } as never);
    await settleCommits();
    expect(stale.ok ? null : stale.error.code).toBe('conflict');
    expect((await effective()).filter((e) => e.kind === 'steps').map((e) => e.steps)).toEqual([2000]);
  });

  it('removing an entry that was edited since is refused instead of doing nothing', async () => {
    const a = idOf(await dispatch('log.steps' as never, { date: '2026-10-02', steps: 1000 } as never));
    await settleCommits();
    await dispatch('log.edit' as never, { entryId: a, patch: { steps: 2000 } } as never);
    await settleCommits();
    const r = await dispatch('log.retract' as never, { entryId: a } as never);
    expect(r.ok ? null : r.error.code).toBe('conflict');
  });

  it('dates a wake before the rollover hour and a fast begun after midnight on the app day', async () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    // 02:30 local on 2026-10-02, before the 04:00 rollover: still app day 2026-10-01
    const local = (iso: string) => {
      const guess = Date.parse(`${iso}Z`);
      const wall = new Date(new Date(guess).toLocaleString('en-US', { timeZone: tz })).getTime();
      const utcWall = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
      return new Date(guess - (wall - utcWall)).toISOString();
    };
    const wakeAt = local('2026-10-02T02:30:00');
    const s = idOf(await dispatch('log.sleep' as never, { bedAt: local('2026-10-01T22:00:00'), wakeAt } as never));
    const f = idOf(await dispatch('log.fast' as never, { action: 'record', lastIntakeAt: local('2026-10-02T01:00:00'), firstIntakeAt: local('2026-10-02T17:00:00') } as never));
    await settleCommits();
    const store = getDocumentStore();
    expect(store.peek<{ date: string }>('dailyLogs', s)?.date).toBe('2026-10-01');
    expect(store.peek<{ date: string }>('dailyLogs', f)?.date).toBe('2026-10-01');
  });
});

describe('V1c measurements', () => {
  const valueOf = async (r: Promise<unknown>) => {
    const res = (await r) as { ok: boolean; output?: { entryId: string }; error?: { code: string } };
    if (!res.ok) return res.error!.code;
    await settleCommits();
    return getDocumentStore().peek<{ value: number }>('measurements', res.output!.entryId)?.value;
  };
  it('keeps the unit the person gave: pounds become kg, other units are refused', async () => {
    expect(await valueOf(dispatch('log.measurement' as never, { metric: 'weightKg', value: 180, unit: 'lb' } as never))).toBeCloseTo(81.65, 2);
    expect(await valueOf(dispatch('log.measurement' as never, { metric: 'waistCm', value: 32, unit: 'in' } as never))).toBeCloseTo(81.28, 2);
    expect(await valueOf(dispatch('log.measurement' as never, { metric: 'weightKg', value: 80, unit: 'kg' } as never))).toBe(80);
    expect(await valueOf(dispatch('log.measurement' as never, { metric: 'crpMgL', value: 1.2, unit: 'mg/L' } as never))).toBe(1.2);
    expect(await valueOf(dispatch('log.measurement' as never, { metric: 'glucoseMmolL', value: 95, unit: 'mg/dL' } as never))).toBe('invalid_input');
    expect(await valueOf(dispatch('log.measurement' as never, { metric: 'weightKg', value: -3 } as never))).toBe('invalid_input');
    expect(await valueOf(dispatch('log.measurement' as never, { metric: 'weightKg', value: 0 } as never))).toBe('invalid_input');
  });
});

describe('V1c staged retries', () => {
  it('an agent retrying a keyed proposal gets the same proposal back', async () => {
    const opts = { actor: AI, idempotencyKey: 'stage-retry' };
    const a = await dispatch('profile.patch', { weightKg: 79 }, opts);
    const b = await dispatch('profile.patch', { weightKg: 79 }, opts);
    expect(a.ok && 'pending' in a).toBe(true);
    expect(b).toEqual(a);
    await settleCommits();
    expect(getDocumentStore().peekAll('pendingChanges').filter((d) => (d as { status?: string }).status === 'pending')).toHaveLength(1);
  });
});

describe('V1c log.edit checks the patch (V1c-10)', () => {
  const idOf = (r: { ok: boolean }) => (r as { output?: { entryId: string } }).output!.entryId;
  const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error!.code);

  it.each([
    ['assumed', { assumed: true }],
    ['planId', { planId: 'x' }],
    ['planDay', { planDay: 3 }],
    ['at', { at: '2026-10-02T10:00:00Z' }],
    ['tz', { tz: 'Mars/Base' }],
    ['source', { source: { by: 'user', id: 'x' } }],
    ['an unknown field', { calories: 5 }],
    ['a field of another kind', { bedAt: '2026-10-02T01:00:00Z' }],
    ['a wrong type', { steps: 'many' }],
    ['a non-finite or out-of-range number', { steps: -5 }],
    ['a bad date', { date: 'yesterday' }],
  ])('refuses %s', async (_name, patch) => {
    const a = idOf(await dispatch('log.steps' as never, { date: '2026-10-02', steps: 1000 } as never));
    await settleCommits();
    const r = await dispatch('log.edit' as never, { entryId: a, patch } as never);
    expect(code(r as never)).toBe('invalid_input');
    expect((r as { error: { message: string } }).error.message).not.toMatch(/undefined/);
  });

  it('accepts the fields the logging command takes', async () => {
    const a = idOf(await dispatch('log.steps' as never, { date: '2026-10-02', steps: 1000 } as never));
    await settleCommits();
    expect(code(await dispatch('log.edit' as never, { entryId: a, patch: { steps: 2500, date: '2026-10-01' } } as never) as never)).toBe('ok');
    const s = idOf(await dispatch('log.substance' as never, { date: '2026-10-02', substance: 'caffeine', clockH: 8, amount: 100, unit: 'mg' } as never));
    await settleCommits();
    expect(code(await dispatch('log.edit' as never, { entryId: s, patch: { amount: 150, clockH: 9.5 } } as never) as never)).toBe('ok');
    const s2 = idOf(await dispatch('log.substance' as never, { date: '2026-10-02', substance: 'caffeine', clockH: 8, amount: 100, unit: 'mg' } as never));
    await settleCommits();
    expect(code(await dispatch('log.edit' as never, { entryId: s2, patch: { unit: 'litres' } } as never) as never)).toBe('invalid_input');
  });
});
