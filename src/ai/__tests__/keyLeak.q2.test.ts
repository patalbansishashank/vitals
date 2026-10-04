/**
 * Release gate Q2 (SUITE_SPEC §5.1 "Keys never appear in exports, logs or transcripts"): a provider key saved in the
 * KeyVault, used by the Coach runtime for real turns over the real command bus — a log tool call, usage accounting,
 * then a refused key whose error body echoes the key back — never appears in:
 *   - the console (every console method),
 *   - the Coach transcript and the in-memory change history,
 *   - any document of any collection (so in nothing the sync engine can receive: only `sync: 'yes'` collections
 *     reach Evolu, a subset of these),
 *   - the export file (`serializeExport(exportAll())`, what `data.export` writes),
 *   - localStorage.
 * The key is sent only as the provider's auth header (checked, so the test is not vacuous).
 */
import { inspect } from 'node:util';
import { changeSets, dispatch, seal, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { writeAiConfig } from '@/commands/ai/config';
// eslint-disable-next-line no-restricted-imports -- the test reads the export file the app writes
import { exportAll, serializeExport } from '@/state/persistence';
import { COLLECTIONS, type MemoryBackend } from '@/store';
import { createCoachRuntime } from '../coach/runtime';
import { MAIN_CONVERSATION } from '../coach/types';
import { KeyVault } from '../keys';
import { createChatModel, getPreset, presetCapabilities } from '../providers';
import { CapabilityCache } from '../providers/probe';
import { MemoryKv } from '../storage/kv';
import { fakeFetch, instantSleep, sse, type FakeReply } from '../testing/fakeFetch';

const FAKE_KEY = 'sk-or-v1-Q2FAKEKEY-0123456789abcdefDO-NOT-LEAK';
const PRESET = 'openrouter';
const MODEL = 'anthropic/claude-sonnet-5.5';

const toolTurn = (name: string, args: unknown): FakeReply => ({
  text: sse(
    { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_k1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 900, completion_tokens: 20 } },
    'data: [DONE]\n\n',
  ),
});
const textTurn = (t: string): FakeReply => ({ text: sse({ choices: [{ index: 0, delta: { content: t }, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 950, completion_tokens: 8 } }, 'data: [DONE]\n\n') });
/** A provider that echoes the key it refused (some local servers and proxies do). */
const refused: FakeReply = { status: 401, json: { error: { message: `Incorrect API key provided: ${FAKE_KEY}`, type: 'invalid_request_error', code: 'invalid_api_key' } } };

const captured: string[] = [];
const METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

beforeEach(() => {
  captured.length = 0;
  for (const m of METHODS) vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void captured.push(args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 8 }))).join(' ')));
});
afterEach(() => {
  vi.restoreAllMocks();
  writeAiConfig(null, { persist: false });
});

async function allDocuments(backend: MemoryBackend): Promise<string> {
  await seal();
  await settleCommits();
  const out: unknown[] = [];
  for (const col of Object.keys(COLLECTIONS)) out.push(col, await backend.list(col, { includeDeleted: true }));
  return JSON.stringify(out);
}

describe('a provider API key never leaks', () => {
  it('is absent from console, transcript, history, every document, the export and localStorage', async () => {
    const { backend } = freshState({ cleared: true });
    const preset = getPreset(PRESET)!;

    // Settings: the key goes to the vault, the provider choice through ai.configure (as the person)
    const vault = new KeyVault({ keys: new MemoryKv(), meta: new MemoryKv(), now: () => '2026-10-01T08:00:00.000Z', requestPersist: async () => true });
    // session mode: under jsdom the vault's at-rest record check trips on cross-realm ArrayBuffers (at-rest encryption
    // is covered by src/ai/keys.test.ts); either way the vault is its own store, outside every document collection
    await vault.save(PRESET, preset.baseUrl, FAKE_KEY, { mode: 'session' });
    expect(await vault.get(PRESET, preset.baseUrl)).toBe(FAKE_KEY);
    const configured = await dispatch('ai.configure', { preset: { presetId: PRESET, model: MODEL } });
    expect(configured.ok).toBe(true);

    // capabilities already known (no probe request)
    const cache = new CapabilityCache(new MemoryKv());
    await cache.set(preset.baseUrl, MODEL, { ...presetCapabilities(preset), tools: true, parallelTools: true, vision: false, verifiedAt: '2026-10-01T07:00:00.000Z', source: 'catalog' });

    const ff = fakeFetch([toolTurn('log_note', { text: 'Slept badly', date: '2026-10-01' }), textTurn('Noted.'), refused]);
    const rt = createCoachRuntime({
      setAvailable: () => undefined,
      keyVault: vault,
      capabilityCache: cache,
      installPorts: () => undefined,
      clearPorts: () => undefined,
      createModel: (o) => createChatModel({ ...o, deps: { fetch: ff.fetch, sleep: instantSleep().sleep, random: () => 0 } }),
      adapterExtras: { sleep: async () => undefined, maxRateRetries: 0 },
    });
    await rt.settled();
    const adapter = rt.adapter();
    expect(adapter, rt.problem() ?? '').not.toBeNull();

    await adapter!.send({ conversationId: MAIN_CONVERSATION, text: 'note that I slept badly' }, () => undefined, new AbortController().signal);
    await adapter!.send({ conversationId: MAIN_CONVERSATION, text: 'and again' }, () => undefined, new AbortController().signal);
    rt.stop();

    // the key was really used, and only as the auth header
    expect(ff.requests).toHaveLength(3);
    for (const r of ff.requests) {
      expect(r.headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
      expect(JSON.stringify(r.body)).not.toContain(FAKE_KEY);
    }
    const turns = adapter!.history(MAIN_CONVERSATION);
    expect(turns.flatMap((t) => t.cards).some((c) => c.class === 'log' && c.state === 'applied')).toBe(true);
    // the refused key was reported (in plain words), so the error path ran
    expect(JSON.stringify(turns.at(-1))).toMatch(/refused/i);

    const docs = await allDocuments(backend);
    expect(docs).toContain('Slept badly');
    // the conversation itself is stored (synced collections conversations/messages)
    expect(docs).toContain('note that I slept badly');
    expect(docs).toMatch(/"aiUsage"|aiUsage/);
    const exportFile = serializeExport(exportAll(new Date('2026-10-01T09:00:00.000Z')));
    const sinks: Record<string, string> = {
      console: captured.join('\n'),
      transcript: JSON.stringify(turns),
      history: JSON.stringify(changeSets()),
      documents: docs,
      export: exportFile,
      localStorage: JSON.stringify({ ...globalThis.localStorage }),
    };
    for (const [sink, text] of Object.entries(sinks)) {
      expect(text.includes(FAKE_KEY), `${sink} contains the API key`).toBe(false);
      // nor a recognisable fragment of it
      expect(text.includes('Q2FAKEKEY'), `${sink} contains part of the API key`).toBe(false);
    }
  });
});
