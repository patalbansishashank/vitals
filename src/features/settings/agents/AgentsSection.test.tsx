import { MemoryRouter } from 'react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { recordAgentActivity, resetAgentActivityForTests } from '@/agents/activity';
import { setServerClientForTests } from '@/net/server';
import { setPlatformForTests } from '@/platform';
import { BASE, fakeClient, TOKEN } from '../server/__tests__/fakeServer';
import { isWebMcpEnabled } from '@/agents/webmcp';
import { AgentActivityIndicator } from './AgentActivityIndicator';
import { AgentsSection } from './AgentsSection';

// The screen writes through `dispatch('agents.configure', …)`: a fake that keeps the agent settings in memory.
const fake = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]>, settings: { clients: {} } as { webmcp?: boolean; clients: Record<string, { directApply: boolean }> }, fail: false }));
const fakeDispatch = vi.hoisted(() => async (id: string, input: { webmcp?: boolean; clients?: Record<string, { directApply: boolean }> }) => {
  // the proposals list reads `coach.pending` (tested in ProposalsList.test.tsx): none waiting here
  if (id === 'coach.pending') return { ok: true, output: [], changeSet: null, notices: [] };
  fake.calls.push([id, input]);
  if (fake.fail) return { ok: false, error: { code: 'internal', message: 'disk full' } };
  fake.settings = { ...fake.settings, ...(input.webmcp !== undefined ? { webmcp: input.webmcp } : {}), clients: { ...fake.settings.clients, ...input.clients } };
  return { ok: true, output: fake.settings, changeSet: null, notices: [] };
});
vi.mock('@/commands', async (importOriginal) => ({ ...(await importOriginal<object>()), dispatch: fakeDispatch }));
// the Stop key sends through sendCommand (src/features/lib/sendCommand.ts), which uses the bus directly
vi.mock('@/commands/bus', async (importOriginal) => ({ ...(await importOriginal<object>()), dispatch: fakeDispatch }));

function setModelContext(value: unknown) {
  Object.defineProperty(document, 'modelContext', { value, configurable: true, writable: true });
}

beforeEach(() => {
  fake.calls = [];
  fake.settings = { clients: {} };
  fake.fail = false;
  localStorage.clear();
  resetAgentActivityForTests();
  setModelContext(undefined);
  setServerClientForTests(fakeClient().client);
});

afterEach(() => {
  setServerClientForTests(null);
  setPlatformForTests(undefined);
});

