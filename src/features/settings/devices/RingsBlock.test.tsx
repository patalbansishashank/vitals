import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRingServiceForTests, type RingCandidate, type RingService, type RingStatus } from '@/biometrics/service';
import { platform } from '@/platform';
import { RingsBlock, STILL_LOOKING_MS } from './RingsBlock';

vi.mock('@/platform', () => ({ platform: vi.fn(() => 'web') }));

const KEY = 'ble:jstyle2301|j-style:2301#0a1b';
const ring = (over: Partial<RingStatus> = {}): RingStatus => ({ ringKey: KEY, label: 'J-Style 2301', state: 'idle', ...over });

/** A ring service the test drives: `set` replaces the rings and tells the subscribers. */
function fakeService(init: RingStatus[] = [], candidates: RingCandidate[] = []) {
  let rings = init;
  let availability: ReturnType<RingService['availability']> = 'ready';
  const subs = new Set<(r: RingStatus[]) => void>();
  const stopLive = vi.fn();
  let resolvePair: (s: RingStatus) => void = () => undefined;
  const svc = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    rings: () => rings,
    subscribe: (cb: (r: RingStatus[]) => void) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    availability: () => availability,
    scan: vi.fn(async function* () {
      for (const c of candidates) yield c;
    }),
    pair: vi.fn(() => new Promise<RingStatus>((res) => (resolvePair = res))),
    connectHere: vi.fn(async () => undefined),
    syncNow: vi.fn(async () => undefined),
    checkNow: vi.fn(async () => ({ value: 60, unit: 'bpm', at: '2026-10-04T08:00:00Z' })),
    watchLiveHeartRate: vi.fn(() => stopLive),
    disconnect: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
    syncLink: vi.fn(() => Promise.reject(new Error('not in this test'))),
  } satisfies RingService;
  return {
    svc,
    stopLive,
    set(next: RingStatus[]) {
      rings = next;
      act(() => subs.forEach((cb) => cb(next)));
    },
    setAvailability(a: typeof availability) {
      availability = a;
    },
    finishPair: (s: RingStatus) => act(() => resolvePair(s)),
  };
}

let fake: ReturnType<typeof fakeService>;
const use = (f: ReturnType<typeof fakeService>) => {
  fake = f;
  setRingServiceForTests(f.svc);
};

beforeEach(() => vi.mocked(platform).mockReturnValue('web'));
afterEach(() => setRingServiceForTests(null));

