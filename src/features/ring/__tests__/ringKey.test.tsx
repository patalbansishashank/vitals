import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  unsupported: ['Body signals', null],
  none: ['Body signals', null],
  bluetooth_off: ['Body signals · ring needs attention', 'attention'],
  permission_needed: ['Body signals · ring needs attention', 'attention'],
  idle: ['Body signals · ring not connected', 'off'],
  searching: ['Body signals · ring not connected', 'off'],
  connecting: ['Body signals · ring not connected', 'off'],
  connected: ['Body signals · ring connected', 'connected'],
  syncing: ['Body signals · reading your ring', 'reading'],
  elsewhere: ['Body signals · ring connected to Pixel phone', 'elsewhere'],
  stale: ['Body signals · ring needs attention', 'attention'],
  error: ['Body signals · ring needs attention', 'attention'],
  low_battery: ['Body signals · ring connected', 'connected'],
  sync_failed: ['Body signals · ring connected', 'connected'],
  two_rings: ['Body signals · ring needs attention', 'attention'], // the second ring was last read 26 h ago
};

describe('RingKey (§4.2)', () => {
  it.each(RING_SCENARIOS.map((s) => [s] as const))('%s: name and light', (s) => {
    const { container } = renderKey(s);
    const [name, light] = EXPECTED[s];
    const key = screen.getByRole('link', { name });
    expect(key.getAttribute('href')).toBe('/signals');
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

  it('J6-04: a standard icon key, so the shared 44 px touch extension applies (the painted cap stays 40 px like its neighbours)', () => {
    renderKey('connected');
    const key = screen.getByRole('link', { name: 'Body signals · ring connected' });
    expect(key.classList.contains('lm-key')).toBe(true);
    expect(key.getAttribute('data-icon-only')).toBe('true');
    expect(key.getAttribute('data-size')).toBe('md');
    const root = resolve(__dirname, '../../..');
    // .lm-key::after is the coarse-pointer 44 px hit area; the ring styles must not take it away or shrink it
    expect(readFileSync(resolve(root, 'styles/components.css'), 'utf8')).toMatch(/\.lm-key::after[\s\S]*?width: max\(100%, 44px\);[\s\S]*?height: max\(100%, 44px\)/);
    expect(readFileSync(resolve(root, 'features/ring/ring-page.css'), 'utf8')).not.toMatch(/rg-key[^{]*::after/);
  });

  it('looks pressed on Body signals', () => {
    renderKey('connected', { path: '/signals' });
    const key = screen.getByRole('link', { name: 'Body signals · ring connected' });
    expect(key.getAttribute('aria-current')).toBe('page');
    expect(key.getAttribute('data-pressed')).toBe('true');
  });

  it('D3: hidden on a browser with no ring and no Web Bluetooth', () => {
    const { container } = renderKey('none', { platform: { platform: 'web', ble: null, installedApp: false, here: 'this browser' } });
    expect(container.querySelector('a')).toBeNull();
  });

  it('D3: shown with Web Bluetooth even with no ring, and in the apps', () => {
    const web = renderKey('none', { platform: { platform: 'web', ble: 'web-bluetooth', installedApp: false, here: 'this browser' } });
    expect(screen.getByRole('link', { name: 'Body signals' })).toBeTruthy();
    web.unmount();
    renderKey('none', { platform: { platform: 'electron', ble: 'electron', installedApp: true, here: 'this computer' } });
    expect(screen.getByRole('link', { name: 'Body signals' })).toBeTruthy();
  });

  it('a known ring keeps the key on a browser that cannot reach it', () => {
    renderKey('unsupported');
    expect(screen.getByRole('link', { name: 'Body signals' })).toBeTruthy();
  });
});
