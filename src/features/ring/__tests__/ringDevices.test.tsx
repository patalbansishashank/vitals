import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RingServiceProvider, type RingPlatform, type RingService } from '../data';
import { createFakeRingService, createFakeSharing, scenarioPlatform, RING_SCENARIOS, type RingScenario } from '../fixtures';
import { byLastRead, canCheck, RingDevices } from '../RingDevices';

// Check now belongs to another file; here it is a marker that shows what the area passes it.
vi.mock('../CheckNow', async () => {
  const { createElement } = await import('react');
  return { CheckNow: ({ ring }: { ring: { ringKey: string } }) => createElement('section', { 'data-testid': 'check-now', 'data-ring': ring.ringKey }) };
});

const NOW = new Date(2026, 9, 4, 13, 41).getTime();
const KEY = 'ble:jstyle2301|j-style:2301#c3d94f2a';
const KEY2 = 'ble:jstyle2301|j-style:2301#5e0a91c0';
const FORBIDDEN = [/password/i, /passcode/i, /\bPIN\b/, /mqtt/i, /\blease\b/i, /gatt/i, /credential/i, /advanced/i];
const UNSUPPORTED: Partial<RingPlatform> = scenarioPlatform('unsupported');

function Where() {
  const { pathname, hash } = useLocation();
  return <output data-testid="where">{pathname + hash}</output>;
}

function renderPage(service: RingService, platform: Partial<RingPlatform>) {
  return render(
    <MemoryRouter initialEntries={['/signals']}>
      <RingServiceProvider service={service} platform={platform} sharing={createFakeSharing()}>
        <Routes>
          <Route path="*" element={<><RingDevices /><Where /></>} />
        </Routes>
      </RingServiceProvider>
    </MemoryRouter>,
  );
}
const renderScenario = (s: RingScenario) => {
  const fake = createFakeRingService(s, { now: NOW });
  return { fake, ...renderPage(fake, scenarioPlatform(s)) };
};