describe('Settings › Devices › rings', () => {
  it('each ring carries its ring settings (moved here from the old Ring page); no link to a Ring page', async () => {
    use(fakeService([ring({ state: 'connected', firmware: 'V0789' })]));
    render(<RingsBlock />, { wrapper: MemoryRouter });
    expect(await screen.findByRole('heading', { name: 'Ring settings' })).toBeTruthy();
    expect([...document.querySelectorAll('li.rs-setting')].map((li) => li.getAttribute('data-row'))).toEqual(['firmware', 'battery over time']);
    expect(screen.getByText('V0789')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Ring page/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'See the data' })).toHaveAttribute('href', '/signals');
  });

  it('keeps keyboard focus in the scan flow and returns it after pairing or Stop', async () => {
    const user = userEvent.setup();
    use(fakeService([], [{ candidateId: 'c1', driverId: 'jstyle2301', label: 'J-Style 2301', known: false }]));
    render(<RingsBlock />, { wrapper: MemoryRouter });
    await user.click(screen.getByRole('button', { name: 'Add a ring' }));
    const candidate = await screen.findByRole('button', { name: /^J-Style 2301/ });
    expect(screen.getByText('1 ring nearby')).toHaveFocus();
    await user.tab();
    expect(candidate).toHaveFocus();
    await user.click(candidate);
    expect(screen.getByText('Connecting…')).toHaveFocus();
    fake.finishPair(ring({ state: 'connected' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add a ring' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Add a ring' }));
    await user.click(screen.getByRole('button', { name: 'Stop looking' }));
    expect(screen.getByRole('button', { name: 'Add a ring' })).toHaveFocus();
  });

  it.each<[Partial<RingStatus>, RegExp]>([
    [{ state: 'idle' }, /^Not connected$/],
    [{ state: 'searching' }, /^Looking for your ring…$/],
    [{ state: 'connecting' }, /^Connecting…$/],
    [{ state: 'connected' }, /^Connected$/],
    [{ state: 'syncing', syncProgress: 0.4 }, /^Reading your ring… 40 %$/],
    [{ state: 'syncing' }, /^Reading your ring…$/],
    [{ state: 'bluetooth_off' }, /^Bluetooth is off$/],
    [{ state: 'permission_needed' }, /^Allow Bluetooth for Vitals$/],
    [{ state: 'error', error: { code: 'not_found', message: 'Your ring may be connected to another app or phone. Close it there, then try again.' } }, /^Your ring may be connected to another app/],
  ])('says the state in plain words: %o', (over, line) => {
    use(fakeService([ring(over)]));
    render(<RingsBlock />, { wrapper: MemoryRouter });
    expect(screen.getByRole('heading', { name: 'J-Style 2301' })).toBeTruthy();
    expect(screen.getAllByRole('status').some((s) => line.test(s.textContent ?? ''))).toBe(true);
  });

  it('shows battery and the last read with the device that read it', () => {
    const at = new Date(Date.now() - 12 * 60_000).toISOString();
    use(fakeService([ring({ state: 'connected', battery: 64, charging: true, lastSyncAt: at, lastSyncBy: 'Kitchen laptop' })]));
    render(<RingsBlock />, { wrapper: MemoryRouter });
    expect(screen.getByText('Battery 64 % · charging · Last read 12 min ago on Kitchen laptop')).toBeTruthy();
  });

  it('elsewhere: names the device holding the ring and connects here on request', () => {
    const since = new Date();
    since.setHours(9, 5, 0, 0);
    use(fakeService([ring({ state: 'elsewhere', heldBy: { deviceId: 'd2', deviceLabel: 'Pixel 8', platform: 'android', since: since.toISOString() } })]));
    render(<RingsBlock />, { wrapper: MemoryRouter });
    expect(screen.getByText(/^Connected to Pixel 8 since (yesterday )?09:05$/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Connect here instead' }));
    expect(fake.svc.connectHere).toHaveBeenCalledWith(KEY);
  });

  it('offers Connect when not connected, Sync now and Disconnect when connected', () => {
    use(fakeService([ring({ state: 'idle', paused: true })]));
    const v = render(<RingsBlock />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(fake.svc.connectHere).toHaveBeenCalledWith(KEY);
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    fake.set([ring({ state: 'connected' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(fake.svc.syncNow).toHaveBeenCalledWith(KEY);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(fake.svc.disconnect).toHaveBeenCalledWith(KEY);
    v.unmount();
  });

  it('forgets a ring only after the confirmation', async () => {
    use(fakeService([ring()]));
    render(<RingsBlock />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: 'Forget…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(fake.svc.forget).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Forget ring' }));
    await waitFor(() => expect(fake.svc.forget).toHaveBeenCalledWith(KEY));
  });

  it('watches live heart rate while the card is shown and the ring is connected, and stops on unmount', () => {
    use(fakeService([ring({ state: 'idle' })]));
    const v = render(<RingsBlock />, { wrapper: MemoryRouter });
    expect(fake.svc.watchLiveHeartRate).not.toHaveBeenCalled();
    fake.set([ring({ state: 'connected', liveHr: { bpm: 61.6, at: '2026-10-04T08:00:00Z' } })]);
    expect(fake.svc.watchLiveHeartRate).toHaveBeenCalledTimes(1);
    expect(fake.svc.watchLiveHeartRate).toHaveBeenCalledWith(KEY);
    expect(screen.getByText('Heart rate now 62 bpm')).toBeTruthy();
    fake.set([ring({ state: 'syncing' })]);
    expect(fake.svc.watchLiveHeartRate).toHaveBeenCalledTimes(1);
    expect(fake.stopLive).not.toHaveBeenCalled();
    v.unmount();
    expect(fake.stopLive).toHaveBeenCalledTimes(1);
  });

  it('stops watching when the ring disconnects', () => {
    use(fakeService([ring({ state: 'connected' })]));
    render(<RingsBlock />, { wrapper: MemoryRouter });
    expect(fake.svc.watchLiveHeartRate).toHaveBeenCalledTimes(1);
    fake.set([ring({ state: 'idle' })]);
    expect(fake.stopLive).toHaveBeenCalledTimes(1);
  });

  it('lists nearby rings by driver label only, marks the person’s own, and pairs on a tap', async () => {
    // what a ring advertises is not part of RingCandidate; a stray field must never reach the screen
    const advertised = { name: 'ADVERTISED-NAME-77' };
    use(
      fakeService(
        [],
        [
          { candidateId: 'c1', driverId: 'jstyle2301', label: 'J-Style 2301', rssi: -58, known: false, ...advertised } as RingCandidate,
          { candidateId: 'c2', driverId: 'colmi', label: 'Colmi R02', rssi: -90, known: true },
        ],
      ),
    );
    const { container } = render(<RingsBlock />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: 'Add a ring' }));
    expect(fake.svc.scan).toHaveBeenCalledTimes(1); // started inside the click (the browser's chooser needs it)
    const list = await screen.findByRole('list', { name: 'rings nearby' });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['J-Style 2301 · close by', 'Colmi R02 · Already yours']);
    expect(container.textContent).not.toContain('ADVERTISED');
    fireEvent.click(within(list).getByRole('button', { name: /Colmi R02/ }));
    expect(fake.svc.pair).not.toHaveBeenCalled();
    fireEvent.click(within(list).getByRole('button', { name: /J-Style 2301/ }));
    expect(fake.svc.pair).toHaveBeenCalledWith('c1');
    expect(screen.getByText('Connecting…')).toBeTruthy();
    fake.set([ring({ state: 'syncing', syncProgress: 0.1 })]);
    expect(screen.getByText('Reading your ring’s history…')).toBeTruthy();
    fake.finishPair(ring({ state: 'connected' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add a ring' })).toBeTruthy());
  });

  it('asks which ring it is when this device can’t tell the person’s rings of one model apart', async () => {
    const matches = [
      { ringKey: 'k1', lastSyncBy: 'Pixel 8' },
      { ringKey: 'k2', lastSyncBy: 'Kitchen laptop' },
    ];
    use(fakeService([], [{ candidateId: 'c1', driverId: 'jstyle2301', label: 'J-Style 2301', known: false, matches }]));
    render(<RingsBlock />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: 'Add a ring' }));
    fireEvent.click(await screen.findByRole('button', { name: /^J-Style 2301/ }));
    expect(fake.svc.pair).not.toHaveBeenCalled();
    const which = screen.getByRole('group', { name: 'Which of your rings is this?' });
    expect(within(which).getByRole('button', { name: 'Your J-Style 2301 from Pixel 8' })).toHaveFocus();
    expect(within(which).getAllByRole('button').map((b) => b.textContent)).toEqual(['Your J-Style 2301 from Pixel 8', 'Your J-Style 2301 from Kitchen laptop', 'A new ring']);
    fireEvent.click(within(which).getByRole('button', { name: 'Your J-Style 2301 from Kitchen laptop' }));
    expect(fake.svc.pair).toHaveBeenCalledWith('c1', 'k2');
  });

  it.each([false, true])('keeps the scan open until the tapped ring reaches the service (the app chooser answers the pick; which-ring: %s)', async (which) => {
    // the desktop and Android transports answer a tap through the open list: ending the scan first meant "No ring chosen"
    const matches = which ? [{ ringKey: 'k1' }, { ringKey: 'k2' }] : undefined;
    const f = fakeService([], []);
    let signal: AbortSignal | undefined;
    f.svc.scan.mockImplementation(async function* (s: AbortSignal) {
      signal = s;
      yield { candidateId: 'c1', driverId: 'jstyle2301', label: 'J-Style 2301', known: false, ...(matches ? { matches } : {}) };
      await new Promise<void>((r) => s.addEventListener('abort', () => r(), { once: true }));
    } as never);
    let openAtPair: boolean | undefined;
    const pair = f.svc.pair.getMockImplementation()!;
    f.svc.pair.mockImplementation((...a: Parameters<typeof pair>) => {
      openAtPair = signal ? !signal.aborted : undefined;
      return pair(...a);
    });
    use(f);
    render(<RingsBlock />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: 'Add a ring' }));
    fireEvent.click(await screen.findByRole('button', { name: /^J-Style 2301/ }));
    if (which) {
      expect(signal!.aborted).toBe(false);
      fireEvent.click(within(screen.getByRole('group', { name: 'Which of your rings is this?' })).getByRole('button', { name: 'A new ring' }));
    }
    expect(f.svc.pair).toHaveBeenCalledTimes(1);
    expect(openAtPair).toBe(true);
    expect(screen.getByText('Connecting…')).toBeTruthy();
    f.finishPair(ring({ state: 'connected' }));
    await waitFor(() => expect(signal!.aborted).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add a ring' })).toBeTruthy());
  });

  it('on the desktop keeps the list open while it looks: "Still looking…" after 15 s, a ring heard late shows as "Ring"', async () => {
    vi.mocked(platform).mockReturnValue('electron');
    const f = fakeService([], []);
    let signal: AbortSignal | undefined;
    f.svc.scan.mockImplementation(async function* (s: AbortSignal) {
      signal = s;
      await new Promise((r) => setTimeout(r, 40_000));
      yield { candidateId: 'E2:80:00:00:73:07', driverId: 'unidentified', label: 'Ring', known: false };
      await new Promise<void>((r) => s.addEventListener('abort', () => r(), { once: true }));
    } as never);
    use(f);
    vi.useFakeTimers();
    try {
      render(<RingsBlock />, { wrapper: MemoryRouter });
      fireEvent.click(screen.getByRole('button', { name: 'Add a ring' }));
      const status = () => screen.getAllByRole('status').map((x) => x.textContent).join(' | ');
      await act(() => vi.advanceTimersByTimeAsync(STILL_LOOKING_MS - 1));
      expect(status()).toBe('Looking for rings nearby…');
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(status()).toBe('Still looking…');
      await act(() => vi.advanceTimersByTimeAsync(40_000 - STILL_LOOKING_MS));
      const list = screen.getByRole('list', { name: 'rings nearby' });
      expect(within(list).getAllByRole('button').map((x) => x.textContent)).toEqual(['Ring']);
      expect(status()).toBe('Still looking…');
      expect(signal!.aborted).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Stop looking' }));
      expect(signal!.aborted).toBe(true);
      expect(screen.getByRole('button', { name: 'Add a ring' })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when no ring answered, and can look again', async () => {
    use(fakeService());
    render(<RingsBlock />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: 'Add a ring' }));
    expect(await screen.findByText(/^No ring found/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Look again' }));
    expect(fake.svc.scan).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['android', 'Your phone may ask to pair with the ring. That’s expected; choose Pair.'],
    ['electron', 'Your computer may ask to pair with the ring. That’s expected; choose Pair.'],
  ] as const)('on %s says the system may ask to pair', async (p, line) => {
    vi.mocked(platform).mockReturnValue(p);
    use(fakeService());
    render(<RingsBlock />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: 'Add a ring' }));
    expect(await screen.findByText(line)).toBeTruthy();
  });

  it.each(['android', 'electron'] as const)('in the %s app without Bluetooth the line does not say "browser" (J2-05)', (p) => {
    vi.mocked(platform).mockReturnValue(p);
    const f = fakeService([ring()]);
    f.setAvailability('unsupported');
    use(f);
    render(<RingsBlock />, { wrapper: MemoryRouter });
    expect(screen.getByText('This device can’t reach rings: Bluetooth isn’t available to Vitals here.')).toBeTruthy();
    expect(screen.queryByText(/browser/)).toBeNull();
  });

  it('in a browser without Bluetooth says one line and offers nothing else', () => {
    const f = fakeService([ring()]);
    f.setAvailability('unsupported');
    use(f);
    const { container } = render(<RingsBlock />, { wrapper: MemoryRouter });
    expect(screen.getByText('This browser can’t reach rings. Use the Vitals app for Android or your computer.')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelectorAll('p')).toHaveLength(2); // the "rings" caption and the line
  });
});
