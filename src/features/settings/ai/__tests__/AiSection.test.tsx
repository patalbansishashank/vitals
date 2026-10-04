import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CapabilityCache, KeyVault, MemoryKv, type Capabilities } from '@/ai';
import { fakeFetch } from '@/ai/testing/fakeFetch';
import { dispatch, settleCommits } from '@/commands';
import { aiConfigSettled, readAiConfig, recordAiUsage } from '@/commands/ai';
import { freshState } from '@/commands/__tests__/harness';
import { isCoachAvailable, setCoachAvailable } from '@/features/living/coach/availability';
import { getDocumentStore } from '@/state/runtime';
import { MemoryRouter } from 'react-router';
import { setServerClientForTests } from '@/net/server';
import { fakeClient, fakeServer } from '../../server/__tests__/fakeServer';
import { AiSection } from '../AiSection';
import { probeErrorText } from '../copy';
import type { AiSectionDeps } from '../services';

const KEY = 'sk-ant-api03-SECRET-test-4f2a';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const CATALOGUE = { max_input_tokens: 200_000, max_tokens: 64_000, capabilities: { image_input: { supported: true }, structured_outputs: { supported: true } } };

/** jsdom's ArrayBuffer is not Node WebCrypto's: copy ciphertext into this realm so the vault's shape check passes. */
const realSubtle = globalThis.crypto.subtle;
const subtle = {
  generateKey: realSubtle.generateKey.bind(realSubtle),
  decrypt: realSubtle.decrypt.bind(realSubtle),
  encrypt: async (...args: Parameters<SubtleCrypto['encrypt']>) => new Uint8Array(await realSubtle.encrypt(...args)).slice().buffer,
} as unknown as SubtleCrypto;

function makeDeps(replies: Parameters<typeof fakeFetch>[0] = []) {
  const fake = fakeFetch(replies);
  const deps: AiSectionDeps = {
    vault: new KeyVault({ keys: new MemoryKv(), meta: new MemoryKv(), subtle, now: () => '2026-10-01T09:00:00.000Z' }),
    cache: new CapabilityCache(new MemoryKv<Capabilities>()),
    fetch: fake.fetch,
    now: () => new Date('2026-10-01T09:00:00.000Z'),
  };
  return { deps, fake };
}

const consoleText: string[] = [];

beforeEach(() => {
  freshState();
  setCoachAvailable(false);
  consoleText.length = 0;
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void consoleText.push(args.map((a) => (a instanceof Error ? a.message : JSON.stringify(a) ?? String(a))).join(' ')));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  setServerClientForTests(null);
});

async function pickAnthropicAndSaveKey(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: /^Anthropic/ }));
  await user.type(screen.getByLabelText('API key'), KEY);
  await user.click(screen.getByRole('button', { name: 'Save key' }));
  await screen.findByText('key saved • ends …4f2a');
}

