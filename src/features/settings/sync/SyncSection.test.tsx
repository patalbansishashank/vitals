import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { pairingCodeOf } from '@/sync/pairing';
import { OFF_STATUS, type SyncStatus } from '@/sync/types';
import { BASE, fakeClient } from '../server/__tests__/fakeServer';
import { ServerClientContext } from '../server/hooks';
import { AUTO_HIDE_MS } from './PairingCodePanel';
import { qrPath } from './QrCode';
import { describeStatus } from './status';
import { SyncSection } from './SyncSection';

// The screen reads the sync view and writes through `dispatch('sync.…')`; both are replaced by a small fake device.
const fake = vi.hoisted(() => ({ view: null as unknown, listeners: new Set<() => void>(), dispatch: null as unknown, describe: null as unknown, code: null as unknown }));
vi.mock('@/commands', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dispatch: (id: string, input: unknown, opts?: unknown) => (fake.dispatch as (...a: unknown[]) => unknown)(id, input, opts),
}));
vi.mock('@/state/sync', async () => {
  const react = await import('react');
  return {
    useSyncView: () => react.useSyncExternalStore((l: () => void) => (fake.listeners.add(l), () => void fake.listeners.delete(l)), () => fake.view),
    readPairingCode: async () => fake.code,
    describeLocalData: () => (fake.describe as () => string | null)(),
  };
});

// "Test before create": the relay check (GET /health) is faked; each test starts with a reachable relay.
const REACHED = { ok: true, message: 'Reached the server · version 0.1.0 · 3 ms' };
const relayCheck = vi.hoisted(() => ({ result: null as unknown, calls: [] as string[] }));
vi.mock('./relayTest', () => ({
  testRelay: async (url: string) => {
    relayCheck.calls.push(url);
    return relayCheck.result;
  },
}));
beforeEach(() => {
  relayCheck.result = REACHED;
  relayCheck.calls.length = 0;
});

const RELAY = 'https://relay.example.ts.net';
const CODE = pairingCodeOf(RELAY, new Uint8Array(32).fill(7));

function fakeController(init: { paired?: boolean; status?: Partial<SyncStatus>; local?: string | null } = {}) {
  const view = (paired: boolean, relayUrl: string | null, status: SyncStatus) => ({ status, paired, enabled: paired, relayUrl, label: null, deviceId: 'ABCDEFGHIJKLMNOP' });
  let status: SyncStatus = { ...OFF_STATUS, ...init.status };
  fake.view = view(Boolean(init.paired), init.paired ? RELAY : null, status);
  fake.code = CODE;
  fake.describe = () => init.local ?? null;
  const set = (paired: boolean, relayUrl: string | null) => {
    fake.view = view(paired, relayUrl, status);
    fake.listeners.forEach((l) => l());
  };
  const ok = (output: unknown) => ({ ok: true, output, changeSet: null, notices: [] });
  const calls = {
    pair: vi.fn(),
    join: vi.fn(),
    configure: vi.fn(),
    now: vi.fn(),
    unpair: vi.fn(),
  };
  fake.dispatch = async (id: string, input: Record<string, unknown>, opts?: { confirmation?: unknown }) => {
    switch (id) {
      case 'sync.pair':
        calls.pair(input);
        set(true, input.relayUrl as string);
        return ok({ uri: CODE.uri, words: CODE.words, relayUrl: input.relayUrl });
      case 'sync.join':
        calls.join(input);
        set(true, RELAY);
        return ok({});
      case 'sync.configure':
        calls.configure(input);
        set(true, input.relayUrl as string);
        return ok({});
      case 'sync.now':
        calls.now(input);
        return ok({});
      case 'sync.unpair':
        calls.unpair(input, opts);
        set(false, null);
        return ok({});
      default:
        throw new Error(`unexpected ${id}`);
    }
  };
  const emit = (next: Partial<SyncStatus>) =>
    act(() => {
      status = { ...status, ...next };
      set(Boolean((fake.view as { paired: boolean }).paired), (fake.view as { relayUrl: string | null }).relayUrl);
    });
  return { calls, emit };
}

const todayAt = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

afterEach(() => vi.useRealTimers());

