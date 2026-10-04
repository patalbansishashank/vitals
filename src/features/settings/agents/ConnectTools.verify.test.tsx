import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setServerClientForTests } from '@/net/server';
import { fakeClient } from '../server/__tests__/fakeServer';
import { ConnectTools } from './ConnectTools';
import type { AiToolId, AiToolRow, DesktopMcpBridge, SecretKey } from './desktop';

const rows = (): AiToolRow[] => [
  { id: 'codex', label: 'Codex', found: true, added: false, file: '~/.codex/config.toml', preview: '[mcp_servers.vitals]', canAdd: true },
];

function bridgeWith(over: { add?: DesktopMcpBridge['mcp']['add']; setSecret?: (k: SecretKey, v: string | null) => Promise<void> } = {}) {
  const state = rows();
  const bridge = {
    mcp: {
      tools: vi.fn(async () => state.map((r) => ({ ...r }))),
      add: vi.fn(over.add ?? (async (id: AiToolId) => ({ ...state.find((r) => r.id === id)!, added: true }))),
      remove: vi.fn(),
      onCall: vi.fn(() => () => undefined),
      setManifest: vi.fn(),
      setServer: vi.fn(),
    },
    secrets: { get: vi.fn(async () => null), set: vi.fn(over.setSecret ?? (async () => undefined)) },
  } satisfies DesktopMcpBridge;
  (window as unknown as { vitalsDesktop?: unknown }).vitalsDesktop = bridge;
  return bridge;
}

afterEach(() => {
  delete (window as unknown as { vitalsDesktop?: unknown }).vitalsDesktop;
  setServerClientForTests(null);
});

describe('ConnectTools adversarial', () => {
  it('paired: add is called synchronously inside the confirm click, before the key round trip finishes', async () => {
    const user = userEvent.setup();
    setServerClientForTests(fakeClient({ paired: true }).client);
    const bridge = bridgeWith();
    render(<ConnectTools />);
    await user.click(await screen.findByRole('button', { name: 'Add Vitals to Codex' }));
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Vitals' });
    fireEvent.click(confirm); // one synchronous event, no awaiting
    expect(bridge.mcp.add).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(bridge.secrets.set).toHaveBeenCalled());
  });

  it('paired, add refused: the new key is revoked on the server and nothing is stored', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient({ paired: true });
    setServerClientForTests(client);
    const bridge = bridgeWith({ add: async () => Promise.reject(new Error('Needs a click first.')) });
    render(<ConnectTools />);
    await user.click(await screen.findByRole('button', { name: 'Add Vitals to Codex' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Vitals' }));
    expect(await screen.findByText('Needs a click first.')).toBeInTheDocument();
    await waitFor(() => expect(server.state.tokens).toHaveLength(0));
    expect(bridge.secrets.set).not.toHaveBeenCalled();
  });

  it('paired, storing the key fails: the key is revoked and the error does not contain the token', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient({ paired: true });
    setServerClientForTests(client);
    bridgeWith({ setSecret: async () => Promise.reject(new Error('Keychain is locked.')) });
    render(<ConnectTools />);
    await user.click(await screen.findByRole('button', { name: 'Add Vitals to Codex' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Vitals' }));
    expect(await screen.findByText(/Keychain is locked\./)).toBeInTheDocument();
    await waitFor(() => expect(server.state.tokens).toHaveLength(0));
    expect(document.body.innerHTML).not.toContain('agent-secret-xyz');
  });

  it('a second confirm click while busy does not add twice', async () => {
    const user = userEvent.setup();
    let release: (r: AiToolRow) => void = () => undefined;
    const bridge = bridgeWith({ add: () => new Promise<AiToolRow>((r) => (release = r)) });
    render(<ConnectTools />);
    await user.click(await screen.findByRole('button', { name: 'Add Vitals to Codex' }));
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Vitals' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(bridge.mcp.add).toHaveBeenCalledTimes(1);
    release({ ...rows()[0]!, added: true });
  });
});
