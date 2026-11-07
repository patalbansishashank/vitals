/** Settings › Widgets: what is on the home screen, a key to ask the launcher for each widget, and the weight opt-in (off by default). */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('@/features/lib/sendCommand', () => ({ sendCommand: send }));

import { resetWidgetsForTests } from '@/platform/widgets';
import { useSettingsStore } from '@/state/settingsStore';
import { withSystemWrite } from '@/state/scope';
import { WidgetsSettings } from '../WidgetsSettings';
import { WIDGET_CARDS } from '../cards';

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));

function shell(status: Record<string, unknown>, pin?: ReturnType<typeof vi.fn>) {
  const plugin = { publish: vi.fn(), status: vi.fn(async () => status), pin: pin ?? vi.fn(async () => ({ supported: true, requested: true })), clear: vi.fn(), takeOpen: vi.fn(), addListener: vi.fn() };
  (globalThis as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'android', isNativePlatform: () => true, registerPlugin: vi.fn(() => plugin) };
  return plugin;
}

const row = (name: string) => screen.getByText(name, { selector: '.settings-widget, .settings-control__label' }).closest('.settings-control') as HTMLElement;

beforeEach(() => {
  send.mockClear();
  withSystemWrite(() => useSettingsStore.setState({ widgetWeight: undefined } as never), 'test');
});

afterEach(() => {
  cleanup();
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
  resetWidgetsForTests();
});

describe('Settings › Widgets', () => {
  it('lists every widget of the registry with where it stands', async () => {
    shell({ placed: 3, byCard: { today: 1, energy: 2, sleep: 0, steps: 0, ring: 0, weight: 0, actions: 0, log: 0 }, contract: 2, pin: true });
    render(<WidgetsSettings />);
    await settle();
    expect(WIDGET_CARDS.length).toBe(8);
    expect(within(row('Today')).getByText('On your home screen')).toBeTruthy();
    expect(within(row('Energy')).getByText('2 on your home screen')).toBeTruthy();
    expect(within(row('Sleep')).getByText('Not on your home screen')).toBeTruthy();
    // weight is off until it is turned on below
    expect(within(row('Weight')).getByText('Off until you turn on weight below')).toBeTruthy();
  });

  it('asks the launcher to place a widget, and says what to confirm', async () => {
    const pin = vi.fn(async () => ({ supported: true, requested: true }));
    shell({ placed: 0, byCard: {}, contract: 2, pin: true }, pin);
    render(<WidgetsSettings />);
    await settle();
    fireEvent.click(within(row('Energy')).getByRole('button', { name: 'Add Energy to your home screen' }));
    await settle();
    expect(pin).toHaveBeenCalledWith({ card: 'energy' });
    expect(within(row('Energy')).getByText('Confirm on your home screen')).toBeTruthy();
  });

  it('what a key did is said until the shell’s count of that widget moves; then the row says how many are placed', async () => {
    const plugin = shell({ placed: 0, byCard: { energy: 0 }, contract: 2, pin: true });
    render(<WidgetsSettings />);
    await settle();
    fireEvent.click(within(row('Energy')).getByRole('button', { name: 'Add Energy to your home screen' }));
    await settle();
    expect(within(row('Energy')).getByText('Confirm on your home screen')).toBeTruthy();
    // the widget is placed from the launcher; the app comes to the front and asks again
    plugin.status.mockResolvedValue({ placed: 1, byCard: { energy: 1 }, contract: 2, pin: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();
    expect(within(row('Energy')).getByText('On your home screen')).toBeTruthy();
  });

  it('where the launcher cannot be asked, it says where to find the widget in words', async () => {
    shell({ placed: 0, byCard: {}, contract: 2, pin: false }, vi.fn(async () => ({ supported: false, requested: false })));
    render(<WidgetsSettings />);
    await settle();
    fireEvent.click(within(row('Sleep')).getByRole('button', { name: 'Add Sleep to your home screen' }));
    await settle();
    expect(within(row('Sleep')).getByText('Touch and hold the home screen, choose Widgets, then Vitals · Sleep.')).toBeTruthy();
  });

  it('weight on the home screen is off by default, and the switch sends the device setting', async () => {
    shell({ placed: 0, byCard: {}, contract: 2, pin: true });
    render(<WidgetsSettings />);
    await settle();
    const r = row('Show weight on the home screen');
    expect(within(r).getByText('Off · your weight stays in the app')).toBeTruthy();
    const sw = within(r).getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(send).toHaveBeenCalledWith('settings.update', { patch: { widgetWeight: true } });
  });

  it('with the setting on, the row says so, and the Weight widget no longer reads as off', async () => {
    withSystemWrite(() => useSettingsStore.setState({ widgetWeight: true } as never), 'test');
    shell({ placed: 0, byCard: {}, contract: 2, pin: true });
    render(<WidgetsSettings />);
    await settle();
    expect(within(row('Weight')).getByText('Not on your home screen')).toBeTruthy();
    const r = row('Show weight on the home screen');
    expect(within(r).getByText('On · quiet mode shows a word, never the number')).toBeTruthy();
    expect(within(r).getByRole('switch').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(r).getByRole('switch'));
    expect(send).toHaveBeenCalledWith('settings.update', { patch: { widgetWeight: false } });
  });
});
