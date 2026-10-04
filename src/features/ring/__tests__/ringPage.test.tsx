import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RingServiceProvider, type RingPlatform, type RingService } from '../data';
import { createFakeRingService, createFakeSharing, scenarioPlatform, RING_SCENARIOS, type RingScenario } from '../fixtures';
import RingPage, { byLastRead, canCheck } from '../RingPage';

// The sections belong to other files; here they are markers that show what the page passes them.
vi.mock('../CheckNow', async () => {
  const { createElement } = await import('react');
  return { CheckNow: ({ ring }: { ring: { ringKey: string } }) => createElement('section', { 'data-testid': 'check-now', 'data-ring': ring.ringKey }) };
});
vi.mock('../TodayReadings', async () => {
  const { createElement } = await import('react');
  return { TodayReadings: ({ ring }: { ring: { ringKey: string } | null }) => createElement('section', { 'data-testid': 'today', 'data-ring': ring?.ringKey ?? 'none' }) };
});
vi.mock('../Sharing', async () => {
  const { createElement } = await import('react');
  return { Sharing: () => createElement('section', { 'data-testid': 'sharing' }) };
});
vi.mock('../RingSettings', async () => {
  const { createElement } = await import('react');
  return {
    RingSettings: ({ ring, onAddRing }: { ring: { ringKey: string }; onAddRing: () => void }) =>
      createElement('section', { 'data-testid': 'settings', 'data-ring': ring.ringKey }, createElement('button', { type: 'button', onClick: onAddRing }, 'Add another ring')),
  };
});

const NOW = new Date(2026, 9, 4, 13, 41).getTime();
const KEY = 'ble:jstyle2301|j-style:2301#c3d94f2a';
const KEY2 = 'ble:jstyle2301|j-style:2301#5e0a91c0';
const FORBIDDEN = [/password/i, /passcode/i, /\bPIN\b/, /mqtt/i, /\blease\b/i, /gatt/i, /credential/i, /advanced/i];
const UNSUPPORTED: Partial<RingPlatform> = scenarioPlatform('unsupported');

function renderPage(service: RingService, platform: Partial<RingPlatform>) {
  return render(
    <MemoryRouter initialEntries={['/ring']}>
      <RingServiceProvider service={service} platform={platform} sharing={createFakeSharing()}>
        <RingPage />
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

describe('Ring page (§5.1, §5.8)', () => {
  it.each(RING_SCENARIOS.map((s) => [s] as const))('%s: renders, in order, with no forbidden words', (s) => {
    renderScenario(s);
    expect(screen.getByRole('heading', { level: 1, name: 'Ring' })).toBeTruthy();
    const page = q('.rg-page')!;
    if (s === 'none') {
      expect(page.getAttribute('data-layout')).toBe('pairing');
      expect(testIds(page)).toEqual(['rg-span']);
      expect(q('.rg-span .rg-pair')).not.toBeNull();
      expect(screen.queryByTestId('today')).toBeNull();
      expect(screen.queryByTestId('sharing')).toBeNull();
      expect(screen.queryByTestId('settings')).toBeNull();
    } else {
      expect(page.getAttribute('data-layout')).toBe('split');
      const main = q('.rg-page > .rg-main');
      const side = q('.rg-page > .rg-side');
      const live = s === 'connected' || s === 'syncing' || s === 'low_battery' || s === 'sync_failed' || s === 'two_rings';
      const cards = s === 'two_rings' ? ['rg-card', 'rg-card'] : ['rg-card'];
      expect(testIds(main)).toEqual([...cards, ...(live ? ['check-now'] : []), 'today']);
      expect(testIds(side)).toEqual(s === 'unsupported' ? ['sharing'] : ['sharing', ...cards.map(() => 'rg-settings')]);
      if (s !== 'unsupported') expect(within(side as HTMLElement).getAllByTestId('settings')).toHaveLength(cards.length);
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

  it('Check now and today rows get the connected ring', () => {
    renderScenario('connected');
    expect(screen.getByTestId('check-now').getAttribute('data-ring')).toBe(KEY);
    expect(screen.getByTestId('today').getAttribute('data-ring')).toBe(KEY);
  });

  it('unsupported with no ring: the card explains the apps, today rows still show, no sharing', () => {
    const fake = createFakeRingService('unsupported', { now: NOW });
    fake.setRings([]);
    renderPage(fake, UNSUPPORTED);
    const card = q('.rg-card') as HTMLElement;
    expect(within(card).getByRole('heading', { level: 2 }).textContent).toBe('Your ring');
    expect(card.querySelector('.rg-card__word-now')?.textContent).toBe('can’t connect here');
    expect(within(card).getByRole('link', { name: 'Get the app' })).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Import a file' })).toBeTruthy();
    expect(q('.rg-pair')).toBeNull();
    expect(screen.getByTestId('today').getAttribute('data-ring')).toBe('none');
    expect(q('.rg-side')).toBeNull();
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
    expect(screen.getAllByTestId('settings').map((e) => e.getAttribute('data-ring'))).toEqual([KEY, KEY2]);
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
    expect(screen.getByTestId('today')).toBeTruthy();
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

  it('Add another ring opens the pairing flow in place of the card; Cancel returns', () => {
    renderScenario('connected');
    fireEvent.click(screen.getByRole('button', { name: 'Add another ring' }));
    const main = q('.rg-main') as HTMLElement;
    expect(main.querySelector('.rg-pair')).not.toBeNull();
    expect(main.querySelector('.rg-card')).toBeNull();
    expect(screen.getByTestId('check-now')).toBeTruthy();
    expect(screen.getByTestId('sharing')).toBeTruthy();
    fireEvent.click(within(main).getByRole('button', { name: 'Cancel' }));
    expect(main.querySelector('.rg-pair')).toBeNull();
    expect(main.querySelector('.rg-card')).not.toBeNull();
  });

  it('error: Forget… scrolls to the ring settings', () => {
    const scroll = vi.fn();
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      renderScenario('error');
      fireEvent.click(screen.getByRole('button', { name: 'Forget…' }));
      expect(scroll).toHaveBeenCalledTimes(1);
      expect((scroll.mock.contexts[0] as Element).classList.contains('rg-settings')).toBe(true);
    } finally {
      Element.prototype.scrollIntoView = orig;
    }
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
