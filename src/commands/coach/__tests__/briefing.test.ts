/**
 * Plan 04 item 12: `briefing_get` gives an agent over MCP the Coach's briefing. One fixture person (a running plan,
 * kitchen, pantry, a few logs), the Coach's path (`gatherBriefingData` + `buildBriefing` with a provider) and the MCP
 * path exactly as the server runs it (`guardedCall(createBusAgentDispatcher({directApply: () => false}), …, 'mcp', …)`,
 * what `busPersonDispatch` does in the person worker) give the same text; a stream hidden from the Coach is absent
 * from both.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardedCall } from '@/agents/dispatcher';
import { buildBriefing, gatherBriefingData, KITCHEN_RULE, MEDICAL_DISCLAIMER, STATIC_BRIEFING } from '@/ai/coach/briefing';
import type { CoachBus } from '@/ai/coach/tools';
import { stageFile, clearStaged } from '@/biometrics/app/handoff';
import { bioActivity } from '@/biometrics/app/activity';
import { getScoreDef } from '@/biometrics/core/scores';
import { addDays } from '@/living/dates';
import { createMemoryBlobStore, setBlobStore } from '@/state/blobStore';
import { allCommands, buildManifest, dispatch, getCommand, jobs, on, settleCommits, type CommandResult } from '@/commands';
import { createBusAgentDispatcher } from '@/commands/ai/agentDispatcher';
import { setTimeZoneSource } from '@/commands/bus';
import { resetBioRuntime } from '@/commands/bio/runtime';
import { AI, freshState } from '@/commands/__tests__/harness';
import { seedPlan } from '@/commands/food/__tests__/seed';
import { toolManifest } from '@/commands/manifest';
import * as rules from '../../../../packages/companion/src/briefingRules.ts';
import CSV from '@/biometrics/importers/__fixtures__/canonical.csv?raw';

const bus: CoachBus = {
  dispatch: (id, input, opts) => dispatch(id, input, opts),
  manifest: () => buildManifest('ai'),
  getCommand: (id) => getCommand(id),
  commandIds: () => allCommands().map((d) => d.id),
  on: (l) => on(l),
};

interface BriefingOut {
  text: string;
  sections: string[];
  dropped: string[];
  truncated: string[];
  quiet: boolean;
  noPlanning: boolean;
  today: string;
  generatedAt: string;
}

/** The MCP path as the person worker runs it (`busPersonDispatch`): the app's guard over the bus, never direct apply. */
async function viaMcp(): Promise<BriefingOut> {
  const dispatcher = createBusAgentDispatcher({ directApply: () => false });
  const envelope = await guardedCall(dispatcher, await dispatcher.manifest(), 'mcp', 'briefing_get', {}, { actor: { kind: 'mcp', id: 't' } });
  if (!envelope.ok) throw new Error(JSON.stringify(envelope));
  return envelope.data as BriefingOut;
}

/** The Coach's path (`rebuildBriefing` in the adapter), at the same instant and day. */
async function viaCoach(b: BriefingOut) {
  const data = await gatherBriefingData(bus, new Date(b.generatedAt), b.today, addDays);
  return buildBriefing(data, { provider: { name: 'OpenRouter', model: 'Claude Sonnet 5.5' }, addDays });
}

function out<T>(r: CommandResult): T {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
}

async function job(r: CommandResult): Promise<void> {
  if (!r.ok || !('job' in r)) throw new Error(`expected a job: ${JSON.stringify(r)}`);
  const st = await jobs.wait(r.job.jobId);
  if (st.state !== 'done') throw new Error(`job ${st.state}: ${JSON.stringify(st.error)}`);
}

// late registration of executors the briefing reads (intake.nextQuestions; see ../late.ts)
beforeAll(() => vi.waitFor(() => expect(getCommand('intake.nextQuestions')!.notImplemented).toBeUndefined()));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  freshState({ cleared: true });
  setBlobStore(createMemoryBlobStore());
  resetBioRuntime();
  clearStaged();
  bioActivity.reset();
});
afterEach(() => {
  vi.useRealTimers();
  setTimeZoneSource(null);
});