describe('Settings › Sync, not paired', () => {
  it('rejects an invalid address inline and pairs with the normalised URL', async () => {
    const user = userEvent.setup();
    const { calls } = fakeController();
    render(<SyncSection />);
    expect(screen.getByText(/server may hold a readable copy/)).toBeInTheDocument();
    expect(screen.getByText(/connect to devices on your local network/)).toBeInTheDocument();

    const input = screen.getByLabelText('sync server address');
    await user.type(input, 'http://192.168.1.5:4000');
    await user.click(screen.getByRole('button', { name: 'Set up sync on this device' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/must use https:\/\//);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(calls.pair).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, 'Relay.Example.ts.net/');
    await user.click(screen.getByRole('button', { name: 'Set up sync on this device' }));
    expect(calls.pair).toHaveBeenCalledWith({ relayUrl: 'https://relay.example.ts.net' });

    // the first reveal: words + QR, and it can't be closed until the words are saved
    const words = await screen.findByRole('list', { name: 'The 24 words' });
    expect(within(words).getAllByRole('listitem')).toHaveLength(24);
    expect(screen.getByRole('img', { name: 'QR code of the pairing code' })).toBeInTheDocument();
    expect(screen.getByText('Anyone with these words can read and change your Vitals data.')).toBeInTheDocument();
    expect(screen.getByText(/Lose every device and these 24 words, and the data is gone\./)).toBeInTheDocument();
    const hide = screen.getByRole('button', { name: 'Hide' });
    expect(hide).toHaveAttribute('aria-disabled', 'true');
    await user.click(hide);
    expect(screen.getByRole('list', { name: 'The 24 words' })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: "I've saved the words" }));
    const enabledHide = screen.getByRole('button', { name: 'Hide' }); // the key re-renders without its tooltip
    expect(enabledHide).not.toHaveAttribute('aria-disabled');
    await user.click(enabledHide);
    expect(screen.queryByRole('list', { name: 'The 24 words' })).not.toBeInTheDocument();

    // later reveals need no confirmation
    await user.click(screen.getByRole('button', { name: 'Show pairing code' }));
    expect(await screen.findByRole('list', { name: 'The 24 words' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('tests the server before creating a key: no answer, no key; Test reports a reachable server', async () => {
    const user = userEvent.setup();
    const { calls } = fakeController();
    render(<SyncSection />);
    const input = screen.getByLabelText('sync server address');
    await user.type(input, 'http://127.0.0.1:4870');
    relayCheck.result = { ok: false, message: 'No answer from that address. Is the server running and is Tailscale on?' };
    await user.click(screen.getByRole('button', { name: 'Set up sync on this device' }));
    expect(await screen.findByText('No answer from that address. Is the server running and is Tailscale on?')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(calls.pair).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: 'The 24 words' })).not.toBeInTheDocument();

    relayCheck.result = REACHED;
    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByText(/Reached the server · version 0\.1\.0/)).toBeInTheDocument();
    expect(calls.pair).not.toHaveBeenCalled();
    expect(relayCheck.calls).toEqual(['http://127.0.0.1:4870', 'http://127.0.0.1:4870']);
  });

  it.each(['merge', 'replace'] as const)('joins with a pasted pairing URI and resolves the existing-data question with %s', async (choice) => {
    const user = userEvent.setup();
    const { calls } = fakeController({ local: '3 scenarios and your body' });
    render(<SyncSection />);
    await user.click(screen.getByRole('button', { name: 'Join with a pairing code' }));
    fireEvent.change(screen.getByLabelText('pairing code'), { target: { value: `  ${CODE.uri}\n` } });
    await user.click(screen.getByRole('button', { name: 'Join' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'This device already has data' });
    expect(dialog).toHaveTextContent('Merge it, or replace it with the synced data?');
    expect(dialog).toHaveTextContent('3 scenarios and your body');
    expect(calls.join).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: choice === 'merge' ? 'Merge' : 'Replace with synced data' }));
    await waitFor(() => expect(calls.join).toHaveBeenCalledWith({ code: CODE.uri, onExisting: choice }));
    // now paired
    expect(await screen.findByRole('button', { name: 'Show pairing code' })).toBeInTheDocument();
  });

  it('checks a pasted code and asks for the server with the 24 words', async () => {
    const user = userEvent.setup();
    const { calls } = fakeController();
    render(<SyncSection />);
    await user.click(screen.getByRole('button', { name: 'Join with a pairing code' }));
    const area = screen.getByLabelText('pairing code');
    fireEvent.change(area, { target: { value: 'vitals-sync:1?u=x' } });
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(screen.getByRole('alert')).toHaveTextContent('This pairing code is incomplete');

    fireEvent.change(area, { target: { value: CODE.words.join(' ') } });
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(screen.getByRole('alert')).toHaveTextContent('With the 24 words, also enter the sync server address above.');
    expect(calls.join).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('sync server address'), 'relay.example.ts.net');
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(calls.join).toHaveBeenCalledWith({ code: CODE.words.join(' '), relayUrl: RELAY, onExisting: 'merge' });
  });
});