const q = (sel: string) => document.querySelector(sel);
const testIds = (el: Element | null) => (el ? Array.from(el.children).map((c) => c.getAttribute('data-testid') ?? c.className.split(' ').find((k) => k.startsWith('rg-')) ?? c.className) : []);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the ring on Body signals', () => {
  it.each(RING_SCENARIOS.map((s) => [s] as const))('%s: cards first, Check now while live, a link to Ring settings, no forbidden words', (s) => {
    renderScenario(s);
    const area = q('.rg-devices')!;
    expect(area.getAttribute('aria-label')).toBe('Your ring');
    // nothing of the old Ring page's lower sections is here: no today rows, no sharing, no per-ring settings
    expect(document.body.textContent).not.toMatch(/Today from your ring|Use my ring data|firmware|Forget this ring/);
    if (s === 'none') {
      expect(q('.rg-devices .rg-pair')).not.toBeNull();
      expect(screen.queryByRole('link', { name: 'Ring settings' })).toBeNull();
    } else {
      const live = s === 'connected' || s === 'syncing' || s === 'low_battery' || s === 'sync_failed' || s === 'two_rings';
      const cards = s === 'two_rings' ? ['rg-card', 'rg-card'] : ['rg-card'];
      expect(testIds(q('.rg-devices__cards'))).toEqual([...cards, ...(live ? ['check-now'] : [])]);
      expect(screen.getByRole('link', { name: 'Ring settings' })).toHaveAttribute('href', '/settings#devices');
    }
    const text = `${document.body.textContent} ${Array.from(document.querySelectorAll('[aria-label]'))
      .map((n) => n.getAttribute('aria-label'))
      .join(' ')}`;
    for (const re of FORBIDDEN) expect(text).not.toMatch(re);
  });

  it('elsewhere: Connect here instead and no Check now', () => {
    renderScenario('elsewhere');
    expect(screen.getByRole('button', { name: 'Connect here instead' })).toBeTruthy();
    expect(screen.queryByTestId('check-now')).toBeNull();
  });

  it('error: Forget… opens Settings › Devices, where Forget lives now', () => {
    renderScenario('error');
    fireEvent.click(screen.getByRole('button', { name: 'Forget…' }));
    expect(screen.getByTestId('where').textContent).toBe('/settings#devices');
  });

  it('Check now gets the connected ring', () => {
    renderScenario('connected');
    expect(screen.getByTestId('check-now').getAttribute('data-ring')).toBe(KEY);
  });

  it('unsupported with no ring: the card explains the apps, no settings link', () => {
    const fake = createFakeRingService('unsupported', { now: NOW });
    fake.setRings([]);
    renderPage(fake, UNSUPPORTED);
    const card = q('.rg-card') as HTMLElement;
    expect(within(card).getByRole('heading', { level: 2 }).textContent).toBe('Your ring');
    expect(card.querySelector('.rg-card__word-now')?.textContent).toBe('can’t connect here');
    expect(within(card).getByRole('link', { name: 'Get the app' })).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Import a file' })).toBeTruthy();
    expect(q('.rg-pair')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Ring settings' })).toBeNull();
  });

  it('several rings: one card each by last read; later cards collapse to their header', () => {
    const fake = createFakeRingService('two_rings', { now: NOW });
    // the second ring read 2 h ago (not stale): it starts collapsed
    fake.setRings(fake.rings().map((r) => (r.ringKey === KEY2 ? { ...r, lastSyncAt: new Date(NOW - 2 * 3_600_000).toISOString() } : r)));
    renderPage(fake, scenarioPlatform('two_rings'));
    const cards = Array.from(document.querySelectorAll('.rg-card')) as HTMLElement[];
    expect(cards.map((c) => within(c).getByRole('heading', { level: 2 }).textContent)).toEqual(['J-Style 2301 · ending 4F2A', 'J-Style 2301 · ending 91C0']);
    expect(within(cards[0]!).queryByRole('button', { name: /^(Show|Hide) / })).toBeNull();
    expect(cards[1]!.querySelector('.rg-card__body')).toBeNull();
    fireEvent.click(within(cards[1]!).getByRole('button', { name: 'Show J-Style 2301 · ending 91C0' }));
    expect(cards[1]!.querySelector('.rg-card__body')).not.toBeNull();
  });

  it('a collapsed ring that is read most recently moves to the front and shows its body', () => {
    const fake = createFakeRingService('two_rings', { now: NOW });
    fake.setRings(fake.rings().map((r) => (r.ringKey === KEY2 ? { ...r, lastSyncAt: new Date(NOW - 2 * 3_600_000).toISOString() } : r)));
    renderPage(fake, scenarioPlatform('two_rings'));
    let cards = Array.from(document.querySelectorAll('.rg-card')) as HTMLElement[];
    expect(cards[1]!.querySelector('.rg-card__body')).toBeNull();
    // the second ring is read now: it is the newest, so it comes first and is not collapsible any more
    act(() => fake.setRings(fake.rings().map((r) => (r.ringKey === KEY2 ? { ...r, state: 'connected' as const, lastSyncAt: new Date(NOW).toISOString() } : { ...r, lastSyncAt: new Date(NOW - 60_000).toISOString() }))));
    cards = Array.from(document.querySelectorAll('.rg-card')) as HTMLElement[];
    expect(cards.map((c) => within(c).getByRole('heading', { level: 2 }).textContent)).toEqual(['J-Style 2301 · ending 91C0', 'J-Style 2301 · ending 4F2A']);
    expect(cards[0]!.querySelector('.rg-card__body')).not.toBeNull();
    expect(cards[0]!.hasAttribute('data-collapsed')).toBe(false);
    expect(within(cards[0]!).queryByRole('button', { name: /^(Show|Hide) / })).toBeNull();
  });

  it('Check now needs a spot measurement: a driver that lists none hides it, no list means heart rate only', () => {
    const base = createFakeRingService('connected', { now: NOW }).rings()[0]!;
    expect(canCheck({ ...base, caps: undefined })).toBe(true);
    expect(canCheck({ ...base, caps: {} })).toBe(true);
    expect(canCheck({ ...base, caps: { checks: ['hr'] } })).toBe(true);
    expect(canCheck({ ...base, caps: { checks: [] } })).toBe(false);
    const fake = createFakeRingService('connected', { now: NOW });
    fake.setRings(fake.rings().map((r) => ({ ...r, caps: { checks: [] } })));
    renderPage(fake, scenarioPlatform('connected'));
    expect(screen.queryByTestId('check-now')).toBeNull();
  });

  it('a later ring that needs attention starts open', () => {
    renderScenario('two_rings');
    const cards = Array.from(document.querySelectorAll('.rg-card')) as HTMLElement[];
    expect(cards[1]!.querySelector('.rg-card__body')).not.toBeNull();
    expect(cards[1]!.getAttribute('data-stale')).toBe('true');
  });

  it('orders rings by last read, newest first, a never-read ring last', () => {
    const r = (k: string, at?: number) => ({ ringKey: k, label: 'J-Style 2301', state: 'idle' as const, lastSyncAt: at === undefined ? undefined : new Date(at).toISOString() });
    expect(byLastRead([r('a', 1), r('b'), r('c', 3)]).map((x) => x.ringKey)).toEqual(['c', 'a', 'b']);
  });

  describe('while the first Bluetooth check runs (J6-13)', () => {
    const WEB_BT: Partial<RingPlatform> = { platform: 'web', ble: 'web-bluetooth', installedApp: false, keepAlive: false, here: 'this browser' };
    /** The real service's shape: 'unsupported' until the check answers. */
    function checking() {
      const fake = createFakeRingService('none', { now: NOW });
      let known = false;
      let avail: ReturnType<NonNullable<RingService['availability']>> = 'unsupported';
      const svc: RingService = { ...fake, availability: () => avail, availabilityKnown: () => known };
      const answer = (a: typeof avail) => {
        avail = a;
        known = true;
        fake.setRings([]); // the service publishes after its check
      };
      return { svc, answer };
    }
    const cantReach = () => document.body.textContent?.match(/can’t (connect here|reach)/);

    it('pending: nothing yet, no "can’t connect here" and no pairing flow', () => {
      const { svc } = checking();
      renderPage(svc, WEB_BT);
      expect(cantReach()).toBeNull();
      expect(q('.rg-devices')).toBeNull();
      expect(q('.rg-card')).toBeNull();
      expect(q('.rg-pair')).toBeNull();
    });

    it('the check says no: the can’t-connect card', () => {
      const { svc, answer } = checking();
      renderPage(svc, WEB_BT);
      act(() => answer('unsupported'));
      expect(q('.rg-card__word-now')?.textContent).toBe('can’t connect here');
      expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('the check says yes: Connect your ring', () => {
      const { svc, answer } = checking();
      renderPage(svc, WEB_BT);
      act(() => answer('ready'));
      expect(cantReach()).toBeNull();
      expect(q('.rg-pair')).not.toBeNull();
      expect(screen.getByRole('heading', { name: 'Connect your ring' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Look for rings' })).toBeTruthy();
    });

    it('a browser with no Bluetooth at all: the can’t-connect card at once', () => {
      const { svc } = checking();
      renderPage(svc, UNSUPPORTED);
      expect(q('.rg-card__word-now')?.textContent).toBe('can’t connect here');
      expect(screen.queryByRole('progressbar')).toBeNull();
    });
  });

  it('a ring that appears (another device paired it) replaces the pairing flow', () => {
    const fake = createFakeRingService('none', { now: NOW });
    renderPage(fake, scenarioPlatform('none'));
    expect(q('.rg-pair')).not.toBeNull();
    act(() => fake.setRings(createFakeRingService('idle', { now: NOW }).rings()));
    expect(q('.rg-pair')).toBeNull();
    expect(q('.rg-card')).not.toBeNull();
  });
});
