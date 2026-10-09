import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { fixedClock, LivingClockContext } from '@/features/living/clock';
import { RingServiceProvider, type RingPlatform, type RingService, type RingStatus } from '../data';
import { createFakeRingService, createFakeSharing, scenarioPlatform, type FakeRingService, type RingScenario } from '../fixtures';
import { KEEP_CONNECTED_KEY, RingSettings, type RingMeasuring } from '../RingSettings';

const NOW = new Date('2026-10-04T13:41:00').getTime();
const clock = fixedClock('2026-10-04T13:41');

function setup(opts: { scenario?: RingScenario; platform?: Partial<RingPlatform>; patch?: Partial<RingStatus>; extend?: (f: FakeRingService) => RingService } = {}) {
  const fake = createFakeRingService(opts.scenario ?? 'connected', { now: NOW });
  const service = opts.extend ? opts.extend(fake) : fake;
  const ring = { ...fake.rings()[0]!, ...opts.patch };
  const view = render(
    <MemoryRouter>
      <LivingClockContext.Provider value={clock}>
        <RingServiceProvider service={service} platform={{ ...scenarioPlatform('connected'), ...opts.platform }} sharing={createFakeSharing()}>
          <RingSettings ring={ring} />
        </RingServiceProvider>
      </LivingClockContext.Provider>
    </MemoryRouter>,
  );
  return { fake, ring, view };
}

const rowLabels = () => [...document.querySelectorAll('li.rs-setting')].map((li) => li.getAttribute('data-row'));
const FORBIDDEN = /password|passcode|credential|\bPIN\b|\bkey\b|advanced|calibrat|MQTT|\blease\b|GATT|handshake|\bbond\b/i;

afterEach(() => {
  localStorage.clear();
});

describe('Ring settings', () => {
  it('the J-Style 2301 on Android: firmware, keep connected, battery; no rows it cannot do, and none the ring card above has', async () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Ring settings' })).toBeTruthy();
    expect(rowLabels()).toEqual(['firmware', 'keep my ring connected', 'battery over time']);
    expect(screen.getByText('V0789')).toBeTruthy();
    expect((screen.getByRole('switch', { name: 'keep my ring connected' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Stays connected in the background. Android shows a small notification while it is.')).toBeTruthy();
    expect(screen.queryByText('how often your ring measures')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vibrate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset the ring…' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Disconnect|Forget|Add another ring/ })).toBeNull();
    await waitFor(() => expect(document.querySelector('.rs-batt__line')).toBeTruthy());
    expect(document.body.textContent ?? '').not.toMatch(FORBIDDEN);
  });

  it('keep my ring connected is remembered on this device', () => {
    setup();
    fireEvent.click(screen.getByRole('switch', { name: 'keep my ring connected' }));
    expect(localStorage.getItem(KEEP_CONNECTED_KEY)).toBe('0');
    expect((screen.getByRole('switch', { name: 'keep my ring connected' }) as HTMLInputElement).checked).toBe(false);
  });

  it('desktop shows the tray line, the website neither app row', () => {
    const { view } = setup({ platform: { platform: 'electron', ble: 'electron', installedApp: true, keepAlive: true, here: 'this computer' } });
    expect(rowLabels()).toContain('keep running in the tray');
    expect(screen.getByText('Vitals stays in the tray when you close the window.')).toBeTruthy();
    expect(rowLabels()).not.toContain('keep my ring connected');
    view.unmount();
    setup({ platform: { platform: 'web', ble: 'web-bluetooth', installedApp: false, keepAlive: false, here: 'this browser' } });
    expect(rowLabels()).not.toContain('keep running in the tray');
    expect(rowLabels()).not.toContain('keep my ring connected');
  });

  it('firmware not read yet; the title names the ring when there are several', () => {
    setup({ scenario: 'two_rings', patch: { firmware: undefined } });
    expect(screen.getByText('read when connected')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ring settings · J-Style 2301 · ending 4F2A' })).toBeTruthy();
  });

  it('rows that need a capability appear with it: how often, find my ring, reset', async () => {
    const sent: RingMeasuring[] = [];
    const { fake } = setup({
      patch: { caps: { checks: ['hr'], intervals: { min: 5, max: 60, step: 5 }, findRing: true, factoryReset: true, measures: ['hr', 'spo2', 'sleep'] } },
      extend: (f) =>
        Object.assign(f, {
          findRing: async (k: string) => void f.calls.push(`findRing:${k}`),
          factoryReset: async (k: string) => void f.calls.push(`factoryReset:${k}`),
          setMeasuring: async (_k: string, m: RingMeasuring) => void sent.push(m),
        }),
    });
    expect(rowLabels()).toEqual(['firmware', 'keep my ring connected', 'how often your ring measures', 'battery over time', 'find my ring', 'reset the ring']);
    // only the measurements the ring supports get a switch
    const measuring = document.querySelector('li[data-row="how often your ring measures"]') as HTMLElement;
    expect(within(measuring).getAllByRole('switch').map((s) => s.getAttribute('aria-label') ?? s.closest('label')!.textContent)).toEqual(['all-day heart rate', 'blood oxygen']);
    fireEvent.click(within(measuring).getByRole('switch', { name: 'blood oxygen' }));
    await waitFor(() => expect(within(measuring).getByText('sent to your ring')).toBeTruthy());
    expect(sent[0]).toMatchObject({ allDayHr: true, intervalMin: 5, spo2: false });
    fireEvent.click(screen.getByRole('button', { name: 'Vibrate' }));
    await waitFor(() => expect(fake.calls).toContain(`findRing:${fake.rings()[0]!.ringKey}`));
    fireEvent.click(screen.getByRole('button', { name: 'Reset the ring…' }));
    expect(screen.getByText('This erases everything stored on the ring itself. Vitals reads it first. You’ll connect it again afterwards.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset ring' }));
    await waitFor(() => expect(fake.calls).toContain(`factoryReset:${fake.rings()[0]!.ringKey}`));
  });

  it('how often is hidden when the service cannot apply it, even with intervals', () => {
    setup({ patch: { caps: { intervals: { min: 5, max: 60, step: 5 } } } });
    expect(rowLabels()).not.toContain('how often your ring measures');
  });

  it('battery over time: "Not enough readings yet." with fewer than two readings or no history at all', async () => {
    const { view } = setup({ extend: (f) => Object.assign(f, { batteryHistory: async () => [{ t: NOW - 3_600_000, v: 80 }] }) });
    expect(await screen.findByText('Not enough readings yet.')).toBeTruthy();
    view.unmount();
    setup({ extend: (f) => ({ ...f, batteryHistory: undefined }) });
    expect(screen.getByText('Not enough readings yet.')).toBeTruthy();
  });

  it('battery over time: the line breaks over gaps, the 15 % hairline is labelled low, the table twin lists days', async () => {
    const h = 3_600_000;
    const pts = [30, 28, 26, 10, 8, 6].map((ago, i) => ({ t: NOW - ago * h, v: 90 - i * 10 }));
    setup({ extend: (f) => Object.assign(f, { batteryHistory: async () => pts }) });
    await waitFor(() => expect(document.querySelectorAll('.rs-batt__line')).toHaveLength(2));
    expect(document.querySelector('[data-low="true"]')).toBeTruthy();
    expect(screen.getByText('low')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Show .* data table$/ }));
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/Breaks in the line are times with no readings/);
  });
});
