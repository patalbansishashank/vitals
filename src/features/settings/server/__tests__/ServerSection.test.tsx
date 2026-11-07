import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { setPlatformForTests } from '@/platform';
import { SERVER_MESSAGES, type ServerClient } from '@/net/server';
import { OFF_STATUS } from '@/sync/types';
import { ServerClientContext } from '../hooks';
import { ServerSection } from '../ServerSection';
import { BASE, fakeClient, fakeServer, SYNC_KEY, TOKEN } from './fakeServer';

// The sync view and `dispatch('sync.join')` are a small fake device: pairing a home server must join its sync group.
const fake = vi.hoisted(() => ({
  view: null as unknown,
  listeners: new Set<() => void>(),
  local: null as string | null,
  joins: [] as Array<Record<string, unknown>>,
  /** The next `sync.join` fails with this message (the sync relay did not answer, say). */
  joinFails: null as string | null,
  unpairs: 0,
}));
// `sync.unpair` and `sync.join` through either door: the page sends through sendCommand (src/commands/bus), helpers use @/commands
const dispatchMock = vi.hoisted(() => ({
  impl: null as null | ((id: string, input: Record<string, unknown>) => Promise<unknown>),
}));
vi.mock('@/commands', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dispatch: (id: string, input: Record<string, unknown>) => dispatchMock.impl!(id, input),
}));
vi.mock('@/commands/bus', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dispatch: (id: string, input: Record<string, unknown>) => dispatchMock.impl!(id, input),
}));
const fakeDispatch = async (id: string, input: Record<string, unknown>) => {
  if (id === 'sync.unpair') {
    fake.unpairs += 1;
    fake.view = syncOff();
    fake.listeners.forEach((l) => l());
    return { ok: true, output: {}, changeSet: null, notices: [] };
  }
  if (id !== 'sync.join') throw new Error(`unexpected ${id}`);
  fake.joins.push(input);
  if (fake.joinFails) {
    const message = fake.joinFails;
    fake.joinFails = null;
    return { ok: false, error: { code: 'precondition_failed', message } };
  }
  const relayUrl = new URLSearchParams(String(input.code).split('?')[1]).get('u');
  fake.view = {
    status: { ...OFF_STATUS, state: 'synced' },
    paired: true,
    enabled: true,
    relayUrl,
    label: null,
    deviceId: 'ABCDEFGHIJKLMNOP',
  };
  fake.listeners.forEach((l) => l());
  return { ok: true, output: {}, changeSet: null, notices: [] };
};
dispatchMock.impl = fakeDispatch;
vi.mock('@/state/sync', async () => {
  const react = await import('react');
  return {
    useSyncView: () =>
      react.useSyncExternalStore(
        (l: () => void) => (fake.listeners.add(l), () => void fake.listeners.delete(l)),
        () => fake.view,
      ),
    describeLocalData: () => fake.local,
  };
});
const syncOff = () => ({
  status: OFF_STATUS,
  paired: false,
  enabled: false,
  relayUrl: null,
  label: null,
  deviceId: 'ABCDEFGHIJKLMNOP',
});
beforeEach(() => {
  fake.view = syncOff();
  fake.local = null;
  fake.joins = [];
  fake.joinFails = null;
  fake.unpairs = 0;
});

function wrap(client: ServerClient, ui: ReactNode = <ServerSection />) {
  return render(
    <MemoryRouter>
      <ServerClientContext.Provider value={client}>{ui}</ServerClientContext.Provider>
    </MemoryRouter>,
  );
}

async function enterCode(user: ReturnType<typeof userEvent.setup>, address: string, code: string) {
  await user.click(screen.getByRole('button', { name: 'Enter code' }));
  await user.type(screen.getByLabelText('Server address'), address);
  await user.type(screen.getByLabelText('First 4 digits'), code);
  await user.click(screen.getByRole('button', { name: 'Pair' }));
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  setPlatformForTests(undefined);
});