describe('AiSection', () => {
  it('shows the empty state; small edits default off', () => {
    render(<AiSection deps={makeDeps().deps} />);
    expect(screen.getByText(/No AI provider\. The Coach is off/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /small plan edits without asking/i })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /stop the coach at the cap/i })).not.toBeChecked();
  });

  it('saves the key into the KeyVault only, never into config, documents or the console', async () => {
    const user = userEvent.setup();
    const { deps } = makeDeps();
    render(<AiSection deps={deps} />);
    await pickAnthropicAndSaveKey(user);
    expect(await deps.vault.get('anthropic', ANTHROPIC_BASE)).toBe(KEY);
    expect(screen.getByLabelText('API key')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Save provider' }));
    await screen.findByText('Saved.');
    await settleCommits();
    await aiConfigSettled();
    const config = readAiConfig();
    expect(config).toMatchObject({ presetId: 'anthropic', model: 'claude-sonnet-5-5', smallEditsWithoutAsking: false });
    expect(JSON.stringify(config)).not.toContain('4f2a');
    const docs = getDocumentStore().peekAll('uiPrefs').concat(getDocumentStore().peekAll('changeLog'));
    expect(JSON.stringify(docs)).not.toContain(KEY);
    expect(consoleText.join('\n')).not.toContain(KEY);
    // Without a check showing tool use, saving leaves Coach availability to the runtime.
    expect(isCoachAvailable()).toBe(false);
  });

  it('runs the capability check, shows results, caches them, and switches the Coach on when saved', async () => {
    const user = userEvent.setup();
    const { deps, fake } = makeDeps([{ json: CATALOGUE }]);
    render(<AiSection deps={deps} />);
    await pickAnthropicAndSaveKey(user);
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    const table = await screen.findByRole('table', { name: /what this model can do/i });
    expect(within(table).getByRole('row', { name: /use Vitals’ tools/ })).toHaveTextContent('✓ yes');
    expect(within(table).getByRole('row', { name: /read food photos/ })).toHaveTextContent('✓ yes');
    expect(within(table).getByRole('row', { name: /memory/ })).toHaveTextContent(`${(200000).toLocaleString()} tokens`); // locale-formatted, like the component
    expect(within(table).getByRole('row', { name: /latency/ })).toHaveTextContent(/\d+ ms/);
    expect(within(table).getByRole('row', { name: /basic tier/ })).toHaveTextContent('no');
    expect(screen.getByText('Supported')).toBeInTheDocument();
    expect(fake.requests[0]!.url).toBe(`${ANTHROPIC_BASE}/models/claude-sonnet-5-5`);
    expect(await deps.cache.get(ANTHROPIC_BASE, 'claude-sonnet-5-5', '2026-10-02T00:00:00.000Z')).toMatchObject({ tools: true, vision: true, source: 'catalog' });

    await user.click(screen.getByRole('button', { name: 'Save provider' }));
    await screen.findByText('Saved.');
    expect(isCoachAvailable()).toBe(true);
  });

  it('reports a refused key', async () => {
    const user = userEvent.setup();
    const { deps } = makeDeps([{ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }]);
    render(<AiSection deps={deps} />);
    await pickAnthropicAndSaveKey(user);
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Anthropic refused this key. Check it and try again.')).toBeInTheDocument();
  });

  it('an endpoint that does not answer gets an honest error, not just "refuses web pages"', () => {
    for (const kind of ['cors', 'blocked']) {
      const text = probeErrorText(kind, 'your server');
      expect(text).toMatch(/^No answer from your server: it may not be running or reachable, or it may not accept requests from a web page\./);
      expect(text).toMatch(/Check the address and that the server is running/);
    }
    expect(probeErrorText('cors', 'Ollama', 'Start Ollama with OLLAMA_ORIGINS=x.')).toMatch(/not be running.*Start Ollama with OLLAMA_ORIGINS=x\.$/);
    expect(probeErrorText('auth', 'your server')).toBe('Your server refused this key. Check it and try again.');
  });

  it('lists the three server providers under "via your server"; without a server they ask to pair first', async () => {
    const user = userEvent.setup();
    setServerClientForTests(fakeClient().client);
    render(<AiSection deps={makeDeps().deps} />, { wrapper: MemoryRouter });
    expect(screen.getByText('via your server')).toBeInTheDocument();
    expect(screen.getAllByText('needs your server')).toHaveLength(3);
    await user.click(screen.getByRole('radio', { name: /NVIDIA NIM/ }));
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
    expect(screen.getByText('This provider works through your server. Pair this device with your server first.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pair a server' })).toHaveAttribute('href', '/settings/server');
    expect(screen.queryByRole('button', { name: 'Load the model list' })).not.toBeInTheDocument();
  });

  it('paired: state chips, a key typed once goes to the server and never into this browser', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient({ paired: true });
    setServerClientForTests(client);
    const { deps } = makeDeps();
    deps.serverOptions = () => client.chatModelOptions();
    render(<AiSection deps={deps} />, { wrapper: MemoryRouter });
    expect(await screen.findByText('key set')).toBeInTheDocument();
    expect(screen.getAllByText('no key').length).toBeGreaterThan(0);
    expect(screen.getByText('not signed in')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /NVIDIA NIM/ }));
    expect(screen.getByText(/Your key is sent once to your server/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('API key'), 'nvapi-SECRET-9999');
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    expect(await screen.findByText('key set on your server')).toBeInTheDocument();
    expect(server.state.keys.nim).toBe('nvapi-SECRET-9999');
    expect(await deps.vault.get('nim', 'https://integrate.api.nvidia.com/v1')).toBeNull();
    expect(JSON.stringify(readAiConfig())).not.toContain('nvapi');
    expect(consoleText.join(' ')).not.toContain('SECRET');
  });

  it('loads the model list through the server with the device token', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient({ paired: true });
    setServerClientForTests(client);
    const { deps } = makeDeps();
    deps.serverOptions = () => client.chatModelOptions();
    render(<AiSection deps={deps} />, { wrapper: MemoryRouter });
    await user.click(screen.getByRole('radio', { name: /OpenCode Zen/ }));
    await user.click(screen.getByRole('button', { name: 'Load the model list' }));
    expect(await screen.findByText('2 models listed by the provider.')).toBeInTheDocument();
    expect(server.state.calls.some((c) => c.path === '/v1/ai/opencode-zen/models' && c.auth?.startsWith('Bearer '))).toBe(true);
  });

  it('ChatGPT: signed in on the server, no sign-in button in the browser; errors in the server\'s words', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient({ paired: true, server: fakeServer({ siwc: { signedIn: true, plan: 'Plus' } }) });
    setServerClientForTests(client);
    const { deps } = makeDeps();
    deps.serverOptions = () => client.chatModelOptions();
    render(<AiSection deps={deps} />, { wrapper: MemoryRouter });
    await user.click(screen.getByRole('radio', { name: /Sign in with ChatGPT/ }));
    expect(await screen.findByText(/Signed in on your server · Plus plan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Sign in/ })).not.toBeInTheDocument();
    server.state.fail = { status: 409, code: 'not_signed_in' };
    await user.click(screen.getByRole('button', { name: 'Load the model list' }));
    expect(await screen.findByText("ChatGPT isn't signed in on your server yet. Whoever runs your server can do that once.", {}, { timeout: 15000 })).toBeInTheDocument();
  }, 30000);

  it('warns when the month passes 80 % of the spending cap', async () => {
    await dispatch('ai.configure', { preset: { presetId: 'anthropic', model: 'claude-sonnet-5-5', spendCapUsdMonthly: 10 } });
    await recordAiUsage({ ts: '2026-10-01T08:00:00.000Z', preset: 'anthropic', model: 'claude-sonnet-5-5', in: 1000, out: 100, cached: 0, costUsd: 8.5, estimated: false, conversationId: null });
    render(<AiSection deps={makeDeps().deps} />);
    expect(await screen.findByText(/You've used 85 % of this month's cap \(\$10\)/)).toBeInTheDocument();
  });

  it('remove provider writes null config, forgets the key and switches the Coach off at once', async () => {
    const user = userEvent.setup();
    const { deps } = makeDeps();
    await deps.vault.save('anthropic', ANTHROPIC_BASE, KEY, { mode: 'device' });
    await dispatch('ai.configure', { preset: { presetId: 'anthropic', model: 'claude-sonnet-5-5' } });
    setCoachAvailable(true);
    render(<AiSection deps={deps} />);
    await screen.findByText('key saved • ends …4f2a');
    await user.click(screen.getByRole('button', { name: 'Remove provider' }));
    await screen.findByText(/Provider removed/);
    expect(readAiConfig()).toBeNull();
    expect(isCoachAvailable()).toBe(false);
    expect(await deps.vault.get('anthropic', ANTHROPIC_BASE)).toBeNull();
  });

  it('exposes no safety controls', () => {
    render(<AiSection deps={makeDeps().deps} />);
    const section = screen.getByRole('region', { name: 'AI provider' });
    expect(within(section).queryByText(/safety mode|screening|guardrail/i)).toBeNull();
  });
});
