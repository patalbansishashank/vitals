import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RingServiceProvider, type RingPlatform } from '../data';
import { createFakeRingService, scenarioPlatform, RING_SCENARIOS, type RingScenario } from '../fixtures';
import { RingKey } from '../RingKey';

const NOW = new Date(2026, 9, 4, 13, 41).getTime();

function renderKey(s: RingScenario, opts: { path?: string; platform?: Partial<RingPlatform> } = {}) {
  const fake = createFakeRingService(s, { now: NOW });
  return render(
    <MemoryRouter initialEntries={[opts.path ?? '/today']}>
      <RingServiceProvider service={fake} platform={{ ...scenarioPlatform(s), ...opts.platform }}>
        <RingKey />
      </RingServiceProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

/** Accessible name and light per scenario (§4.2). */
const EXPECTED: Record<RingScenario, [name: string, light: string | null]> = {
  unsupported: ['Ring', null],
  none: ['Ring', null],
  bluetooth_off: ['Ring: needs attention', 'attention'],
  permission_needed: ['Ring: needs attention', 'attention'],
  idle: ['Ring: not connected', 'off'],
  searching: ['Ring: not connected', 'off'],
  connecting: ['Ring: not connected', 'off'],
  connected: ['Ring: connected', 'connected'],
  syncing: ['Ring: reading', 'reading'],
  elsewhere: ['Ring: connected to Pixel phone', 'elsewhere'],
  stale: ['Ring: needs attention', 'attention'],
  error: ['Ring: needs attention', 'attention'],
  low_battery: ['Ring: connected', 'connected'],
  sync_failed: ['Ring: connected', 'connected'],
  two_rings: ['Ring: needs attention', 'attention'], // the second ring was last read 26 h ago
};

describe('RingKey (§4.2)', () => {
  it.each(RING_SCENARIOS.map((s) => [s] as const))('%s: name and light', (s) => {
    const { container } = renderKey(s);
    const [name, light] = EXPECTED[s];
    const key = screen.getByRole('link', { name });
    expect(key.getAttribute('href')).toBe('/ring');
    expect(key.getAttribute('aria-current')).toBeNull();
    expect(key.getAttribute('data-pressed')).toBeNull();
    const mark = container.querySelector('.rg-light');
    if (light === null) expect(mark).toBeNull();
    else expect(mark?.getAttribute('data-light')).toBe(light);
    // the glyph is drawn inline: an outline ring, currentColor
    expect(key.querySelector('svg circle')).not.toBeNull();
  });

  it('the attention light is the caution triangle, not a dot', () => {
    const { container } = renderKey('error');
    const mark = container.querySelector('.rg-light');
    expect(mark?.tagName.toLowerCase()).toBe('svg');
    expect(mark?.querySelector('path')).not.toBeNull();
  });

  it('looks pressed on /ring', () => {
    renderKey('connected', { path: '/ring' });
    const key = screen.getByRole('link', { name: 'Ring: connected' });
    expect(key.getAttribute('aria-current')).toBe('page');
    expect(key.getAttribute('data-pressed')).toBe('true');
  });

  it('D3: hidden on a browser with no ring and no Web Bluetooth', () => {
    const { container } = renderKey('none', { platform: { platform: 'web', ble: null, installedApp: false, here: 'this browser' } });
    expect(container.querySelector('a')).toBeNull();
  });

  it('D3: shown with Web Bluetooth even with no ring, and in the apps', () => {
    const web = renderKey('none', { platform: { platform: 'web', ble: 'web-bluetooth', installedApp: false, here: 'this browser' } });
    expect(screen.getByRole('link', { name: 'Ring' })).toBeTruthy();
    web.unmount();
    renderKey('none', { platform: { platform: 'electron', ble: 'electron', installedApp: true, here: 'this computer' } });
    expect(screen.getByRole('link', { name: 'Ring' })).toBeTruthy();
  });

  it('a known ring keeps the key on a browser that cannot reach it', () => {
    renderKey('unsupported');
    expect(screen.getByRole('link', { name: 'Ring' })).toBeTruthy();
  });
});