describe('shared rules (briefingRules.ts)', () => {
  it('the Coach re-exports the very same texts', () => {
    expect(STATIC_BRIEFING).toBe(rules.STATIC_BRIEFING);
    expect(KITCHEN_RULE).toBe(rules.KITCHEN_RULE);
    expect(MEDICAL_DISCLAIMER).toBe(rules.MEDICAL_DISCLAIMER);
    expect(buildBriefing({ now: '2026-10-02T08:00:00.000Z', today: '2026-10-02' }).sections[0]).toEqual({ id: 'static', text: rules.STATIC_BRIEFING });
  });

  it('both rule sets tell the agent that needs_choice means nothing was saved (J3-02)', () => {
    for (const text of [rules.STATIC_BRIEFING, rules.MCP_INSTRUCTIONS]) {
      expect(text).toMatch(/needs_choice.*nothing was saved.*call log_meal again/);
    }
  });

  it('every tool the MCP instructions name is an MCP tool; briefing_get is a read for every agent token', () => {
    const mcp = toolManifest('mcp').tools;
    const names = new Set(mcp.map((t) => t.name));
    const named = [...new Set(rules.MCP_INSTRUCTIONS.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])].filter((w) => !['safety_blocked', 'pending_user', 'needs_choice'].includes(w));
    expect(named.length).toBeGreaterThan(5);
    expect(named.filter((n) => !names.has(n))).toEqual([]);
    expect(rules.MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(2600);
    const tool = mcp.find((t) => t.name === 'briefing_get')!;
    expect(tool).toMatchObject({ id: 'briefing.get', perm: 'read', confirm: 'read', annotations: { readOnlyHint: true } });
    expect(toolManifest('ai').tools.some((t) => t.name === 'briefing_get')).toBe(false);
  });
});

describe('proposals in the briefing', () => {
  it('agents get how many proposals wait, never their ids (coach.pending is not on their surface)', () => {
    const d = { now: '2026-10-02T08:00:00.000Z', today: '2026-10-02', pending: [{ commandId: 'plan.replan', pendingId: 'p-123' }] };
    expect(buildBriefing(d).text).toContain('Proposals waiting for the person: plan.replan (p-123).');
    const agent = buildBriefing(d, { pendingCountOnly: true }).text;
    expect(agent).toContain('1 proposal waits for the person to review in the app.');
    expect(agent).not.toMatch(/p-123|plan\.replan/);
  });
});

