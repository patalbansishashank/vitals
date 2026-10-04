import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RingServiceProvider, useRings, type RingPlatform, type RingStatus } from '../data';
import { createFakeRingService, createFakeSharing, scenarioPlatform, type RingScenario } from '../fixtures';
import { ConnectionCard, SEARCH_HINT_MS } from '../ConnectionCard';
import { clockText, dayText, lastReadText, relativeTime, sinceText } from '../relativeTime';

const NOW = new Date(2026, 9, 4, 13, 41).getTime(); // Sun 4 Oct 2026, 13:41 local
const KEY = 'ble:jstyle2301|j-style:2301#c3d94f2a';
const T = ' '; // thin space between a number and its unit
const FORBIDDEN = [/password/i, /passcode/i, /\bPIN\b/, /mqtt/i, /\blease\b/i, /gatt/i, /credential/i, /advanced/i];

function LiveCard({ onForget }: { onForget?: () => void }) {
  const rings = useRings();
  return <ConnectionCard ring={rings[0] ?? null} onForget={onForget} />;
}

function renderCard(s: RingScenario, opts: { platform?: Partial<RingPlatform>; stepMs?: number; patch?: Partial<RingStatus>; onForget?: () => void } = {}) {
  const fake = createFakeRingService(s, { now: NOW, stepMs: opts.stepMs });
  if (opts.patch) fake.setRings(fake.rings().map((r) => ({ ...r, ...opts.patch })));
  const utils = render(
    <MemoryRouter initialEntries={['/ring']}>
      <RingServiceProvider service={fake} platform={{ ...scenarioPlatform(s), ...opts.platform }} sharing={createFakeSharing()}>
        <LiveCard onForget={opts.onForget} />
      </RingServiceProvider>
    </MemoryRouter>,
  );
  const card = utils.container.querySelector('.rg-card') as HTMLElement;
  return { fake, card, ...utils };
}

const word = (card: HTMLElement) => card.querySelector('.rg-card__word-now')?.textContent;
const line = (card: HTMLElement) => card.querySelector('.rg-card__line')?.textContent ?? null;
const keyNames = (card: HTMLElement) => {
  const row = card.querySelector('.rg-card__keys');
  return row ? Array.from(row.querySelectorAll('button, a')).map((k) => k.textContent) : [];
};
const row = (card: HTMLElement, label: string) => {
  const dt = within(card).getByText(label, { selector: 'dt' });
  return dt.nextElementSibling as HTMLElement;
};

