import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { SERVER_MESSAGES, type ServerClient } from '@/net/server';
import { ServerClientContext } from '../hooks';
import { ServerSection } from '../ServerSection';
import { BASE, fakeClient, fakeServer, TOKEN } from './fakeServer';

function wrap(client: ServerClient, ui: ReactNode = <ServerSection />) {
  return render(
    <MemoryRouter>
      <ServerClientContext.Provider value={client}>{ui}</ServerClientContext.Provider>
    </MemoryRouter>,
  );
}

async function enterCode(user: ReturnType<typeof userEvent.setup>, address: string, code: string) {
  await user.click(screen.getByRole('button', { name: 'Enter code' }));
  await user.type(screen.getByLabelText('server address'), address);
  await user.type(screen.getByLabelText('first 4 digits'), code);
  await user.click(screen.getByRole('button', { name: 'Pair' }));
}

afterEach(() => window.history.replaceState(null, '', '/'));

describe('Settings › Server, not paired', () => {
  it('explains the server, the local-network question, and offers Enter code and Scan QR', () => {
    wrap(fakeClient().client);
    expect(screen.getByText(/small program on a computer you own/)).toBeInTheDocument();
    expect(screen.getByText(/You pair each device with it once/)).toBeInTheDocument();
    expect(screen.getByText(/access devices on your local network/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enter code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan QR' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /How to set one up/ })).toBeInTheDocument();
    expect(screen.getByText('not paired')).toBeInTheDocument();
  });

  it('refuses an http:// address and a bad address before any request', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient();
    wrap(client);
    await enterCode(user, 'http://100.64.0.1:4870', '12345678');
    expect(await screen.findByText('Use the https:// address of your server.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('server address'));
    await user.type(screen.getByLabelText('server address'), 'not a url');
    await user.click(screen.getByRole('button', { name: 'Pair' }));
    expect(await screen.findByText("That doesn't look like a web address.")).toBeInTheDocument();
    expect(server.state.calls).toHaveLength(0);
  });

  it('shows the code errors: wrong (with tries left), expired, locked', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient();
    wrap(client);
    await enterCode(user, BASE, '11112222');
    expect(await screen.findByText(/That code doesn't match\. Check it and try again\. 4 tries left\./)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('last 4 digits'));
    await user.clear(screen.getByLabelText('first 4 digits'));
    await user.type(screen.getByLabelText('first 4 digits'), '00000000');
    await user.click(screen.getByRole('button', { name: 'Pair' }));
    expect(await screen.findByText(/That code has expired/)).toBeInTheDocument();
    server.state.attempts = 0;
    await user.click(screen.getByRole('button', { name: 'Pair' }));
    expect(await screen.findByText('Too many tries. Make a new code on your server.')).toBeInTheDocument();
  });

  it('says when the server cannot be reached or refuses this website', async () => {
    const user = userEvent.setup();
    const { client } = fakeClient();
    wrap(client);
    await enterCode(user, 'https://elsewhere.example', '12345678');
    expect(await screen.findByText(SERVER_MESSAGES.server_unreachable)).toBeInTheDocument();
    const refused = fakeClient({ server: { state: fakeServer().state, fetch: (async () => new Response(JSON.stringify({ error: { code: 'origin_not_allowed' } }), { status: 403 })) as typeof fetch } });
    const view = wrap(refused.client);
    await user.click(within(view.container).getByRole('button', { name: 'Enter code' }));
    await user.type(within(view.container).getByLabelText('server address'), BASE);
    await user.type(within(view.container).getByLabelText('first 4 digits'), '12345678');
    await user.click(within(view.container).getByRole('button', { name: 'Pair' }));
    expect(await within(view.container).findByText("This server doesn't accept this website yet. Ask whoever runs it to add it.")).toBeInTheDocument();
  });

  it('pasting a pairing link fills the address and the code', async () => {
    const user = userEvent.setup();
    wrap(fakeClient().client);
    await user.click(screen.getByRole('button', { name: 'Enter code' }));
    await user.click(screen.getByLabelText('first 4 digits'));
    await user.paste(`vitals-server:1?u=${encodeURIComponent(BASE)}&c=12345678`);
    expect(screen.getByLabelText('server address')).toHaveValue(BASE);
    expect(screen.getByLabelText('first 4 digits')).toHaveValue('1234');
    expect(screen.getByLabelText('last 4 digits')).toHaveValue('5678');
  });

  it('a pairing link in the address opens the panel filled, asks once, and leaves the address bar', async () => {
    window.history.replaceState(null, '', `/settings?section=server#vitals-server:1?u=${encodeURIComponent(BASE)}&c=12345678`);
    wrap(fakeClient().client);
    expect(await screen.findByText('Connect this device to vitals.example.ts.net:8443?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pair this device' })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

  it('pairs and switches to the connected view with devices and what the server holds', async () => {
    const user = userEvent.setup();
    const { client } = fakeClient();
    wrap(client);
    await enterCode(user, BASE, '12345678');
    expect(await screen.findByText('reachable')).toBeInTheDocument();
    expect(screen.getByText(BASE)).toBeInTheDocument();
    expect(screen.getByText('0.4.0')).toBeInTheDocument();
    expect(screen.getByText('home server')).toBeInTheDocument();
    expect(screen.getByText(/keeps a readable copy of your data/)).toBeInTheDocument();
    expect(await screen.findByText('Laptop · Firefox')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What your server holds' })).toBeInTheDocument();
    expect(screen.getByText(/Sync is off on this device/)).toBeInTheDocument();
  });
});

describe('Settings › Server, paired', () => {
  it('revokes another device after a confirm; this device has no Revoke', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient({ paired: true });
    wrap(client);
    await screen.findByText('Laptop · Firefox');
    expect(screen.getAllByRole('button', { name: /^Revoke / })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Revoke Laptop · Firefox' }));
    expect(screen.getByText('Remove Laptop · Firefox from your server?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove device' }));
    expect(await screen.findByText('removed just now')).toBeInTheDocument();
    expect(server.state.devices.map((d) => d.id)).toEqual(['dev-1']);
  });

  it('an agent key in the list: the confirm says it revokes the key, not that it removes a device', async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    server.state.devices.push({ id: 'agt-1', kind: 'agent', label: 'Claude Code', scope: 'log', createdAt: '2026-10-03T08:00:00.000Z', lastSeenAt: '2026-10-03T09:00:00.000Z', current: false });
    wrap(fakeClient({ paired: true, server }).client);
    await user.click(await screen.findByRole('button', { name: 'Revoke Claude Code' }));
    expect(screen.getByText('Revoke the agent key Claude Code?')).toBeInTheDocument();
    expect(screen.queryByText(/Remove Claude Code from your server/)).toBeNull();
    expect(screen.getByText(/That agent key stops working at once/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke key' }));
    expect(await screen.findByText('removed just now')).toBeInTheDocument();
    expect(server.state.devices.map((d) => d.id)).toEqual(['dev-1', 'dev-2']);
  });

  it('Add another device shows the code, the QR and the expiry', async () => {
    const user = userEvent.setup();
    wrap(fakeClient({ paired: true }).client);
    await user.click(await screen.findByRole('button', { name: 'Add another device' }));
    expect(await screen.findByText('8765–4321')).toBeInTheDocument();
    expect(screen.getByTestId('pairing-qr')).toBeInTheDocument();
    expect(screen.getByText(/Works once · expires in \d+:\d\d/)).toBeInTheDocument();
    expect(screen.getByText(/Anyone with this code in the next 10 minutes/)).toBeInTheDocument();
  });

  it('Forget this server: confirm, then not paired with a one-time notice', async () => {
    const user = userEvent.setup();
    const { client } = fakeClient({ paired: true });
    wrap(client);
    await user.click(await screen.findByRole('button', { name: 'Forget this server' }));
    await user.click(screen.getByRole('button', { name: 'Forget server' }));
    expect(await screen.findByText('This device no longer uses your server. Its data is still here.')).toBeInTheDocument();
    expect(client.isPaired()).toBe(false);
    expect(screen.getByRole('button', { name: 'Enter code' })).toBeInTheDocument();
  });

  it('unreachable: says so with Try again', async () => {
    const server = fakeServer({ fail: 'network' });
    wrap(fakeClient({ paired: true, server }).client);
    expect((await screen.findAllByText(/Can't reach your server\. Is the computer on/)).length).toBeGreaterThan(0);
    expect(screen.getByText("can't reach")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('busy: a full server is a passing state, in plain words, not "can\'t reach"', async () => {
    const server = fakeServer({ fail: { status: 503, code: 'server_busy' } });
    wrap(fakeClient({ paired: true, server }).client);
    expect((await screen.findAllByText(SERVER_MESSAGES.server_busy)).length).toBeGreaterThan(0);
    expect(screen.getByText('busy')).toBeInTheDocument();
    expect(screen.queryByText("can't reach")).toBeNull();
    expect(screen.queryByText(/Can't reach your server/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('removed: a 401 revoked shows the removed state and Connect again opens the panel with the address', async () => {
    const user = userEvent.setup();
    const server = fakeServer({ fail: { status: 401, code: 'revoked' } });
    wrap(fakeClient({ paired: true, server }).client);
    expect(await screen.findByText(/This device was removed from your server/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Connect again' }));
    await waitFor(() => expect(screen.getByLabelText('server address')).toHaveValue(BASE));
  });

  it('version: an older server asks to be updated', async () => {
    wrap(fakeClient({ paired: true, server: fakeServer({ version: '0.3.2' }) }).client);
    expect(await screen.findByText('Your server runs 0.3.2 and this page needs 0.4.0 or later. Update the server, then check again.')).toBeInTheDocument();
  });
});

describe('Settings › Server, secrets', () => {
  it('the device token is nowhere in the page, in text or in any attribute, while paired, after pairing, or after a 401', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient();
    wrap(client);
    await enterCode(user, BASE, '12345678');
    expect(await screen.findByText('reachable')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(server.state.calls.every((c) => !c.path.includes(TOKEN))).toBe(true);
  });
});