describe('briefing_get = the Coach briefing', () => {
  it('one fixture person: the MCP path gives the Coach path’s text, with the plan line and the kitchen rule', { timeout: 60_000 }, async () => {
    vi.setSystemTime(new Date('2026-10-02T08:00:00.000Z'));
    await seedPlan();
    out(await dispatch('kitchen.add', { items: [{ label: 'soda maker' }, { label: 'egg boiler', note: '6 eggs' }] }));
    out(await dispatch('pantry.add', { items: [{ label: 'paneer', qtyApprox: '200 g' }, { label: 'bhindi' }] }));
    out(await dispatch('log.note', { date: '2026-09-30', text: 'slept badly' }));
    out(await dispatch('log.steps', { date: '2026-10-01', steps: 9400 }));
    out(await dispatch('log.measurement', { date: '2026-10-01', metric: 'weightKg', value: 89.2, context: 'morningFasted', method: 'scale' }));
    await settleCommits();

    const mcp = await viaMcp();
    const coach = await viaCoach(mcp);
    expect(mcp.text).toBe(coach.text);
    expect(mcp.sections).toEqual(coach.sections.map((s) => s.id));
    expect(mcp).toMatchObject({ quiet: coach.quiet, noPlanning: coach.noPlanning, dropped: coach.dropped, today: '2026-10-02' });
    expect(mcp.text).toContain('Plan: Medium plan (rung medium), day 5 of 28');
    expect(mcp.text).toContain(KITCHEN_RULE);
    expect(mcp.text).toContain(STATIC_BRIEFING);
    expect(mcp.text).toMatch(/Paneer|paneer/);
    expect(mcp.text).toContain('2026-09-30: note "slept badly"');
    // the provider is only in the visible panel, never in the text
    expect(coach.visible.provider).toEqual({ name: 'OpenRouter', model: 'Claude Sonnet 5.5' });
    expect(mcp.text).not.toContain('OpenRouter');
  });

  it('uses the person’s time zone from the command context (the server sets it)', async () => {
    vi.setSystemTime(new Date('2026-10-02T08:00:00.000Z'));
    setTimeZoneSource(() => 'Pacific/Kiritimati');
    const mcp = await viaMcp();
    expect(mcp.text).toContain('time zone Pacific/Kiritimati');
    // the Coach gives no zone and keeps the host's, exactly as before
    const data = await gatherBriefingData(bus, new Date(mcp.generatedAt), mcp.today, addDays);
    expect(data.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('its own reads do not count against the agent’s per-turn limits', async () => {
    vi.setSystemTime(new Date('2026-10-02T08:00:00.000Z'));
    for (let i = 0; i < 5; i++) expect((await viaMcp()).text).toContain('Now: 2026-10-02T08:00:00.000Z');
    // the briefing read today.get 5 times as the Coach's reader; the agent still has its whole budget for today_get (20)
    const dispatcher = createBusAgentDispatcher({ directApply: () => false });
    const m = await dispatcher.manifest();
    for (let i = 0; i < 20; i++) expect((await guardedCall(dispatcher, m, 'mcp', 'today_get', {}, { actor: { kind: 'mcp', id: 't' } })).ok).toBe(true);
  });

  it('an agent past its per-turn limit gets the tool back a minute later (no lockout for the life of the worker)', async () => {
    vi.setSystemTime(new Date('2026-10-02T08:00:00.000Z'));
    const dispatcher = createBusAgentDispatcher({ directApply: () => false });
    const m = await dispatcher.manifest();
    const call = async () => (await guardedCall(dispatcher, m, 'mcp', 'today_get', {}, { actor: { kind: 'mcp', id: 't' } })).error?.code ?? 'ok';
    const codes: string[] = [];
    for (let i = 0; i < 21; i++) codes.push(await call());
    expect(codes.slice(0, 20).every((c) => c === 'ok')).toBe(true);
    expect(codes[20]).toBe('rate_limited');
    vi.setSystemTime(new Date('2026-10-02T08:01:00.000Z'));
    expect(await call()).toBe('ok');
  });
});

describe('what the Coach cannot see, an agent cannot see', () => {
  const DAY = '2026-03-10';

  it('a ring stream hidden from the Coach leaves the scores out of both briefings', { timeout: 60_000 }, async () => {
    vi.setSystemTime(new Date('2026-03-12T12:00:00.000Z'));
    const fileRef = stageFile(new Blob([CSV], { type: 'text/csv' }), 'vitals.csv');
    await job(await dispatch('bio.import', { fileRef }));
    await settleCommits();
    // share what the scores read with the Coach (Settings › Devices, person level), then score the day
    const streams = ['steps', 'hr', 'hrv', 'sleep_sessions', 'spo2', 'body', 'daily_summary', 'distance'];
    for (const stream of streams) out(await dispatch('bio.setPolicy', { stream, policy: { imported: true, coach: 'daily+series', scores: true } }));
    await settleCommits();
    await job(await dispatch('bio.rescore', { from: DAY }));
    await settleCommits();

    // the first score the Coach sees (the briefing keeps the start of the scores line)
    const seen = out<{ results: Array<{ scoreId: string }> }>(await dispatch('bio.scores', { from: '2026-03-05', to: '2026-03-12' }, { actor: AI }));
    const shown = seen.results[0];
    expect(shown && getScoreDef(shown.scoreId)?.optInStreams.length, 'a score from the ring data').toBeGreaterThan(0);
    const id = shown!.scoreId;

    const before = await viaMcp();
    expect(before.text).toContain(`"scoreId":"${id}"`);
    expect((await viaCoach(before)).text).toBe(before.text);

    // "Change what it can see": hide one stream that score reads
    const stream = getScoreDef(id)!.optInStreams[0]!;
    out(await dispatch('bio.setPolicy', { stream, policy: { coach: 'hidden' } }));
    await settleCommits();

    const after = await viaMcp();
    const coach = await viaCoach(after);
    expect(after.text).not.toContain(`"scoreId":"${id}"`);
    expect(coach.text).not.toContain(`"scoreId":"${id}"`);
    expect(after.text).toBe(coach.text);
    // the person still sees it in the app
    expect(out<{ results: Array<{ scoreId: string }> }>(await dispatch('bio.scores', { from: DAY, to: '2026-03-12' })).results.map((r) => r.scoreId)).toContain(id);
  });
});