function expectClean(el: HTMLElement) {
  const text = `${el.textContent} ${Array.from(el.querySelectorAll('[aria-label]'))
    .map((n) => n.getAttribute('aria-label'))
    .join(' ')}`;
  for (const re of FORBIDDEN) expect(text).not.toMatch(re);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('relative time (last read)', () => {
  const at = (h: number, m: number, dayOffset = 0) => new Date(2026, 9, 4 + dayOffset, h, m).getTime();
  it('says just now, minutes, hours, yesterday and a date', () => {
    expect(relativeTime(NOW - 20_000, NOW)).toBe('just now');
    expect(relativeTime(NOW + 5_000, NOW)).toBe('just now');
    expect(relativeTime(NOW - 6 * 60_000, NOW)).toBe('6 min ago');
    expect(relativeTime(NOW - 59 * 60_000, NOW)).toBe('59 min ago');
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3 h ago');
    expect(relativeTime(at(22, 10, -1), NOW)).toBe('yesterday 22:10');
    expect(relativeTime(at(9, 0, -3), NOW)).toBe('Thu 1 Oct');
    expect(relativeTime(new Date(2025, 9, 1, 9, 0).getTime(), NOW)).toBe('Wed 1 Oct 2025');
    expect(relativeTime(new Date(NOW - 6 * 60_000).toISOString(), NOW)).toBe('6 min ago');
  });
  it('adds the clock time, and the device that read it', () => {
    expect(lastReadText(NOW - 6 * 60_000, NOW)).toBe('6 min ago · 13:35');
    expect(lastReadText(NOW - 6 * 60_000, NOW, 'Pixel phone')).toBe('6 min ago on Pixel phone · 13:35');
    expect(lastReadText(at(22, 10, -1), NOW)).toBe('yesterday 22:10');
    expect(lastReadText(at(9, 5, -3), NOW)).toBe('Thu 1 Oct · 09:05');
    expect(clockText(at(9, 5))).toBe('09:05');
    expect(dayText(at(9, 5, -3), NOW)).toBe('Thu 1 Oct');
  });
  it('a read just before midnight seen just after it keeps its clock', () => {
    const now = new Date(2026, 9, 4, 0, 20).getTime();
    expect(lastReadText(new Date(2026, 9, 3, 23, 50).getTime(), now)).toBe('30 min ago · 23:50');
    expect(lastReadText(new Date(2026, 9, 3, 22, 10).getTime(), now)).toBe('yesterday 22:10');
  });
  it('"since" is the clock today, else the day', () => {
    expect(sinceText(at(9, 12), NOW)).toBe('09:12');
    expect(sinceText(at(22, 10, -1), NOW)).toBe('yesterday 22:10');
    expect(sinceText(at(8, 0, -3), NOW)).toBe('Thu 1 Oct');
  });
});

interface Case {
  s: RingScenario;
  word: string;
  line: string | null;
  keys: string[];
  platform?: Partial<RingPlatform>;
}

const CASES: Case[] = [
  {
    s: 'unsupported',
    word: 'can’t connect here',
    line: 'This browser can’t reach Bluetooth rings. Use the Vitals app for Android or your computer, or Chrome on a computer. Your ring’s data still shows here once another device reads it.',
    keys: ['Get the app', 'Import a file'],
  },
  { s: 'bluetooth_off', word: 'Bluetooth is off', line: 'Turn on Bluetooth to reach your ring.', keys: ['Turn on Bluetooth'] },
  {
    s: 'bluetooth_off',
    platform: { platform: 'electron', ble: 'electron', here: 'this computer' },
    word: 'Bluetooth is off',
    line: 'Turn on Bluetooth in your computer’s settings to reach your ring.',
    keys: [],
  },
  {
    s: 'permission_needed',
    word: 'needs permission',
    line: 'Vitals needs permission to find and connect to nearby devices. It doesn’t use your location.',
    keys: ['Allow'],
  },
  {
    s: 'permission_needed',
    platform: { platform: 'web', ble: 'web-bluetooth', installedApp: false, here: 'this browser' },
    word: 'needs permission',
    line: 'Your browser needs your permission to connect. Choose your ring in the list it shows.',
    keys: ['Allow'],
  },
  { s: 'idle', word: 'not connected', line: null, keys: ['Connect'] },
  { s: 'searching', word: 'looking for your ring…', line: null, keys: ['Stop'] },
  { s: 'connecting', word: 'connecting…', line: null, keys: ['Stop'] },
  { s: 'connected', word: 'connected', line: null, keys: ['Sync now', 'Disconnect'] },
  { s: 'syncing', word: `reading your ring · 34${T}%`, line: null, keys: ['reading…'] },
  {
    s: 'elsewhere',
    word: 'connected to Pixel phone',
    line: 'Your ring talks to one device at a time. It’s connected to Pixel phone since 09:41.',
    keys: ['Connect here instead'],
  },
  { s: 'stale', word: 'not connected', line: null, keys: ['Connect'] },
  { s: 'error', word: 'couldn’t connect', line: 'Your ring may be connected to another app or phone. Close it there, then try again.', keys: ['Try again', 'Forget…'] },
  { s: 'low_battery', word: 'connected', line: null, keys: ['Sync now', 'Disconnect'] },
  { s: 'sync_failed', word: 'connected', line: null, keys: ['Try again', 'Disconnect'] },
  { s: 'two_rings', word: 'connected', line: null, keys: ['Sync now', 'Disconnect'] },
];

describe('connection card: every state (§5.2)', () => {
  it.each(CASES.map((c) => [`${c.s}${c.platform ? ` (${c.platform.ble})` : ''}`, c] as const))('%s', (_name, c) => {
    const { card } = renderCard(c.s, { platform: c.platform, onForget: () => {} });
    const derived: Partial<Record<RingScenario, string>> = { stale: 'idle', low_battery: 'connected', sync_failed: 'connected', two_rings: 'connected' };
    expect(card.getAttribute('data-state')).toBe(derived[c.s] ?? c.s);
    expect(word(card)).toBe(c.word);
    expect(line(card)).toBe(c.line);
    expect(keyNames(card)).toEqual(c.keys);
    expect(within(card).getByRole('heading', { level: 2 }).textContent).toBe('J-Style 2301');
    expectClean(card);
  });

  it('connected: readouts battery, last read and where the link is', () => {
    const { card } = renderCard('connected');
    expect(row(card, 'battery').textContent).toBe(`72${T}%`);
    expect(row(card, 'battery').querySelectorAll('.rg-batt__seg')).toHaveLength(10);
    expect(row(card, 'battery').querySelectorAll('.rg-batt__seg[data-on]')).toHaveLength(7);
    expect(row(card, 'last read').textContent).toBe('6 min ago · 13:35');
    expect(row(card, 'on').textContent).toBe('this phone');
    expect(card.querySelector('.rg-light')?.getAttribute('data-light')).toBe('connected');
    expect(card.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('idle: the last known battery says "when last read"; no "on" row', () => {
    const { card } = renderCard('idle');
    expect(row(card, 'battery').textContent).toBe(`72${T}%· when last read`);
    expect(row(card, 'last read').textContent).toBe('3 h ago · 10:41');
    expect(within(card).queryByText('on', { selector: 'dt' })).toBeNull();
    expect(card.querySelector('.rg-light')?.getAttribute('data-light')).toBe('off');
  });

  it('last read names the device that read it', () => {
    const { card } = renderCard('connected', { patch: { lastSyncBy: 'Pixel phone' } });
    expect(row(card, 'last read').textContent).toBe('6 min ago on Pixel phone · 13:35');
  });

  it('battery: unknown, charging, low (caution mark, never red)', () => {
    let r = renderCard('connected', { patch: { battery: undefined } });
    expect(row(r.card, 'battery').textContent).toBe('battery not read yet');
    r.unmount();
    r = renderCard('connected', { patch: { charging: true } });
    expect(row(r.card, 'battery').textContent).toBe(`72${T}%· charging`);
    r.unmount();
    r = renderCard('low_battery');
    const batt = row(r.card, 'battery');
    expect(batt.textContent).toBe(`12${T}%low · charge it soon`);
    expect(batt.querySelector('.rg-batt')?.getAttribute('data-low')).toBe('true');
    expect(batt.querySelectorAll('.rg-batt__seg[data-on]')).toHaveLength(1);
    expect(batt.querySelector('.rg-caution')).not.toBeNull();
    expect(r.card.querySelector('[data-severity="danger"]')).toBeNull();
  });

  it('syncing: a determinate rule at the top edge and "reading…" in place of Sync now', () => {
    const { card } = renderCard('syncing');
    const bar = within(card).getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('34');
    expect(within(card).getByRole('button', { name: 'reading…' })).toBeDisabled();
    expect(card.querySelector('.rg-light')?.getAttribute('data-light')).toBe('reading');
  });

  it('connecting: an indeterminate rule', () => {
    const { card } = renderCard('connecting');
    const bar = within(card).getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
  });

  it('stale: caution mark and the "not read since" line', () => {
    const { card } = renderCard('stale');
    expect(card.getAttribute('data-stale')).toBe('true');
    expect(within(card).getByRole('img', { name: 'not read for over a day' })).toBeTruthy();
    const warn = card.querySelector('.lm-inline-warn') as HTMLElement;
    expect(warn.getAttribute('data-severity')).toBe('caution');
    expect(warn.textContent).toContain('Not read since Thu 1 Oct. Days after that will be filled in when it next connects.');
    expect(row(card, 'last read').textContent).toBe('Thu 1 Oct · 13:41');
  });

  it('sync failed: the warning line and Try again reads again', async () => {
    const { card, fake } = renderCard('sync_failed');
    expect(card.querySelector('.lm-inline-warn')?.textContent).toContain('Couldn’t read the latest data: the ring stopped answering.');
    expect(card.querySelector('.rg-light')?.getAttribute('data-light')).toBe('connected');
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Try again' })));
    expect(fake.calls).toContain(`syncNow:${KEY}`);
  });

  it('elsewhere: "on" is the holder; Connect here instead goes connecting and waits for the holder', async () => {
    const { card, fake } = renderCard('elsewhere', { stepMs: 60_000 });
    expect(row(card, 'on').textContent).toBe('Pixel phone');
    expect(card.querySelector('.rg-light')?.getAttribute('data-light')).toBe('elsewhere');
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Connect here instead' })));
    expect(fake.calls).toContain(`connectHere:${KEY}`);
    expect(word(card)).toBe('connecting…');
    expect(line(card)).toBe('waiting for Pixel phone to let go…');
    expect(within(card).getByRole('progressbar')).toBeTruthy();
  });

  it('actions call the ring service', async () => {
    const check = async (s: RingScenario, key: string, call: string, opts: Parameters<typeof renderCard>[1] = {}) => {
      const r = renderCard(s, opts);
      await act(async () => fireEvent.click(within(r.card).getByRole('button', { name: key })));
      expect(r.fake.calls).toContain(call);
      r.unmount();
    };
    await check('connected', 'Sync now', `syncNow:${KEY}`);
    await check('connected', 'Disconnect', `disconnect:${KEY}`);
    await check('idle', 'Connect', `connect:${KEY}`);
    await check('stale', 'Connect', `connect:${KEY}`);
    await check('searching', 'Stop', `stop:${KEY}`);
    await check('connecting', 'Stop', `stop:${KEY}`);
    await check('error', 'Try again', `connect:${KEY}`);
    await check('bluetooth_off', 'Turn on Bluetooth', 'requestBluetooth');
    await check('permission_needed', 'Allow', 'requestPermission');
    await check('permission_needed', 'Open app settings', 'openAppSettings', { patch: { permissionDenied: true } });
  });

  it('error: "Forget…" takes the person to ring settings', () => {
    const onForget = vi.fn();
    const { card } = renderCard('error', { onForget });
    fireEvent.click(within(card).getByRole('button', { name: 'Forget…' }));
    expect(onForget).toHaveBeenCalledTimes(1);
    expect(card.querySelector('svg.rg-light')?.getAttribute('data-light')).toBe('attention');
  });

  it('unsupported: Get the app and Import a file are links; the readouts show what another device read', () => {
    const { card } = renderCard('unsupported');
    expect(within(card).getByRole('link', { name: 'Get the app' }).getAttribute('href')).toBe('/settings#install');
    expect(within(card).getByRole('link', { name: 'Import a file' }).getAttribute('href')).toBe('/settings#devices');
    expect(row(card, 'last read').textContent).toBe('2 h ago on Pixel phone · 11:41');
    expect(card.querySelector('.rg-light')).toBeNull();
  });

  it('searching: after 15 s the card says how to wake the ring', () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { card } = renderCard('searching');
    expect(line(card)).toBeNull();
    act(() => vi.advanceTimersByTime(SEARCH_HINT_MS));
    expect(line(card)).toBe('Keep it close. If it doesn’t appear, put it on its charger for a moment to wake it.');
  });

  it('a state change crossfades the state word', async () => {
    const { card, fake } = renderCard('connected');
    act(() => fake.setRings(fake.rings().map((r) => ({ ...r, state: 'syncing' as const, syncProgress: 0.5 }))));
    expect(word(card)).toBe(`reading your ring · 50${T}%`);
    const prev = card.querySelector('.rg-card__word-prev');
    expect(prev?.textContent).toBe('connected');
    expect(prev?.getAttribute('aria-hidden')).toBe('true');
    await waitFor(() => expect(card.querySelector('.rg-card__word-prev')).toBeNull());
  });

  it('several rings with one label: "ending" tells them apart; a later card collapses to its header', () => {
    const fake = createFakeRingService('two_rings', { now: NOW });
    const [, second] = fake.rings();
    render(
      <MemoryRouter>
        <RingServiceProvider service={fake} platform={scenarioPlatform('two_rings')}>
          <ConnectionCard ring={second!} showTail collapsible defaultCollapsed />
        </RingServiceProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('J-Style 2301 · ending 91C0');
    expect(document.querySelector('.rg-card__body')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show J-Style 2301 · ending 91C0' }));
    expect(document.querySelector('.rg-card__body')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Hide J-Style 2301 · ending 91C0' }).getAttribute('aria-expanded')).toBe('true');
  });
});
