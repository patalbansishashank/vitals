/**
 * (r070) The move card, the Ring device screen and the short-video limit, against a mocked `GaugeEngine` plugin.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetGaugeEngineStoreForTests, startGaugeEngine } from '@/state/gaugeEngine';
import { useSettingsStore } from '@/state/settingsStore';
import { withSystemWrite } from '@/state/scope';
import { DeviceView } from '../DeviceView';
import { EngineLimitCard } from '../EngineLimit';
import { MoveFromGauge } from '../MoveFromGauge';
import { baseState, fakeEngine } from './fakeEngine';

window.scrollTo = (() => undefined) as typeof window.scrollTo;
const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

async function mount(ui: React.ReactElement, state = baseState()) {
  const f = fakeEngine(state);
  startGaugeEngine({
    plugin: () => f.plugin,
    credentials: () => ({ serverUrl: 'https://home.example', deviceToken: 't' }),
    onPairing: () => () => undefined,
    visible: () => true,
  });
  render(<MemoryRouter>{ui}</MemoryRouter>);
  await tick();
  return f;
}

beforeEach(() => {
  withSystemWrite(() => useSettingsStore.setState({ quietMode: false } as never));
});
afterEach(() => {
  resetGaugeEngineStoreForTests();
});

const gauge = (pending: number | null, over = {}) =>
  baseState({ mode: 'passive', gauge: { installed: true, pendingUploads: pending }, ...over });
const key = (name: RegExp | string) => screen.getByRole('button', { name });

describe('Finish moving from the old ring app', () => {
  it('renders nothing when the engine is not there, or everything is done', async () => {
    render(
      <MemoryRouter>
        <MoveFromGauge />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Finish moving/)).toBeNull();
    await mount(<MoveFromGauge />);
    expect(screen.queryByText(/Finish/)).toBeNull();
  });

  it('step 1 waits for Gauge to send what it holds, showing the count, then offers the uninstall', async () => {
    const f = await mount(<MoveFromGauge />, gauge(12));
    expect(screen.getByRole('heading', { name: 'Finish moving from the old ring app' })).toBeTruthy();
    expect(document.querySelector('.eg-move')?.textContent).not.toMatch(/\bGauge\b/);
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect(screen.getByText(/The old ring app still has 12 readings to send/)).toBeTruthy();
    expect(key('Uninstall old ring app').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(key('Uninstall old ring app'));
    expect(f.plugin.uninstallGauge).not.toHaveBeenCalled();
    act(() => f.set(gauge(0)));
    expect(screen.getByText('The old ring app has sent everything.')).toBeTruthy();
    expect(key('Uninstall old ring app').getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(key('Uninstall old ring app'));
    await tick();
    expect(f.plugin.uninstallGauge).toHaveBeenCalledTimes(1);
  });

  it('when the old ring app has not said what it holds, the uninstall waits, with one explicit way past', async () => {
    const f = await mount(<MoveFromGauge />, gauge(null));
    expect(screen.getByText(/has not said what it still holds/)).toBeTruthy();
    expect(key('Uninstall old ring app').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(key('Uninstall anyway'));
    await tick();
    expect(f.plugin.uninstallGauge).toHaveBeenCalledTimes(1);
  });

  it('step 2 once the old ring app is gone: one key takes over the ring', async () => {
    const f = await mount(
      <MoveFromGauge />,
      baseState({ mode: 'needsTakeover', gauge: { installed: false, pendingUploads: null } }),
    );
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Uninstall old ring app' })).toBeNull();
    fireEvent.click(key('Take over the ring'));
    await tick();
    expect(f.plugin.takeOver).toHaveBeenCalledTimes(1);
  });

  it('step 3 is a checklist with one tap each, and the card goes when it is all done', async () => {
    const s = baseState({
      permissions: {
        bluetooth: 'denied',
        healthConnect: 'partial',
        activityRecognition: 'granted',
        notifications: 'denied',
        shortVideoAccessibility: false,
        batteryUnrestricted: false,
      },
    });
    const f = await mount(<MoveFromGauge />, s);
    expect(screen.getByRole('heading', { name: 'Finish setting up the ring' })).toBeTruthy();
    expect(screen.queryByText(/Step \d of 3/)).toBeNull();
    const rows = screen.getAllByRole('listitem');
    const text = rows.map((r) => r.textContent?.replace(/\s+/g, ' ').trim());
    expect(text).toEqual([
      'BluetoothAllow',
      'Health ConnectAllow the rest',
      'Physical activityAllowed',
      'NotificationsAllow',
      'Short-video limitOpen settings',
      'Battery unrestrictedOpen settings',
    ]);
    fireEvent.click(within(rows[0]!).getByRole('button'));
    await tick();
    expect(f.plugin.requestPermissions).toHaveBeenCalledWith({ which: ['bluetooth'] });
    fireEvent.click(within(rows[1]!).getByRole('button'));
    await tick();
    expect(f.plugin.requestPermissions).toHaveBeenLastCalledWith({ which: ['healthConnect'] });
    fireEvent.click(within(rows[4]!).getByRole('button'));
    fireEvent.click(within(rows[5]!).getByRole('button'));
    await tick();
    expect(f.plugin.openAccessibilitySettings).toHaveBeenCalledTimes(1);
    expect(f.plugin.openBatterySettings).toHaveBeenCalledTimes(1);
    act(() => f.set(baseState()));
    expect(screen.queryByText(/Finish/)).toBeNull();
  });

  it('says why when an action fails', async () => {
    const f = await mount(
      <MoveFromGauge />,
      baseState({ mode: 'needsTakeover', gauge: { installed: false, pendingUploads: null } }),
    );
    f.plugin.takeOver.mockRejectedValueOnce(new Error('Bluetooth is off'));
    fireEvent.click(key('Take over the ring'));
    await tick();
    expect(screen.getByText('Bluetooth is off')).toBeTruthy();
  });
});

/**
 * (r071) Android holds the short-video counter back (the "restricted setting" of an app that came onto the phone as a file):
 * the guide shows where the counter is asked for, only while it is wanted and off, with one key to the App info page.
 */
