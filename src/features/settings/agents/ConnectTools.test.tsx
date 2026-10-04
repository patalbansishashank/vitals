import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setServerClientForTests } from '@/net/server';
import { fakeClient, TOKEN } from '../server/__tests__/fakeServer';
import { ConnectTools } from './ConnectTools';
import type { AiToolId, AiToolRow, DesktopMcpBridge, SecretKey } from './desktop';

const CODEX_PREVIEW = '[mcp_servers.vitals]\ncommand = "/opt/Vitals/vitals"\nargs = ["--mcp", "--client", "codex"]';

function fakeBridge(initial?: AiToolRow[]) {
  const rows: AiToolRow[] = initial ?? [
    { id: 'claude-code', label: 'Claude Code', found: true, added: false, file: '~/.claude.json', preview: 'claude mcp add -s user vitals -- /opt/Vitals/vitals --mcp', canAdd: true },
    { id: 'codex', label: 'Codex', found: true, added: false, file: '~/.codex/config.toml', preview: CODEX_PREVIEW, canAdd: true },
    { id: 'opencode', label: 'OpenCode', found: false, added: false, canAdd: false },
    { id: 'chatgpt-desktop', label: 'ChatGPT desktop', found: true, added: false, canAdd: false, note: 'Needs your Vitals server' },
  ];
  const log: string[] = [];
  const secrets = new Map<SecretKey, string>();
  const set = (id: AiToolId, added: boolean) => {
    const row = rows.find((r) => r.id === id)!;
    row.added = added;
    return { ...row };
  };
  const bridge = {
    log,
    secrets: {
      get: vi.fn(async (k: SecretKey) => secrets.get(k) ?? null),
      set: vi.fn(async (k: SecretKey, v: string | null) => {
        log.push(`secrets.set ${k} ${v === null ? 'null' : 'value'}`);
        if (v === null) secrets.delete(k);
        else secrets.set(k, v);
      }),
    },
    stored: secrets,
    mcp: {
      tools: vi.fn(async () => rows.map((r) => ({ ...r }))),
      add: vi.fn(async (id: AiToolId) => (log.push(`add ${id}`), set(id, true))),
      remove: vi.fn(async (id: AiToolId) => (log.push(`remove ${id}`), set(id, false))),
      onCall: vi.fn(() => () => undefined),
      setManifest: vi.fn(),
      setServer: vi.fn(),
    },
  } satisfies DesktopMcpBridge & Record<string, unknown>;
  (window as unknown as { vitalsDesktop?: unknown }).vitalsDesktop = bridge;
  return bridge;
}

beforeEach(() => setServerClientForTests(fakeClient().client));
afterEach(() => {
  delete (window as unknown as { vitalsDesktop?: unknown }).vitalsDesktop;
  setServerClientForTests(null);
});

