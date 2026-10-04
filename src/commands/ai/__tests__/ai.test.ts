import { beforeEach, describe, expect, it } from 'vitest';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, getCommand, settleCommits, type CommandResult } from '../..';
import { AI, freshState } from '../../__tests__/harness';
import { aiConfigSettled, readAiConfig, recordAiUsage, summarizeAiUsage, type UsageSummary } from '..';

const err = (r: CommandResult) => (r.ok ? null : r.error);
const out = <T,>(r: CommandResult) => (r.ok && 'output' in r ? (r.output as T) : null);

const row = (ts: string, preset: string, model: string, inT: number, outT: number, costUsd: number | null = null) => ({
  ts, preset, model, in: inT, out: outT, cached: 0, costUsd, estimated: false, conversationId: null,
});

beforeEach(() => {
  freshState();
});

describe('ai.configure', () => {
  it('is UI-only and keeps its declared schema', () => {
    const def = getCommand('ai.configure')!;
    expect(def.surfaces).toEqual(['ui']);
    expect(def.notImplemented).toBeUndefined();
  });

  it('writes a validated config and persists it in uiPrefs', async () => {
    const r = await dispatch('ai.configure', { preset: { presetId: 'anthropic', model: 'claude-sonnet-5-5', spendCapUsdMonthly: 10 } });
    expect(r.ok).toBe(true);
    await settleCommits();
    expect(readAiConfig()).toEqual({ presetId: 'anthropic', model: 'claude-sonnet-5-5', smallEditsWithoutAsking: false, spendCapUsdMonthly: 10 });
    const doc = getDocumentStore().peek<Record<string, unknown>>('uiPrefs', 'me');
    expect(doc?.aiProvider).toMatchObject({ presetId: 'anthropic', smallEditsWithoutAsking: false });
  });

  it.each(['key', 'apiKey', 'secret', 'api_key', 'token'])('rejects a field named %s', async (name) => {
    const r = await dispatch('ai.configure', { preset: { presetId: 'openai', model: 'gpt-5.6-sol', [name]: 'sk-test-0000' } });
    expect(err(r)?.code).toBe('invalid_input');
    expect(JSON.stringify(err(r))).not.toContain('sk-test-0000');
    expect(readAiConfig()).toBeNull();
  });

  it('rejects nested secrets, unknown fields, bad URLs and custom endpoints without a style', async () => {
    expect(err(await dispatch('ai.configure', { preset: { presetId: 'openai', model: 'm', headers: { Authorization: 'x' } } }))?.code).toBe('invalid_input');
    expect(err(await dispatch('ai.configure', { preset: { presetId: 'openai', model: 'm', safety: { off: true } } }))?.detail?.path).toBe('/preset/safety');
    expect(err(await dispatch('ai.configure', { preset: { presetId: 'custom', model: 'm', baseUrl: 'http://example.com/v1', adapter: 'openai-chat' } }))?.detail?.path).toBe('/preset/baseUrl');
    expect(err(await dispatch('ai.configure', { preset: { presetId: 'custom', model: 'm', baseUrl: 'https://llm.example.com/v1' } }))?.detail?.path).toBe('/preset/adapter');
    const ok = await dispatch('ai.configure', { preset: { presetId: 'custom', model: 'm', baseUrl: 'https://llm.example.com/v1/', adapter: 'openai-chat' } });
    expect(out<{ config: { baseUrl: string } }>(ok)?.config.baseUrl).toBe('https://llm.example.com/v1');
  });

  it('refuses agents (UI only)', async () => {
    const r = await dispatch('ai.configure', { preset: { presetId: 'openai', model: 'gpt-5.6-sol' } }, { actor: AI });
    expect(err(r)?.code).toBe('surface_forbidden');
  });

  it('remove writes null', async () => {
    await dispatch('ai.configure', { preset: { presetId: 'openai', model: 'gpt-5.6-sol' } });
    const r = await dispatch('ai.configure', { preset: { remove: true } });
    expect(out<{ configured: boolean }>(r)?.configured).toBe(false);
    await settleCommits();
    await aiConfigSettled();
    expect(readAiConfig()).toBeNull();
    expect(getDocumentStore().peek<Record<string, unknown>>('uiPrefs', 'me')?.aiProvider ?? null).toBeNull();
  });
});

describe('ai.usage', () => {
  it('totals tokens and cost by provider and period', async () => {
    await recordAiUsage(row('2026-10-01T09:00:00', 'anthropic', 'claude-sonnet-5-5', 1_000_000, 100_000), { input: 2, output: 10 });
    await recordAiUsage(row('2026-10-01T10:00:00', 'anthropic', 'claude-sonnet-5-5', 500_000, 0, 0.5));
    await recordAiUsage(row('2026-09-28T10:00:00', 'openrouter', 'qwen/qwen3.8-flash', 1000, 1000));
    await recordAiUsage(row('2026-08-01T10:00:00', 'openai', 'gpt-5.6-sol', 1000, 1000, 1));
    await dispatch('ai.configure', { preset: { presetId: 'anthropic', model: 'claude-sonnet-5-5', spendCapUsdMonthly: 4 } });

    const s = summarizeAiUsage({ today: '2026-10-01' });
    expect(s.periods.today).toMatchObject({ requests: 2, inputTokens: 1_500_000, outputTokens: 100_000 });
    expect(s.periods.today.costUsd).toBeCloseTo(3.5);
    expect(s.periods.last7Days.requests).toBe(3);
    expect(s.periods.last7Days.unpriced).toBe(1);
    expect(s.periods.thisMonth.costUsd).toBeCloseTo(3.5);
    expect(s.byProvider.map((p) => p.preset)).toEqual(['anthropic', 'openrouter']);
    expect(s.capFraction).toBeCloseTo(0.875);
    expect(s.capWarning).toBe(true);
    expect(s.atCap).toBe(false);

    const r = await dispatch('ai.usage', { from: '2026-08-01', to: '2026-10-01' });
    const u = out<UsageSummary>(r)!;
    expect(u.totals.requests).toBe(4);
    expect(u.totals.costUsd).toBeCloseTo(4.5);
    expect(err(await dispatch('ai.usage', { from: '2026-10-02', to: '2026-10-01' }))?.code).toBe('invalid_input');
  });
});
