import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNetAllowlist } from '@/net/net';
import { setServerConnection, type MqttStatus } from '@/net/mqtt';
import { MqttCard } from './MqttCard';

const STATUS: MqttStatus = {
  enabled: true,
  address: 'wss://home.example.ts.net:8443/mqtt',
  credentials: [{ username: 'p1-1', createdAt: '2026-10-01T10:00:00Z', connected: true, lastConnectAt: '2026-10-03T07:00:00Z' }],
  lastEventAt: '2026-10-03T07:12:00Z',
  eventsToday: [{ stream: 'hr', count: 412 }, { stream: 'steps', count: 96 }],
  deadLetters: { today: 3, last7d: 5, lastReason: 'unknown_type' },
};
const NEWER: MqttStatus = { ...STATUS, battery: { percent: 64, at: new Date().toISOString() }, deadLetters: { ...STATUS.deadLetters, byReason: { unknown_type: 3, wrong_installation: 2 } } };
const fetchMock = vi.fn();
const json = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s }));
const ui = () => render(<MemoryRouter><MqttCard onImportFile={() => undefined} /></MemoryRouter>);

beforeEach(() => {
  resetNetAllowlist();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  setServerConnection(undefined);
  vi.unstubAllGlobals();
});
const pair = () => setServerConnection({ baseUrl: 'https://home.example.ts.net:8443', token: 'T' });

describe('MqttCard', () => {
  it('explains when no server is paired and asks nothing of the network', () => {
    setServerConnection(null);
    ui();
    expect(screen.getByText(/Pair a server first/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Server settings/ }).getAttribute('href')).toBe('/settings/server');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows connection, last event, counts and set-aside events with the reason', async () => {
    pair();
    fetchMock.mockImplementation(() => json(STATUS));
    ui();
    expect((await screen.findAllByText('p1-1')).length).toBeGreaterThan(0);
    expect(screen.getByText('connected')).toBeTruthy();
    expect(screen.getByText(/heart rate 412 · steps 96/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'See why' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/type Vitals doesn’t know yet/, { selector: 'p, p *' })).toBeTruthy();
  });

  it('shows the ring’s battery and each set-aside reason with its count (server 0.4.1)', async () => {
    pair();
    fetchMock.mockImplementation(() => json(NEWER));
    ui();
    expect(await screen.findByText(/^Battery 64 % at \d\d:\d\d · last data received/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'See why' }));
    const list = within(await screen.findByRole('dialog')).getByRole('list', { name: 'In the last 7 days' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^3 · The event is a type/),
      expect.stringMatching(/^2 · The event came from a different phone/),
    ]);
  });

  it('says plainly when the server is unreachable and when the feed is off', async () => {
    pair();
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('x')));
    const a = ui();
    expect(await screen.findByRole('alert')).toBeTruthy();
    a.unmount();
    fetchMock.mockImplementation(() => json({ ...STATUS, enabled: false }));
    ui();
    expect(await screen.findByText(/switched off on your server/)).toBeTruthy();
  });

  it('shows the new password once and hides it after Done', async () => {
    pair();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? json({ address: STATUS.address, username: 'p1-2', password: 'PW-123', baseTopic: 'lumen-health/v1' }) : json({ ...STATUS, credentials: [] }),
    );
    ui();
    fireEvent.click(await screen.findByRole('button', { name: 'Create broker login' }));
    expect((await screen.findByTestId('once-password')).textContent).toBe('PW-123');
    expect(screen.getByText(/will not see this password again/)).toBeTruthy();
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done.getAttribute('aria-disabled') === 'true' || (done as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/pasted these/));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByText('PW-123')).toBeNull());
    expect(document.body.innerHTML).not.toContain('PW-123');
  });
});