describe('AgentsSection', () => {
  it('says app, not browser or tab, inside the installed apps', async () => {
    for (const platform of ['electron', 'android'] as const) {
      setPlatformForTests(platform);
      setServerClientForTests(fakeClient({ paired: true }).client);
      act(() => recordAgentActivity({ surface: 'webmcp', actor: 'webmcp', tool: 'today_get', status: 'applied' }));
      const { container, unmount } = render(<AgentsSection />, { wrapper: MemoryRouter });
      expect((await screen.findAllByRole('switch', { name: /agents in this app/i })).length).toBeGreaterThan(0);
      await screen.findByText(/even when no Vitals window is open/i);
      expect(container.textContent).not.toMatch(/browser|\btab\b/i);
      unmount();
      resetAgentActivityForTests();
    }
  });

  it('WebMCP toggle is off by default and disabled when unsupported', async () => {
    render(<AgentsSection />, { wrapper: MemoryRouter });
    const toggle = screen.getByRole('switch', { name: /agents in this browser/i });
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/can't share tools with agents yet/i)).toBeInTheDocument();
  });

  it('WebMCP toggle turns on when supported', async () => {
    setModelContext({ registerTool: () => undefined });
    render(<AgentsSection />, { wrapper: MemoryRouter });
    const toggle = screen.getByRole('switch', { name: /agents in this browser/i });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(isWebMcpEnabled()).toBe(true);
    expect(fake.calls).toEqual([['agents.configure', { webmcp: true }]]);
  });

  it('keeps the WebMCP switch off and says so when the command fails', async () => {
    setModelContext({ registerTool: () => undefined });
    fake.fail = true;
    render(<AgentsSection />, { wrapper: MemoryRouter });
    const toggle = screen.getByRole('switch', { name: /agents in this browser/i });
    await userEvent.click(toggle);
    expect(await screen.findByText('disk full')).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
    expect(isWebMcpEnabled()).toBe(false);
  });

  it('lets the person allow an agent seen this session to apply plan changes directly', async () => {
    act(() => recordAgentActivity({ surface: 'mcp', actor: 'claude-code', tool: 'plan_shift', status: 'pending_user' }));
    render(<AgentsSection />, { wrapper: MemoryRouter });
    const toggle = screen.getByRole('switch', { name: 'claude-code' });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(fake.calls).toEqual([['agents.configure', { clients: { 'claude-code': { directApply: true } } }]]);
  });

  it('without a server: the card asks to pair first', () => {
    render(<AgentsSection />, { wrapper: MemoryRouter });
    expect(screen.getByText(/Pair this device with your server first/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pair a server' })).toHaveAttribute('href', '/settings/server');
    expect(screen.queryByText(/Companion/)).not.toBeInTheDocument();
  });

  it('paired: hands out the address and an agent key shown once, with recipes; keys list and Revoke', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient({ paired: true });
    setServerClientForTests(client);
    render(<AgentsSection />, { wrapper: MemoryRouter });
    expect(await screen.findByText(`${BASE}/mcp`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Make an agent key' }));
    expect(screen.getByRole('combobox', { name: 'agent' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Make an agent key' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Make an agent key' }));
    await user.type(screen.getByLabelText('name'), 'Codex on laptop');
    await user.click(screen.getByRole('radio', { name: /^read/ }));
    await user.click(screen.getByRole('button', { name: 'Make key' }));
    expect(await screen.findByText('agent-secret-xyz')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your agent key · Codex on laptop' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Copy key' })).toBeInTheDocument();
    expect(server.state.calls.find((c) => c.method === 'POST' && c.path === '/v1/agents/tokens')?.body).toEqual({ client: 'codex', scope: 'read', label: 'Codex on laptop' });
    expect(screen.getByText(/bearer_token_env_var = "VITALS_TOKEN"/)).toBeInTheDocument();
    expect(screen.getByText(/claude mcp add --transport http -s user vitals/)).toBeInTheDocument();
    // recipes show a placeholder, never the key
    for (const pre of document.querySelectorAll('pre')) expect(pre.textContent).not.toContain('agent-secret-xyz');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('agent-secret-xyz')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make an agent key' })).toHaveFocus();
    await user.click(await screen.findByRole('button', { name: 'Revoke Codex on laptop' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(server.state.tokens).toHaveLength(0));
  });
});

describe('AgentsSection: secrets', () => {
  it('the agent key is in the page only while shown; the device token never is (attributes included)', async () => {
    const user = userEvent.setup();
    const { client } = fakeClient({ paired: true });
    setServerClientForTests(client);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    const view = render(<AgentsSection />, { wrapper: MemoryRouter });
    await user.click(await screen.findByRole('button', { name: 'Make an agent key' }));
    await user.click(screen.getByRole('button', { name: 'Make key' }));
    expect(await screen.findByText('agent-secret-xyz')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('button', { name: /^Revoke / });
    expect(document.body.innerHTML).not.toContain('agent-secret-xyz');
    expect(document.body.innerHTML).not.toContain(TOKEN);
    // navigating away and back, or a reload, does not bring it back
    view.unmount();
    render(<AgentsSection />, { wrapper: MemoryRouter });
    await screen.findByRole('button', { name: 'Make an agent key' });
    expect(document.body.innerHTML).not.toContain('agent-secret-xyz');
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i)!)).not.toContain('agent-secret-xyz');
    expect(JSON.stringify(logs.mock.calls)).not.toContain('agent-secret-xyz');
    logs.mockRestore();
  });
});

describe('AgentActivityIndicator', () => {
  it('shows while an agent call is recent and Stop turns agents off', async () => {
    localStorage.setItem('vitals-agents.webmcp', 'true');
    const { container } = render(<AgentActivityIndicator />);
    expect(container).toBeEmptyDOMElement();
    act(() => recordAgentActivity({ surface: 'webmcp', actor: 'webmcp', tool: 'today_get', status: 'applied' }));
    expect(screen.getByText('An agent is using Vitals')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /stop agents/i }));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(isWebMcpEnabled()).toBe(false);
    expect(fake.calls).toEqual([['agents.configure', { webmcp: false }]]);
  });
});