describe('Settings › Sync, paired', () => {
  it('shows the words only after "Show pairing code" and hides them after 60 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    fakeController({ paired: true, status: { state: 'synced', endpoint: 'relay.example.ts.net' } });
    render(<SyncSection />);
    expect(screen.queryByText(CODE.words[0]!)).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'The 24 words' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show pairing code' }));
    const words = await screen.findByRole('list', { name: 'The 24 words' });
    expect(words).toHaveTextContent(CODE.words[23]!);
    act(() => vi.advanceTimersByTime(AUTO_HIDE_MS - 1000));
    expect(screen.getByRole('list', { name: 'The 24 words' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole('list', { name: 'The 24 words' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show pairing code' })).toBeInTheDocument();
  });

  it('Sync now calls syncNow; changes the relay; stops syncing after confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = fakeController({ paired: true, status: { state: 'synced', endpoint: 'relay.example.ts.net', lastSyncedAt: todayAt(9, 5) } });
    render(<SyncSection />);
    expect(screen.getByRole('status')).toHaveTextContent(/synced.*last synced 09:05 · relay\.example\.ts\.net/);
    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(calls.now).toHaveBeenCalledTimes(1);

    const input = screen.getByLabelText('sync server address');
    await user.clear(input);
    await user.type(input, 'wss://other.example.ts.net/sync');
    await user.click(screen.getByRole('button', { name: 'Save address' }));
    expect(calls.configure).toHaveBeenCalledWith({ relayUrl: 'wss://other.example.ts.net/sync' });

    await user.click(screen.getByRole('button', { name: 'Stop syncing on this device' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Stop syncing on this device?' });
    await user.click(within(dialog).getByRole('button', { name: 'Stop syncing' }));
    expect(calls.unpair).toHaveBeenCalledWith({}, { confirmation: expect.objectContaining({ commandId: 'sync.unpair' }) });
    expect(await screen.findByRole('button', { name: 'Set up sync on this device' })).toBeInTheDocument();
  });

  it('shows the server in use, that it answers now with its version, and the last sync', async () => {
    relayCheck.result = { ok: true, message: 'Reached the server · version 0.4.0 · 21 ms', version: '0.4.0', ms: 21 };
    fakeController({ paired: true, status: { state: 'synced', endpoint: 'relay.example.ts.net', lastSyncedAt: todayAt(9, 5) } });
    render(<SyncSection />);
    const value = (key: string) => screen.getByText(key, { selector: 'dt' }).nextElementSibling;
    expect(value('sync server')).toHaveTextContent(RELAY);
    await waitFor(() => expect(value('answers now')).toHaveTextContent('yes (21 ms)'));
    expect(value('server version')).toHaveTextContent('0.4.0');
    expect(value('last sync')).toHaveTextContent('09:05');
    expect(relayCheck.calls).toEqual([RELAY]);
  });

  it('says when the server does not answer, and Check server asks again', async () => {
    const user = userEvent.setup();
    relayCheck.result = { ok: false, message: 'No answer from that address. Is the server running and is Tailscale on?' };
    fakeController({ paired: true, status: { state: 'offline', endpoint: 'relay.example.ts.net' } });
    render(<SyncSection />);
    const value = (key: string) => screen.getByText(key, { selector: 'dt' }).nextElementSibling;
    await waitFor(() => expect(value('answers now')).toHaveTextContent('no'));
    expect(screen.getByText('No answer from that address. Is the server running and is Tailscale on?')).toBeInTheDocument();
    expect(screen.queryByText('server version')).not.toBeInTheDocument();
    expect(value('last sync')).toHaveTextContent('not yet');

    relayCheck.result = { ok: true, message: 'Reached the server · 5 ms', version: null, ms: 5 };
    await user.click(screen.getByRole('button', { name: 'Check server' }));
    await waitFor(() => expect(value('answers now')).toHaveTextContent('yes (5 ms)'));
    expect(screen.queryByText(/No answer from that address/)).not.toBeInTheDocument();
    expect(relayCheck.calls).toEqual([RELAY, RELAY]);
  });

  it('disables Sync now while syncing and hides it while sync is off', async () => {
    const { calls, emit } = fakeController({ paired: true, status: { state: 'syncing' } });
    render(<SyncSection />);
    expect(screen.getByRole('button', { name: 'Syncing…' })).toHaveAttribute('aria-busy', 'true');
    emit({ state: 'off' });
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
    expect(calls.now).not.toHaveBeenCalled();
  });

  it('renders the unreachable-server copy with the last sync time and waiting changes', () => {
    const { emit } = fakeController({ paired: true, status: { state: 'synced' } });
    render(<SyncSection />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    emit({ state: 'offline', lastSyncedAt: todayAt(14, 2), pendingChanges: 37 });
    expect(screen.getByRole('alert')).toHaveTextContent("Can't reach your sync server. Is Tailscale on? (last synced 14:02, 37 changes waiting)");
    emit({ state: 'error', lastError: { code: 'unreachable', message: 'Failed to fetch', at: todayAt(14, 3) } });
    expect(screen.getByRole('alert')).toHaveTextContent("Can't reach your sync server. Is Tailscale on? (last synced 14:02, 37 changes waiting)");
    emit({ state: 'needs-permission' });
    expect(screen.getByRole('alert')).toHaveTextContent(/devices on your local network/);
  });
});

describe('Settings › Sync with a paired home server', () => {
  const withServer = () =>
    render(
      <MemoryRouter>
        <ServerClientContext.Provider value={fakeClient({ paired: true }).client}>
          <SyncSection />
        </ServerClientContext.Provider>
      </MemoryRouter>,
    );

  it('with sync through the server the page is a backup area (words, QR, Sync now, no Set up)', async () => {
    const user = userEvent.setup();
    const { calls } = fakeController({ paired: true, status: { state: 'synced' } });
    fake.view = { ...(fake.view as object), relayUrl: BASE };
    withServer();
    // a true sentence for a home server, never "only ever holds encrypted data"
    expect(screen.getByText('Your home server holds a readable copy of your data and syncs your devices. The 24 words are the backup.')).toBeInTheDocument();
    expect(screen.queryByText(/only ever holds encrypted data/)).toBeNull();
    expect(screen.getByText(/On · through your server/)).toBeInTheDocument();
    expect(screen.getByText(/A device that already synced keeps the sync key/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up sync on this device' })).toBeNull();
    expect(screen.queryByLabelText('sync server address')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(calls.now).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Show pairing code' }));
    expect(within(await screen.findByRole('list', { name: 'The 24 words' })).getAllByRole('listitem')).toHaveLength(24);
    expect(screen.getByTestId('pairing-qr')).toBeInTheDocument();
    expect(screen.getByText('Anyone with these words can read and change your Vitals data.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop syncing on this device' })).toBeInTheDocument();
  });

  it('a paired home server that gave no key: join by words or QR only, never a new group', () => {
    fakeController();
    withServer();
    expect(screen.getByText('Your home server holds a readable copy of your data and syncs your devices. The 24 words are the backup.')).toBeInTheDocument();
    expect(screen.queryByText(/only ever holds encrypted data/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set up sync on this device' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Join with a pairing code' })).toBeInTheDocument();
    expect(screen.getByLabelText('sync server address')).toHaveValue(BASE);
  });
});

describe('status and QR helpers', () => {
  it('describes other errors by their message', () => {
    const v = describeStatus({ ...OFF_STATUS, state: 'error', lastError: { code: 'relay_rejected', message: 'The server refused this device', at: todayAt(1, 0) } });
    expect(v.problem).toBe('Sync stopped: The server refused this device.');
    expect(describeStatus({ ...OFF_STATUS, state: 'synced', pendingChanges: 1, pendingBlobs: 2 }).detail).toBe('1 change waiting · 2 uploads waiting');
  });

  it('renders the QR code of a pairing URI as SVG paths', () => {
    const { size, d } = qrPath(CODE.uri);
    expect(size).toBeGreaterThanOrEqual(21 + 4);
    expect(d).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
    fakeController({ paired: true });
    render(<SyncSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Show pairing code' }));
    return screen.findByTestId('pairing-qr').then((svg) => {
      expect(svg.tagName.toLowerCase()).toBe('svg');
      expect(svg.getAttribute('viewBox')).toBe(`0 0 ${size} ${size}`);
      expect(svg.querySelector('path')?.getAttribute('d')).toBe(d);
    });
  });
});