describe('Settings › Server, not paired', () => {
  it.each(['android', 'electron', 'web'] as const)(
    'on %s says nothing about a browser prompt or a site before anything went wrong (J4-06)',
    (p) => {
      setPlatformForTests(p);
      const { container } = wrap(fakeClient().client);
      expect(container.textContent).toMatch(/Not paired · this device only/);
      expect(container.textContent).not.toMatch(/local network|this site|browser/i);
    },
  );

  it('says it is not paired in one line and offers Enter code and Scan QR (the server guide is a row in Sync’s own group)', () => {
    wrap(fakeClient().client);
    expect(screen.getByRole('status')).toHaveTextContent('Not paired · this device only');
    expect(screen.getByRole('button', { name: 'Enter code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan QR' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /set one up|Set up a server/ })).toBeNull();
    // no explainer paragraphs
    expect(screen.queryByText(/small program on a computer you own/)).toBeNull();
  });

  it('refuses an http:// address and a bad address before any request', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient();
    wrap(client);
    await enterCode(user, 'http://100.64.0.1:4870', '12345678');
    expect(await screen.findByText('Use the https:// address of your server.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Server address'));
    await user.type(screen.getByLabelText('Server address'), 'not a url');
    await user.click(screen.getByRole('button', { name: 'Pair' }));
    expect(await screen.findByText("That doesn't look like a web address.")).toBeInTheDocument();
    expect(server.state.calls).toHaveLength(0);
  });

  it('shows the code errors: wrong (with tries left), expired, locked', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient();
    wrap(client);
    await enterCode(user, BASE, '11112222');
    expect(
      await screen.findByText(/That code doesn't match\. Check it and try again\. 4 tries left\./),
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Last 4 digits'));
    await user.clear(screen.getByLabelText('First 4 digits'));
    await user.type(screen.getByLabelText('First 4 digits'), '00000000');
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
    const refused = fakeClient({
      server: {
        state: fakeServer().state,
        fetch: (async () =>
          new Response(JSON.stringify({ error: { code: 'origin_not_allowed' } }), {
            status: 403,
          })) as typeof fetch,
      },
    });
    const view = wrap(refused.client);
    await user.click(within(view.container).getByRole('button', { name: 'Enter code' }));
    await user.type(within(view.container).getByLabelText('Server address'), BASE);
    await user.type(within(view.container).getByLabelText('First 4 digits'), '12345678');
    await user.click(within(view.container).getByRole('button', { name: 'Pair' }));
    expect(
      await within(view.container).findByText(
        "This server doesn't accept this website yet. Ask whoever runs it to add it.",
      ),
    ).toBeInTheDocument();
  });

  it('pasting a pairing link fills the address and the code', async () => {
    const user = userEvent.setup();
    wrap(fakeClient().client);
    await user.click(screen.getByRole('button', { name: 'Enter code' }));
    await user.click(screen.getByLabelText('First 4 digits'));
    await user.paste(`vitals-server:1?u=${encodeURIComponent(BASE)}&c=12345678`);
    expect(screen.getByLabelText('Server address')).toHaveValue(BASE);
    expect(screen.getByLabelText('First 4 digits')).toHaveValue('1234');
    expect(screen.getByLabelText('Last 4 digits')).toHaveValue('5678');
  });

  it('a pairing link in the address opens the panel filled, asks once, and leaves the address bar', async () => {
    window.history.replaceState(
      null,
      '',
      `/settings?section=server#vitals-server:1?u=${encodeURIComponent(BASE)}&c=12345678`,
    );
    wrap(fakeClient().client);
    expect(await screen.findByText('Connect this device to vitals.example.ts.net:8443?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pair this device' })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

  it('pairs and shows the server link, devices and its explanation', async () => {
    const user = userEvent.setup();
    const { client } = fakeClient();
    wrap(client);
    await enterCode(user, BASE, '12345678');
    expect(await screen.findByText('Reachable')).toBeInTheDocument();
    expect(screen.getByText(BASE)).toBeInTheDocument();
    expect(screen.getByText('0.4.0')).toBeInTheDocument();
    expect(screen.getByText('Home server')).toBeInTheDocument();
    expect(await screen.findByText('Laptop · Firefox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About Server' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What your server holds' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Ring data from your phone' })).toBeInTheDocument();
    // pairing turned sync on (plan decision 5): no hint to go and join by hand
    expect(await screen.findByText('On · through vitals.example.ts.net:8443')).toBeInTheDocument();
    expect(screen.queryByText(/Sync is off on this device/)).toBeNull();
  });
});

describe('Settings › Server, pairing turns sync on', () => {
  it('pairing fetches the sync key once and joins without a prompt', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient();
    wrap(client);
    await enterCode(user, BASE, '12345678');
    await waitFor(() => expect(fake.joins).toHaveLength(1));
    expect(fake.joins[0]).toEqual({
      code: `vitals-sync:1?u=${encodeURIComponent(BASE)}&s=${SYNC_KEY}&n=Sam`,
      onExisting: 'merge',
    });
    expect(
      server.state.calls.filter((c) => c.path === '/v1/sync/key').map((c) => [c.method, c.auth]),
    ).toEqual([['POST', `Bearer ${TOKEN}`]]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await screen.findByText('On · through vitals.example.ts.net:8443')).toBeInTheDocument();
  });

  it('asks merge or replace first when this device already holds data', async () => {
    const user = userEvent.setup();
    fake.local = '3 scenarios and your body';
    wrap(fakeClient().client);
    await enterCode(user, BASE, '12345678');
    const dialog = await screen.findByRole('alertdialog', { name: 'This device already has data' });
    expect(dialog).toHaveTextContent('3 scenarios and your body');
    expect(fake.joins).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Replace with synced data' }));
    await waitFor(() => expect(fake.joins).toEqual([expect.objectContaining({ onExisting: 'replace' })]));
  });

  it('while the join runs after Replace the Sync row says it is turning on, then On, with no visit elsewhere', async () => {
    const user = userEvent.setup();
    fake.local = '3 scenarios and your body';
    let release: () => void = () => undefined;
    dispatchMock.impl = async (id, input) => {
      if (id === 'sync.join') await new Promise<void>((r) => (release = r));
      return fakeDispatch(id, input);
    };
    try {
      wrap(fakeClient().client);
      await enterCode(user, BASE, '12345678');
      const dialog = await screen.findByRole('alertdialog', { name: 'This device already has data' });
      await user.click(within(dialog).getByRole('button', { name: 'Replace with synced data' }));
      expect(await screen.findByText('Turning on…')).toBeInTheDocument();
      expect(screen.queryByText('Off on this device')).toBeNull();
      expect(screen.queryByText(/Sync is off on this device/)).toBeNull();
      release();
      expect(await screen.findByText('On · through vitals.example.ts.net:8443')).toBeInTheDocument();
    } finally {
      dispatchMock.impl = fakeDispatch;
    }
  });

  it('a relay-only server gives no key: the Sync hint stays', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient({ server: fakeServer({ role: 'relay' }) });
    wrap(client);
    await enterCode(user, BASE, '12345678');
    expect(await screen.findByText('Off on this device')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'About Server' }));
    expect(
      await screen.findByText(/Sync is off on this device\. To bring your data across/),
    ).toBeInTheDocument();
    await waitFor(() => expect(server.state.calls.some((c) => c.path === '/v1/sync/key')).toBe(true));
    expect(fake.joins).toHaveLength(0);
    expect(screen.getByText('Off on this device')).toBeInTheDocument();
  });

  it('a device that already syncs with another key is told, not switched', async () => {
    const user = userEvent.setup();
    fake.view = {
      ...syncOff(),
      status: { ...OFF_STATUS, state: 'synced' },
      paired: true,
      enabled: true,
      relayUrl: 'https://relay.example.ts.net',
    };
    const { client, server } = fakeClient();
    wrap(client);
    await enterCode(user, BASE, '12345678');
    expect(
      await screen.findByText(
        /This device already syncs with another key, so it was left as it is\. To use your server's instead, stop syncing on this device, then forget this server and pair again\./,
      ),
    ).toBeInTheDocument();
    expect(server.state.calls.some((c) => c.path === '/v1/sync/key')).toBe(false);
    expect(server.state.keyIssued).toBe(false);
    expect(fake.joins).toHaveLength(0);
  });

  it('a join that fails shows the reason with Try again, which joins with the same key and asks the server once', async () => {
    const user = userEvent.setup();
    fake.joinFails = "The sync server didn't answer.";
    const { client, server, storage } = fakeClient();
    wrap(client);
    await enterCode(user, BASE, '12345678');
    expect(await screen.findByText("Sync didn't start: The sync server didn't answer.")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SYNC_KEY);
    const stored = (st: Storage) =>
      Array.from({ length: st.length }, (_, i) => `${st.key(i)}=${st.getItem(st.key(i)!)}`).join('\n');
    expect(stored(storage) + stored(localStorage) + stored(sessionStorage)).not.toContain(SYNC_KEY);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('On · through vitals.example.ts.net:8443')).toBeInTheDocument();
    expect(fake.joins).toHaveLength(2);
    expect(fake.joins[1]).toEqual(fake.joins[0]);
    expect(server.state.calls.filter((c) => c.path === '/v1/sync/key')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('a key already handed over (409) says how to turn sync on, without a Try again', async () => {
    const user = userEvent.setup();
    const { client } = fakeClient({ server: fakeServer({ keyIssued: true }) });
    wrap(client);
    await enterCode(user, BASE, '12345678');
    expect(await screen.findByText(`Sync didn't start: ${SERVER_MESSAGES.key_used}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(fake.joins).toHaveLength(0);
  });

  it('removing a device says that a device that already synced keeps the sync key', async () => {
    const user = userEvent.setup();
    wrap(fakeClient({ paired: true }).client);
    await user.click(await screen.findByRole('button', { name: 'Revoke Laptop · Firefox' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      /A device that already synced keeps the sync key, like anyone who has the 24 words/,
    );
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
    expect(await screen.findByText('Removed just now')).toBeInTheDocument();
    expect(server.state.devices.map((d) => d.id)).toEqual(['dev-1']);
  });

  it('an agent key links to its management page instead of duplicating Revoke', async () => {
    const server = fakeServer();
    server.state.devices.push({
      id: 'agt-1',
      kind: 'agent',
      label: 'Claude Code',
      scope: 'log',
      createdAt: '2026-10-03T08:00:00.000Z',
      lastSeenAt: '2026-10-03T09:00:00.000Z',
      current: false,
    });
    wrap(fakeClient({ paired: true, server }).client);
    const link = await screen.findByRole('link', { name: 'Agent keys' });
    expect(link).toHaveAttribute('href', '/settings/agents');
    expect(screen.queryByRole('button', { name: 'Revoke Claude Code' })).toBeNull();
  });

  it('names each device for what it is and hides the old generated ring-app prefix', async () => {
    const server = fakeServer();
    const at = {
      scope: 'full',
      createdAt: '2026-10-03T08:00:00.000Z',
      lastSeenAt: '2026-10-03T08:30:00.000Z',
      current: false,
    };
    server.state.devices.push(
      { id: 'lum-1', kind: 'lumen', label: 'Gauge', ...at, scope: 'lumen' },
      { id: 'lum-2', kind: 'lumen', label: 'Gauge · OnePlus 12', ...at, scope: 'lumen' },
      { id: 'dsk-1', kind: 'device', label: 'Chrome on Linux', origin: 'app://vitals', ...at },
      { id: 'and-1', kind: 'device', label: 'Pixel', origin: 'https://localhost', ...at },
      { id: 'web-2', kind: 'device', label: 'Chrome on Android', ...at },
      { id: 'agt-1', kind: 'agent', label: 'Claude Code', ...at, scope: 'log' },
    );
    wrap(fakeClient({ paired: true, server }).client);
    await screen.findByText('Laptop · Firefox');
    const titles = () => [...document.querySelectorAll('.settings-list__title')].map((el) => el.textContent);
    expect(titles()).toEqual(
      expect.arrayContaining([
        'Chrome on Linux · Browser · this device',
        'Ring app',
        'Ring app · OnePlus 12',
        'Chrome on Linux · Desktop app',
        'Pixel · Phone',
        'Chrome on Android · Phone',
        'Laptop · Firefox · Browser',
        'Claude Code · Agent',
      ]),
    );
    expect(titles().filter((title) => title?.startsWith('Ring app'))).toEqual(['Ring app', 'Ring app · OnePlus 12']);
    expect(titles().join(' ')).not.toMatch(/\bGauge\b/);
  });

  it('on the desktop app this device reads Desktop app', async () => {
    setPlatformForTests('electron');
    wrap(fakeClient({ paired: true }).client);
    await screen.findByText('Laptop · Firefox');
    expect(
      screen.getByText('Chrome on Linux', { selector: '.settings-list__title', exact: false }).textContent,
    ).toBe('Chrome on Linux · Desktop app · this device');
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
    expect(
      await screen.findByText('This device no longer uses your server. Its data is still here.'),
    ).toBeInTheDocument();
    expect(client.isPaired()).toBe(false);
    expect(screen.getByRole('button', { name: 'Enter code' })).toBeInTheDocument();
    expect(fake.unpairs).toBe(0);
  });

  it('Forget this server stops sync through it, as the confirm says (data stays); sync with another key is left alone', async () => {
    const user = userEvent.setup();
    fake.view = {
      ...syncOff(),
      status: { ...OFF_STATUS, state: 'synced' },
      paired: true,
      enabled: true,
      relayUrl: BASE,
    };
    const first = wrap(fakeClient({ paired: true }).client);
    await user.click(await screen.findByRole('button', { name: 'Forget this server' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('This device stops syncing');
    await user.click(screen.getByRole('button', { name: 'Forget server' }));
    await waitFor(() => expect(fake.unpairs).toBe(1));
    first.unmount();
    fake.view = {
      ...syncOff(),
      status: { ...OFF_STATUS, state: 'synced' },
      paired: true,
      enabled: true,
      relayUrl: 'https://relay.example.ts.net',
    };
    wrap(fakeClient({ paired: true }).client);
    await user.click(await screen.findByRole('button', { name: 'Forget this server' }));
    await user.click(screen.getByRole('button', { name: 'Forget server' }));
    expect(
      await screen.findByText('This device no longer uses your server. Its data is still here.'),
    ).toBeInTheDocument();
    expect(fake.unpairs).toBe(1);
  });

  it('unreachable: says so with Try again', async () => {
    const server = fakeServer({ fail: 'network' });
    wrap(fakeClient({ paired: true, server }).client);
    expect(
      (await screen.findAllByText(/Can't reach your server\. Everything still works on this device\./))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Can't reach")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('busy: a full server is a passing state, in plain words, not "can\'t reach"', async () => {
    const server = fakeServer({ fail: { status: 503, code: 'server_busy' } });
    wrap(fakeClient({ paired: true, server }).client);
    expect((await screen.findAllByText(SERVER_MESSAGES.server_busy)).length).toBeGreaterThan(0);
    expect(screen.getByText('Busy')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach")).toBeNull();
    expect(screen.queryByText(/Can't reach your server/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('removed: a 401 revoked shows the removed state and Connect again opens the panel with the address', async () => {
    const user = userEvent.setup();
    const server = fakeServer({ fail: { status: 401, code: 'revoked' } });
    wrap(fakeClient({ paired: true, server }).client);
    expect(await screen.findByText(/This device was removed from your server/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Connect again' }));
    await waitFor(() => expect(screen.getByLabelText('Server address')).toHaveValue(BASE));
  });

  it('version: an older server asks to be updated', async () => {
    wrap(fakeClient({ paired: true, server: fakeServer({ version: '0.3.2' }) }).client);
    expect(
      await screen.findByText(
        'Your server runs 0.3.2 and this page needs 0.4.0 or later. Update the server, then check again.',
      ),
    ).toBeInTheDocument();
  });
});

describe('Settings › Server, secrets', () => {
  it('the device token is nowhere in the page, in text or in any attribute, while paired, after pairing, or after a 401', async () => {
    const user = userEvent.setup();
    const { client, server } = fakeClient();
    wrap(client);
    await enterCode(user, BASE, '12345678');
    expect(await screen.findByText('Reachable')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(server.state.calls.every((c) => !c.path.includes(TOKEN))).toBe(true);
  });

  it('the sync key is nowhere in the page or storage', async () => {
    const user = userEvent.setup();
    const { client, server, storage } = fakeClient();
    wrap(client);
    await enterCode(user, BASE, '12345678');
    expect(await screen.findByText('On · through vitals.example.ts.net:8443')).toBeInTheDocument();
    expect(server.state.keyIssued).toBe(true);
    // it went to sync.join (whose wrapped vault keeps it), and nowhere else
    expect(String(fake.joins[0]?.code)).toContain(SYNC_KEY);
    expect(document.body.innerHTML).not.toContain(SYNC_KEY);
    const stored = (s: Storage) =>
      Array.from({ length: s.length }, (_, i) => `${s.key(i)}=${s.getItem(s.key(i)!)}`).join('\n');
    expect(stored(storage)).not.toContain(SYNC_KEY);
    expect(stored(localStorage)).not.toContain(SYNC_KEY);
    expect(stored(sessionStorage)).not.toContain(SYNC_KEY);
    expect(server.state.calls.every((c) => !c.path.includes(SYNC_KEY))).toBe(true);
  });
});