describe('Allow the counter first', () => {
  const off = (extra: Record<string, unknown> = {}, shortVideo = baseState().shortVideo) =>
    baseState({
      permissions: { ...baseState().permissions, shortVideoAccessibility: false, ...extra },
      shortVideo,
    });
  const guide = () => screen.queryByRole('region', { name: 'Android blocks the counter until you allow it' });
  const openSettings = () => key('Open settings: Short-video limit');

  it('shows under the checklist when Android holds the counter back: three steps, one key to the App info page', async () => {
    const f = await mount(<MoveFromGauge />, off({ shortVideoRestricted: true }));
    const g = guide()!;
    expect(g).toBeTruthy();
    const steps = within(g)
      .getAllByRole('listitem')
      .map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(steps).toEqual([
      "Open Vitals' app info.Open app info",
      "Tap the three dots (⋮) at the top right, then Allow restricted settings. Confirm with your phone's lock.",
      'Come back and turn on Vitals short-video counter in Accessibility settings.',
    ]);
    expect(within(g).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(within(g).getByRole('button', { name: 'Open app info' }));
    await tick();
    expect(f.plugin.openAppInfo).toHaveBeenCalledTimes(1);
    // step 3 is the row's own key
    fireEvent.click(openSettings());
    await tick();
    expect(f.plugin.openAccessibilitySettings).toHaveBeenCalledTimes(1);
    // switched on: the guide and the whole card are gone
    act(() => f.set(baseState()));
    expect(guide()).toBeNull();
    expect(screen.queryByText(/Finish/)).toBeNull();
  });

  it('stays out of the way when the phone does not say, until the person has tried and the counter is still off', async () => {
    const f = await mount(<MoveFromGauge />, off());
    expect(guide()).toBeNull();
    fireEvent.click(openSettings());
    await tick();
    expect(f.plugin.openAccessibilitySettings).toHaveBeenCalledTimes(1);
    expect(guide()).toBeTruthy();
    // coming back with it still off keeps it
    act(() => f.set(off()));
    expect(guide()).toBeTruthy();
  });

  it('never shows when the phone says Android does not hold it back', async () => {
    await mount(<MoveFromGauge />, off({ shortVideoRestricted: false }));
    fireEvent.click(openSettings());
    await tick();
    expect(guide()).toBeNull();
  });

  it('stays out while the limit is off and the counter is optional, until the person goes to turn it on', async () => {
    await mount(
      <DeviceView />,
      off(
        { shortVideoRestricted: true },
        { enabled: false, dailyLimit: null, today: { instagram: 0, youtube: 0 } },
      ),
    );
    const perms = screen.getByRole('heading', { name: 'Permissions' }).closest('section')!;
    expect(within(perms).getByText(/Optional/)).toBeTruthy();
    expect(guide()).toBeNull();
    fireEvent.click(within(perms).getByRole('button', { name: 'Open settings: Short-video limit' }));
    await tick();
    expect(guide()).toBeTruthy();
  });

  it('shows on the Ring device screen under its permissions', async () => {
    await mount(<DeviceView />, off({ shortVideoRestricted: true }));
    const perms = screen.getByRole('heading', { name: 'Permissions' }).closest('section')!;
    expect(
      within(perms).getByRole('region', { name: 'Android blocks the counter until you allow it' }),
    ).toBeTruthy();
  });

  it('the limit card says what is missing, offers the Accessibility settings, and shows the guide when Android holds the counter back', async () => {
    const f = await mount(<EngineLimitCard />, off({ shortVideoRestricted: true }));
    expect(screen.getByText(/needs the accessibility permission/)).toBeTruthy();
    expect(guide()).toBeTruthy();
    fireEvent.click(openSettings());
    await tick();
    expect(f.plugin.openAccessibilitySettings).toHaveBeenCalledTimes(1);
    fireEvent.click(within(guide()!).getByRole('button', { name: 'Open app info' }));
    await tick();
    expect(f.plugin.openAppInfo).toHaveBeenCalledTimes(1);
  });

  it('keeps the restricted-settings guide available inside the short-video hero', async () => {
    const f = await mount(<EngineLimitCard embedded />, off({ shortVideoRestricted: true }));
    expect(screen.queryByRole('heading', { name: 'Daily limit' })).toBeNull();
    expect(guide()).toBeTruthy();
    fireEvent.click(within(guide()!).getByRole('button', { name: 'Open app info' }));
    await tick();
    expect(f.plugin.openAppInfo).toHaveBeenCalledTimes(1);
  });

  it('the limit card shows the guide only after the person tried, when the phone does not say', async () => {
    const f = await mount(<EngineLimitCard />, off());
    expect(guide()).toBeNull();
    fireEvent.click(openSettings());
    await tick();
    expect(f.plugin.openAccessibilitySettings).toHaveBeenCalledTimes(1);
    expect(guide()).toBeTruthy();
  });

  it('the limit card shows nothing of it with the counter on, or the limit off', async () => {
    await mount(
      <EngineLimitCard />,
      baseState({ permissions: { ...baseState().permissions, shortVideoRestricted: true } }),
    );
    expect(guide()).toBeNull();
    expect(screen.queryByText(/needs the accessibility permission/)).toBeNull();
    resetGaugeEngineStoreForTests();
    document.body.innerHTML = '';
    await mount(
      <EngineLimitCard />,
      off(
        { shortVideoRestricted: true },
        { enabled: false, dailyLimit: null, today: { instagram: 0, youtube: 0 } },
      ),
    );
    expect(guide()).toBeNull();
    expect(screen.queryByText(/needs the accessibility permission/)).toBeNull();
  });

  it('says why when the App info page does not open', async () => {
    const f = await mount(<MoveFromGauge />, off({ shortVideoRestricted: true }));
    f.plugin.openAppInfo.mockRejectedValueOnce(new Error('Could not open the settings screen.'));
    fireEvent.click(within(guide()!).getByRole('button', { name: 'Open app info' }));
    await tick();
    expect(within(guide()!).getByText('Could not open the settings screen.')).toBeTruthy();
  });
});

describe('Ring device', () => {
  it('keeps readings and measurement gated while a saved code is still authenticating', async () => {
    const ring = { ...baseState().ring, credentialRequired: true, credentialConfigured: true, credentialAuthenticated: false };
    const f = await mount(<DeviceView />, baseState({ ring }));
    const card = screen.getByRole('heading', { name: 'Ring' }).closest('section')!;
    expect(within(card).getByText('Authenticating ring…')).toBeInTheDocument();
    expect(within(card).queryByLabelText('Ring connection code')).toBeNull();
    expect(key('Sync now')).toHaveAttribute('aria-disabled', 'true');
    expect(key('Measure now')).toHaveAttribute('aria-disabled', 'true');
    act(() => f.set(baseState({ ring: { ...ring, credentialAuthenticated: true } })));
    expect(within(card).getByText('Connected')).toBeInTheDocument();
    expect(key('Sync now')).not.toHaveAttribute('aria-disabled');
    expect(key('Measure now')).not.toHaveAttribute('aria-disabled');
  });

  it('keeps ring data gated while automatic ring access is pending, then reads after auth', async () => {
    const ring = { ...baseState().ring, credentialRequired: true, credentialConfigured: false };
    const f = await mount(<DeviceView />, baseState({ ring }));
    const card = screen.getByRole('heading', { name: 'Ring' }).closest('section')!;
    expect(within(card).getByText('Ring data unavailable')).toBeInTheDocument();
    expect(within(card).queryByText('Connected')).toBeNull();
    expect(within(card).getByText('Vitals cannot read this ring yet. A Vitals update may be needed.')).toBeInTheDocument();
    expect(key('Sync now')).toHaveAttribute('aria-disabled', 'true');
    expect(key('Measure now')).toHaveAttribute('aria-disabled', 'true');
    expect(within(card).queryByRole('textbox')).toBeNull();
    expect(within(card).queryByRole('button', { name: /Save and reconnect/ })).toBeNull();
    act(() => f.set(baseState({ ring: { ...ring, credentialConfigured: true, credentialAuthenticated: true } })));
    expect(within(card).getByText('Connected')).toBeInTheDocument();
    expect(key('Sync now')).not.toHaveAttribute('aria-disabled');
  });

  it('reports rejected access without asking for a code or claiming the link can read data', async () => {
    const f = await mount(<DeviceView />, baseState({ ring: { ...baseState().ring, credentialRequired: true, credentialConfigured: true, credentialRejected: true } }));
    const card = screen.getByRole('heading', { name: 'Ring' }).closest('section')!;
    expect(within(card).getByText('Could not read ring')).toBeInTheDocument();
    expect(within(card).getByText('Vitals could not read this ring. A Vitals update may be needed.')).toBeInTheDocument();
    expect(within(card).queryByRole('textbox')).toBeNull();
    expect(key('Sync now')).toHaveAttribute('aria-disabled', 'true');
    act(() => f.set(baseState({ ring: { ...baseState().ring, credentialRequired: true, credentialConfigured: false }, upload: { paired: false, pending: 0 } })));
    expect(within(card).getByText('Ring data unavailable')).toBeInTheDocument();
    expect(within(card).queryByRole('link', { name: 'Connect it' })).toBeNull();
  });

  it('shows the ring, its battery and last sync, the upload and the permissions', async () => {
    await mount(<DeviceView />);
    const ring = screen.getByRole('heading', { name: 'Ring' }).closest('section')!;
    expect(within(ring).getByText('Connected')).toBeTruthy();
    expect(within(ring).getByText('Ring 7C41')).toBeTruthy();
    expect(within(ring).getByText('64')).toBeTruthy();
    expect(within(ring).getByRole('button', { name: 'About Ring' })).toBeTruthy();
    expect(within(ring).queryByRole('button', { name: 'Forget ring' })).toBeNull();
    const upload = screen.getByRole('heading', { name: 'Upload to your server' }).closest('section')!;
    expect(within(upload).getByText('3')).toBeTruthy();
    expect(within(upload).queryByText('Last error')).toBeNull();
    const perms = screen.getByRole('heading', { name: 'Permissions' }).closest('section')!;
    expect(within(perms).getAllByText(/Allowed|^On$/).length).toBe(6);
    // everything is in order: no move card
    expect(screen.queryByText(/Finish/)).toBeNull();
  });

  it('quiet mode keeps battery, queue and sync times as words', async () => {
    withSystemWrite(() => useSettingsStore.setState({ quietMode: true } as never));
    await mount(<DeviceView />);
    const ring = screen.getByRole('heading', { name: 'Ring' }).closest('section')!;
    const upload = screen.getByRole('heading', { name: 'Upload to your server' }).closest('section')!;
    expect(ring.textContent).not.toMatch(/\d/);
    expect(upload.textContent).not.toMatch(/\d/);
    expect(within(ring).getByText('Fine')).toBeTruthy();
    expect(within(upload).getByText('Waiting')).toBeTruthy();
  });

  it('syncs and measures on the phone', async () => {
    const f = await mount(<DeviceView />);
    fireEvent.click(key('Sync now'));
    await tick();
    expect(f.plugin.syncNow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('radio', { name: 'SpO2' }));
    fireEvent.click(key('Measure now'));
    await tick();
    expect(f.plugin.measure).toHaveBeenCalledWith({ kind: 'spo2' });
    expect(screen.getByText(/Measuring on the ring/)).toBeTruthy();
  });

  it('cannot sync or measure while the ring is not connected, and says why', async () => {
    await mount(
      <DeviceView />,
      baseState({ ring: { state: 'disconnected', name: 'Ring 7C41', lastError: 'Out of range' } }),
    );
    expect(key('Sync now').getAttribute('aria-disabled')).toBe('true');
    expect(key('Measure now').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('The ring said: Out of range')).toBeTruthy();
    expect(screen.getByText('Disconnected')).toBeTruthy();
  });

  it('scans, lists the rings by signal, connects the chosen one', async () => {
    const f = await mount(<DeviceView />, baseState({ ring: { state: 'none' } }));
    expect(screen.getByText('No ring is connected to this phone.')).toBeTruthy();
    fireEvent.click(key('Scan for rings'));
    await tick();
    await waitFor(() => expect(f.plugin.scanRings).toHaveBeenCalledTimes(1));
    const radios = await screen.findAllByRole('radio', { name: /Ring (7C41|91F0)/ });
    expect(radios.map((r) => r.getAttribute('id'))).toHaveLength(2);
    // the strongest first, and the commit stays off until one is picked
    expect(radios[0]!.closest('label')!.textContent).toContain('Ring 7C41');
    expect(screen.getByText('Strong signal')).toBeTruthy();
    expect(key('Connect').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(radios[1]!);
    fireEvent.click(key('Connect'));
    await tick();
    expect(f.plugin.connectRing).toHaveBeenCalledWith({ address: 'AA:BB:CC:DD:EE:02' });
  });

  it('keeps infrequent ring actions in a menu and forgets only after confirmation', async () => {
    const f = await mount(<DeviceView />);
    const ring = screen.getByRole('heading', { name: 'Ring' }).closest('section')!;
    fireEvent.click(within(ring).getByRole('button', { name: 'Ring actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Forget ring' }));
    expect(f.plugin.forgetRing).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(f.plugin.forgetRing).not.toHaveBeenCalled();
    fireEvent.click(within(ring).getByRole('button', { name: 'Ring actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Forget ring' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Forget ring' }),
    );
    await tick();
    expect(f.plugin.forgetRing).toHaveBeenCalledTimes(1);
  });

  it('upload: the last error shows, and a phone not connected to a server says so', async () => {
    await mount(
      <DeviceView />,
      baseState({ upload: { paired: true, pending: 120, lastError: 'Server refused the token' } }),
    );
    expect(screen.getByText('Server refused the token')).toBeTruthy();
    expect(screen.getByText('120')).toBeTruthy();
    resetGaugeEngineStoreForTests();
    document.body.innerHTML = '';
    await mount(<DeviceView />, baseState({ upload: { paired: false, pending: 0 } }));
    expect(screen.getByText('This phone is not connected to your server yet.')).toBeTruthy();
  });

  it('permission fixes work from the screen (its own card does step 3, so the move card stays out)', async () => {
    const f = await mount(
      <DeviceView />,
      baseState({ permissions: { ...baseState().permissions, notifications: 'denied' } }),
    );
    expect(screen.queryByRole('heading', { name: 'Finish setting up the ring' })).toBeNull();
    const perms = screen.getByRole('heading', { name: 'Permissions' }).closest('section')!;
    expect(within(perms).getByText('Not allowed')).toBeTruthy();
    fireEvent.click(within(perms).getByRole('button', { name: 'Allow: Notifications' }));
    await tick();
    expect(f.plugin.requestPermissions).toHaveBeenCalledWith({ which: ['notifications'] });
  });
});

describe('Short-video limit', () => {
  it("shows the limit and today's counts", async () => {
    await mount(<EngineLimitCard />);
    expect(screen.getByText('30 videos a day')).toBeTruthy();
    const card = screen.getByRole('heading', { name: 'Daily limit' }).closest('section')!;
    expect(within(card).getByText('11')).toBeTruthy();
    expect(within(card).getByText('7')).toBeTruthy();
    expect(within(card).getByText('4')).toBeTruthy();
  });

  it('sets N videos a day, or off', async () => {
    const f = await mount(<EngineLimitCard />);
    fireEvent.click(key('Change'));
    const sheet = await screen.findByRole('dialog', { name: 'Short-video limit' });
    expect(within(sheet).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await tick();
    expect(f.plugin.setShortVideoLimit).toHaveBeenLastCalledWith({ dailyLimit: 30 });
    fireEvent.click(key('Change'));
    fireEvent.click(await screen.findByRole('switch', { name: 'Limit short videos' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Short-video limit' })).getByRole('button', {
        name: 'Save',
      }),
    );
    await tick();
    expect(f.plugin.setShortVideoLimit).toHaveBeenLastCalledWith({ dailyLimit: null });
  });

  it('off reads "Off"; the quiet mode keeps the counts out', async () => {
    await mount(
      <EngineLimitCard />,
      baseState({ shortVideo: { enabled: false, dailyLimit: null, today: { instagram: 2, youtube: 0 } } }),
    );
    expect(screen.getByText('Off')).toBeTruthy();
  });

  it('says when the limit is on but the accessibility permission is missing', async () => {
    await mount(
      <EngineLimitCard />,
      baseState({ permissions: { ...baseState().permissions, shortVideoAccessibility: false } }),
    );
    expect(screen.getByText(/needs the accessibility permission/)).toBeTruthy();
  });
});
