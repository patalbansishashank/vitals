import './clock';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { dispatch } from '@/commands/bus';
import { setPlatformForTests } from '@/platform/detect';
import { baseState, fakeEngine } from '../engine/__tests__/fakeEngine';
import { resetGaugeEngineStoreForTests, startGaugeEngine } from '@/state/gaugeEngine';
import { RingStatusCapsule, RingStatusCard } from '../views/RingStatusCard';
import { card, renderAt, ringHooks, setupScreens } from './screenKit';

setupScreens();

describe('Ring status card', () => {
  ringHooks();
  afterEach(() => {
    resetGaugeEngineStoreForTests();
    setPlatformForTests(undefined);
  });

  it('shows current Bluetooth and credential state on Android instead of stale server success', async () => {
    setPlatformForTests('android');
    const ring = { ...baseState().ring, credentialRequired: true, credentialConfigured: false };
    const fake = fakeEngine(baseState({ ring }));
    startGaugeEngine({ plugin: () => fake.plugin, credentials: () => null, onPairing: () => () => undefined, visible: () => true });
    render(<MemoryRouter><RingStatusCapsule /><RingStatusCard /></MemoryRouter>);
    const card = (await screen.findByRole('heading', { level: 2, name: 'Open Ring device' })).closest('section')!;
    expect(await within(card).findByText('Ring data unavailable')).toBeInTheDocument();
    expect(within(card).queryByText('Connected')).toBeNull();
    expect(within(card).getByText('Bluetooth connected · ring data unavailable')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Ring Bluetooth connected, data unavailable' })).toBeInTheDocument();
    act(() => fake.set(baseState({ ring: { ...ring, credentialConfigured: true } })));
    expect(await within(card).findByText('Connected')).toBeInTheDocument();
    act(() => fake.set(baseState({ ring: { ...ring, credentialConfigured: true, credentialAuthenticated: false } })));
    expect(await within(card).findByText('Authenticating ring…')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Ring Bluetooth connected, authenticating before readings are available' })).toBeInTheDocument();
    act(() => fake.set(baseState({ ring: { ...ring, credentialConfigured: true, credentialRejected: true } })));
    expect(await within(card).findByText('Could not read ring')).toBeInTheDocument();
  });

  it('keeps server-reported connection wording on web even if a test supplies an engine state', async () => {
    setPlatformForTests('web');
    const fake = fakeEngine(baseState({ ring: { ...baseState().ring, credentialRequired: true, credentialConfigured: false } }));
    startGaugeEngine({ plugin: () => fake.plugin, credentials: () => null, onPairing: () => () => undefined, visible: () => true });
    render(<MemoryRouter><RingStatusCapsule /><RingStatusCard /></MemoryRouter>);
    const card = (await screen.findByRole('heading', { level: 2, name: 'Open Ring device' })).closest('section')!;
    expect(await within(card).findByText('Connected')).toBeInTheDocument();
    expect(within(card).queryByText('Ring data unavailable')).toBeNull();
  });

  it('uses one battery hero, keeps device facts in information and a foot action', async () => {
    renderAt('/ring');
    await screen.findByRole('heading', { level: 2, name: 'Ring' }, { timeout: 8000 });
    const ring = card('Ring');
    expect(await within(ring).findByRole('img', { name: '64 percent battery' })).toBeInTheDocument();
    expect(ring).toHaveAttribute('data-size', 'card');
    expect(ring.querySelectorAll('.lm-hero')).toHaveLength(1);
    expect(within(ring).queryByText(/^Firmware/)).toBeNull();
    expect(within(ring).queryByText(/^Phone /)).toBeNull();
    expect(ring.querySelector('.lm-cardfoot')).toContainElement(within(ring).getByRole('button', { name: 'Check for updates' }));
    fireEvent.click(within(ring).getByRole('button', { name: 'About Ring' }));
    const info = await screen.findByRole('dialog', { name: 'The ring and phone' });
    expect(within(info).getByText('Firmware')).toBeInTheDocument();
    expect(within(info).getByText('Phone')).toBeInTheDocument();
    expect(within(info).getByRole('region', { name: 'Ring battery table' })).toBeInTheDocument();
  });

  it('keeps battery and version figures out in quiet mode', async () => {
    expect((await dispatch('settings.update', { patch: { quietMode: true } })).ok).toBe(true);
    renderAt('/ring');
    await screen.findByRole('heading', { level: 2, name: 'Ring' }, { timeout: 8000 });
    const ring = card('Ring');
    expect(await within(ring).findByText('Fine')).toBeInTheDocument();
    expect(ring.textContent).not.toMatch(/\d/);
    expect(ring.querySelector('.rg-status__facts')).toBeNull();
  });
});