describe('ConnectTools', () => {
  it('renders nothing outside the desktop app', () => {
    const { container } = render(<ConnectTools />);
    expect(container).toBeEmptyDOMElement();
  });

  it('one row per tool: found, not found, and the note where Add cannot be offered', async () => {
    fakeBridge();
    render(<ConnectTools />);
    expect(screen.getByRole('heading', { name: 'Connect your AI tools' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Add Vitals to Claude Code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Vitals to Codex' })).toBeInTheDocument();
    expect(screen.getByText('OpenCode')).toBeInTheDocument();
    expect(screen.getByText(/not found on this computer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Vitals to OpenCode' })).not.toBeInTheDocument();
    expect(screen.getByText('Needs your Vitals server')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Vitals to ChatGPT desktop' })).not.toBeInTheDocument();
  });

  it('nothing is written before consent; the dialog shows the file and the exact lines; Add writes once', async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge();
    render(<ConnectTools />);
    await user.click(await screen.findByRole('button', { name: 'Add Vitals to Codex' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Vitals to Codex?' });
    expect(bridge.mcp.add).not.toHaveBeenCalled();
    expect(within(dialog).getByText('~/.codex/config.toml')).toBeInTheDocument();
    expect(dialog.querySelector('pre')?.textContent).toBe(CODEX_PREVIEW);
    expect(within(dialog).getByText(/Read your data, log food and activity, and propose changes you approve\. It cannot delete anything\./)).toBeInTheDocument();
    // cancel writes nothing
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(bridge.mcp.add).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Add Vitals to Codex' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Vitals' }));
    await waitFor(() => expect(bridge.mcp.add).toHaveBeenCalledTimes(1));
    expect(bridge.mcp.add).toHaveBeenCalledWith('codex');
    expect(await screen.findByRole('button', { name: 'Remove Vitals from Codex' })).toBeInTheDocument();
    // no server paired: no key minted or stored
    expect(bridge.secrets.set).not.toHaveBeenCalled();
  });

  it('Remove asks first, then removes the entry and clears the stored key', async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge([{ id: 'codex', label: 'Codex', found: true, added: true, file: '~/.codex/config.toml', preview: CODEX_PREVIEW, canAdd: true }]);
    render(<ConnectTools />);
    await user.click(await screen.findByRole('button', { name: 'Remove Vitals from Codex' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove Vitals from Codex?' });
    expect(bridge.mcp.remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(bridge.mcp.remove).toHaveBeenCalledWith('codex'));
    await waitFor(() => expect(bridge.secrets.set).toHaveBeenCalledWith('agentToken:codex', null));
    expect(await screen.findByRole('button', { name: 'Add Vitals to Codex' })).toBeInTheDocument();
  });

  it('shows a failed add as a plain inline message', async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge();
    bridge.mcp.add.mockRejectedValueOnce(new Error("Couldn't write ~/.codex/config.toml."));
    render(<ConnectTools />);
    await user.click(await screen.findByRole('button', { name: 'Add Vitals to Codex' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Vitals' }));
    expect(await screen.findByText("Couldn't write ~/.codex/config.toml.")).toBeInTheDocument();
  });

  it('refreshes the rows when the window gets focus', async () => {
    const bridge = fakeBridge();
    render(<ConnectTools />);
    await screen.findByRole('button', { name: 'Add Vitals to Codex' });
    const before = bridge.mcp.tools.mock.calls.length;
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(bridge.mcp.tools.mock.calls.length).toBe(before + 1));
  });

  it('paired: mints an edit key for the tool and stores it in the app, never on the page', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient({ paired: true });
    setServerClientForTests(client);
    const bridge = fakeBridge();
    render(<ConnectTools />);
    await user.click(await screen.findByRole('button', { name: 'Add Vitals to Claude Code' }));
    expect(screen.getByText(/through your server/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Vitals' }));
    await waitFor(() => expect(bridge.secrets.set).toHaveBeenCalledWith('agentToken:claude-code', 'agent-secret-xyz'));
    // add ran first, inside the click (user activation)
    expect(bridge.log).toEqual(['add claude-code', 'secrets.set agentToken:claude-code value']);
    expect(server.state.calls.find((c) => c.method === 'POST' && c.path === '/v1/agents/tokens')?.body).toEqual({
      client: 'claude',
      scope: 'edit',
      label: 'Vitals desktop app · Claude Code',
    });
    await screen.findByRole('button', { name: 'Remove Vitals from Claude Code' });
    expect(document.body.innerHTML).not.toContain('agent-secret-xyz');
    expect(document.body.innerHTML).not.toContain(TOKEN);

    // Remove clears the stored key and revokes it on the server
    await user.click(screen.getByRole('button', { name: 'Remove Vitals from Claude Code' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(bridge.stored.has('agentToken:claude-code')).toBe(false));
    await waitFor(() => expect(server.state.tokens).toHaveLength(0));
  });

  it('plain words only: nothing about rings, passwords or passcodes', async () => {
    const user = userEvent.setup();
    fakeBridge();
    render(<ConnectTools />);
    await user.click(await screen.findByRole('button', { name: 'Add Vitals to Codex' }));
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\bring\b/i);
    expect(text).not.toMatch(/password|passcode/i);
  });
});
