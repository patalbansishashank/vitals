/** Coach runtime: reads the key Settings saved for the configured provider (custom endpoints included). */
import { afterEach, describe, expect, it } from 'vitest';
import { writeAiConfig } from '@/commands/ai/config';
import type { KeyVault } from '../../keys';
import { createChatModel } from '../../providers';
import { CapabilityCache } from '../../providers/probe';
import { MemoryKv } from '../../storage/kv';
import { fakeFetch, sse } from '../../testing/fakeFetch';
import type { ChatModel } from '../../providers/types';
import { createCoachRuntime } from '../runtime';
import { createMemoryConversationStore } from '../conversation';

afterEach(() => writeAiConfig(null, { persist: false }));

describe('createCoachRuntime', () => {
  it('looks a custom endpoint’s key up under the config’s preset id, as Settings saves it', async () => {
    const asked: string[] = [];
    const vault = { get: async (id: string, url: string) => (asked.push(`${id}|${url}`), id === 'custom' ? 'sk-saved' : null) } as unknown as KeyVault;
    const keys: string[] = [];
    const problems: Array<string | null> = [];
    writeAiConfig({ presetId: 'custom', baseUrl: 'http://127.0.0.1:4190/v1', adapter: 'openai-chat', model: 'm', smallEditsWithoutAsking: false }, { persist: false });
    const rt = createCoachRuntime({
      setAvailable: () => undefined,
      setProblem: (p) => problems.push(p),
      keyVault: vault,
      clearPorts: () => undefined,
      createModel: ((o: { apiKey?: string }) => {
        keys.push(o.apiKey ?? '');
        throw new Error('stop here');
      }) as never,
    });
    await rt.settled();
    rt.stop();
    expect(asked).toEqual(['custom|http://127.0.0.1:4190/v1']);
    expect(keys).toEqual(['sk-saved']);
    // a setup failure is reported as such (the Coach shows it instead of "needs an AI provider")
    expect(problems).toEqual(['stop here']);
  });

  it('builds server presets with the paired server\'s token-adding fetch (the server answers 401 without it)', async () => {
    const seen: Array<{ serverUrl?: string; hasFetch: boolean; apiKey?: string }> = [];
    const problems: Array<string | null> = [];
    const pairedFetch = (async () => new Response('{}')) as typeof fetch;
    writeAiConfig({ presetId: 'siwc', model: 'gpt-5.6-sol', smallEditsWithoutAsking: false }, { persist: false });
    const rt = createCoachRuntime({
      setAvailable: () => undefined,
      setProblem: (p) => problems.push(p),
      clearPorts: () => undefined,
      serverOptions: (presetId) => (presetId === 'siwc' ? { serverUrl: 'https://vitals.example.ts.net:8443', deps: { fetch: pairedFetch } } : (() => { throw new Error('unexpected ' + presetId); })()),
      createModel: ((o: { serverUrl?: string; deps?: { fetch?: unknown }; apiKey?: string }) => {
        seen.push({ ...(o.serverUrl ? { serverUrl: o.serverUrl } : {}), hasFetch: o.deps?.fetch === pairedFetch, ...(o.apiKey !== undefined ? { apiKey: o.apiKey } : {}) });
        throw new Error('stop here');
      }) as never,
    });
    await rt.settled();
    rt.stop();
    expect(seen).toEqual([{ serverUrl: 'https://vitals.example.ts.net:8443', hasFetch: true, apiKey: '' }]);
    expect(problems).toEqual(['stop here']);
  });

  it('suspended while the Coach runs on the paired server: no model, no ports, unavailable; resumed unchanged', async () => {
    const built: string[] = [];
    const available: boolean[] = [];
    let cleared = 0;
    writeAiConfig({ presetId: 'custom', baseUrl: 'http://127.0.0.1:4190/v1', adapter: 'openai-chat', model: 'm', smallEditsWithoutAsking: false }, { persist: false });
    const rt = createCoachRuntime({
      setAvailable: (on) => available.push(on),
      keyVault: { get: async () => 'sk-saved' } as unknown as KeyVault,
      capabilityCache: new CapabilityCache(new MemoryKv()),
      clearPorts: () => void cleared++,
      installPorts: () => undefined,
      createModel: ((o: Parameters<typeof createChatModel>[0]) => (built.push(o.model ?? ""), createChatModel({ ...o, deps: { fetch: (async () => new Response('{}', { status: 500 })) as typeof fetch } }))) as typeof createChatModel,
    });
    await rt.settled();
    expect(rt.adapter()).not.toBeNull();
    const before = built.length;
    await rt.setSuspended(true);
    expect(rt.adapter()).toBeNull();
    expect(rt.recipes()).toBeNull();
    expect(available.at(-1)).toBe(false);
    expect(cleared).toBeGreaterThan(0);
    // a configuration change while suspended builds nothing
    writeAiConfig({ presetId: 'custom', baseUrl: 'http://127.0.0.1:4190/v1', adapter: 'openai-chat', model: 'm2', smallEditsWithoutAsking: false }, { persist: false });
    await rt.settled();
    expect(built.length).toBe(before);
    expect(rt.adapter()).toBeNull();
    await rt.setSuspended(false);
    expect(rt.adapter()).not.toBeNull();
    expect(built.at(-1)).toBe('m2');
    rt.stop();
  });

  it('reports "connect first" in plain words when this device is not paired with a server', async () => {
    const problems: Array<string | null> = [];
    writeAiConfig({ presetId: 'opencode-zen', model: 'claude-sonnet-5-5', smallEditsWithoutAsking: false }, { persist: false });
    const rt = createCoachRuntime({
      setAvailable: () => undefined,
      setProblem: (p) => problems.push(p),
      clearPorts: () => undefined,
      serverOptions: () => { throw new Error('This device is not connected to your server yet. Connect it in Settings › Server.'); },
      createModel: (() => { throw new Error('must not be reached'); }) as never,
    });
    await rt.settled();
    rt.stop();
    expect(problems).toEqual(['This device is not connected to your server yet. Connect it in Settings › Server.']);
  });

  it('records the usage of model calls made outside the turn loop (photo recognition, recipes) in the spend ledger', async () => {
    const reply = sse({ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 30 } }, 'data: [DONE]\n\n');
    const ff = fakeFetch([{ text: reply }]);
    const vault = { get: async () => 'sk-test-0123456789' } as unknown as KeyVault;
    const rows: Array<{ in: number; out: number; conversationId: string | null }> = [];
    let ports: ChatModel | null = null;
    writeAiConfig({ presetId: 'openai-chat', model: 'gpt-5.6-sol', smallEditsWithoutAsking: false }, { persist: false });
    const rt = createCoachRuntime({
      setAvailable: () => undefined,
      keyVault: vault,
      capabilityCache: new CapabilityCache(new MemoryKv()),
      clearPorts: () => undefined,
      installPorts: (m) => (ports = m),
      recordUsage: async (row) => void rows.push(row),
      createModel: ((o: Parameters<typeof createChatModel>[0]) => createChatModel({ ...o, deps: { fetch: ff.fetch } })) as typeof createChatModel,
    });
    await rt.settled();
    rt.stop();
    expect(ports).not.toBeNull();
    await ports!.complete({ messages: [{ role: 'user', parts: [{ type: 'text', text: 'what is in this photo' }] }] });
    expect(rows).toEqual([expect.objectContaining({ in: 1200, out: 30, conversationId: null })]);
  });

  it('drops the cached capabilities when a turn ends on a 400 that names an unsupported parameter (V1e-09)', async () => {
    const ff = fakeFetch([{ status: 400, json: { error: { message: "Unsupported parameter: 'parallel_tool_calls' is not supported with this model." } } }]);
    const vault = { get: async () => 'sk-test-0123456789' } as unknown as KeyVault;
    const cache = new CapabilityCache(new MemoryKv());
    writeAiConfig({ presetId: 'openai-chat', model: 'gpt-5.6-sol', smallEditsWithoutAsking: false }, { persist: false });
    const rt = createCoachRuntime({
      setAvailable: () => undefined,
      keyVault: vault,
      capabilityCache: cache,
      adapterExtras: { store: createMemoryConversationStore() },
      clearPorts: () => undefined,
      installPorts: () => undefined,
      recordUsage: async () => undefined,
      createModel: ((o: Parameters<typeof createChatModel>[0]) => createChatModel({ ...o, deps: { fetch: ff.fetch } })) as typeof createChatModel,
    });
    await rt.settled();
    rt.stop();
    const adapter = rt.adapter()!;
    const model = createChatModel({ preset: (await import('../../providers')).resolvePreset('openai-chat'), model: 'gpt-5.6-sol', apiKey: 'x' });
    const nowIso = new Date().toISOString();
    await cache.set(model.baseUrl, model.model, { ...model.capabilities, verifiedAt: nowIso });
    expect(await cache.get(model.baseUrl, model.model, nowIso)).toBeDefined();
    const errors: string[] = [];
    await adapter.send({ conversationId: 'coach', text: 'hello' }, (e) => void (e.type === 'error' && errors.push(e.kind)), new AbortController().signal);
    await new Promise((r) => setTimeout(r, 0));
    expect(errors.length).toBe(1);
    expect(await cache.get(model.baseUrl, model.model, nowIso)).toBeUndefined();
  });
});
