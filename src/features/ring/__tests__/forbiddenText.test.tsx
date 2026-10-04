/**
 * Forbidden text scan over both new pages in every state (design/screens/ring-pages.md §8; decision 13): nothing a
 * person can read or hear may name a password, passcode, credential, PIN, key (as a ring field), "advanced", the
 * transport words (MQTT, lease, GATT, central, bond, handshake), a raw Bluetooth id or address, or the ring's retail
 * brand (its needle is built from char codes, so this file never holds the word). Each state renders the page through
 * its providers, lets the data land, then reads the DOM text plus every label, title, placeholder and alt.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LivingClockContext } from '@/features/living/clock';
import { SignalsSourceProvider, type SignalsSource } from '@/features/signals/data';
import { createFixtureSignalsSource, fixtureClock, FIXTURE_NOW_LOCAL, FIXTURE_TODAY, type SignalsScenario } from '@/features/signals/fixtures';
import { PERIOD_KINDS, SIGNALS_TABS, type PeriodKind, type SignalsTab } from '@/features/signals/models';
import SignalsPage from '@/features/signals/SignalsPage';
import { RingServiceProvider } from '../data';
import { createFakeRingService, createFakeSharing, RING_SCENARIOS, scenarioPlatform, type RingScenario } from '../fixtures';
import RingPage from '../RingPage';

const NEEDLE = String.fromCharCode(71, 97, 98, 105, 116).toLowerCase();
const UNITS = new RegExp(`(me|gi)${NEEDLE}`, 'g');

const hit = (s: string) => s.toLowerCase().replace(UNITS, '').includes(NEEDLE);

/** Words no screen may use (case-insensitive; word starts, so "release" is not "lease"). */
const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ['password', /\bpassword/i],
  ['passcode', /\bpasscode/i],
  ['credential', /\bcredential/i],
  ['PIN', /\bpin\b/i],
  ['firmware password', /\bfirmware password/i],
  ['MQTT', /\bmqtt\b/i],
  ['lease', /\blease\b/i],
  ['GATT', /\bgatt\b/i],
  ['central', /\bcentral\b/i],
  ['bond', /\bbond(ed|ing)?\b/i],
  ['handshake', /\bhandshake/i],
  ['advanced', /\badvanced\b/i],
  ['ring key', /\bring key\b/i],
  ['raw id or address', /\b(ble|BLE):|[0-9A-F]{2}(:[0-9A-F]{2}){5}/],
];

const ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'aria-valuetext', 'aria-description', 'aria-roledescription'];

/** Everything a person can read or hear: the text plus the accessible attributes. */
function readable(): string {
  const parts = [document.body.textContent ?? ''];
  for (const el of Array.from(document.body.querySelectorAll('*'))) for (const a of ATTRS) if (el.hasAttribute(a)) parts.push(el.getAttribute(a) ?? '');
  return parts.join('\n');
}

const safe = (s: string) => (hit(s) ? '[withheld]' : s);

/** The rules the text breaks, with a little context (never the brand). */
function problems(text: string): string[] {
  const out: string[] = [];
  if (hit(text)) out.push('ring retail brand');
  for (const [name, re] of FORBIDDEN) {
    const m = re.exec(text);
    if (m) out.push(`${name}: "${safe(text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, ' '))}"`);
  }
  return out;
}

const sources: Record<'full' | 'noAge' | 'empty' | 'vendor', SignalsSource> = {
  full: createFixtureSignalsSource('full'),
  noAge: createFixtureSignalsSource('noAge'),
  empty: createFixtureSignalsSource('empty'),
  vendor: createFixtureSignalsSource('vendor'),
};

const NOW = new Date(`${FIXTURE_TODAY}T${FIXTURE_NOW_LOCAL}:00`).getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Lets series, baselines and effects land: no "reading…" left, or three seconds. */
async function settle() {
  await act(async () => {});
  await waitFor(() => expect(document.body.textContent ?? '').not.toMatch(/reading…/), { timeout: 3000 }).catch(() => undefined);
  await act(async () => {});
}

function renderRing(ring: RingScenario, signals: SignalsSource) {
  const service = createFakeRingService(ring, { now: NOW });
  return render(
    <MemoryRouter initialEntries={['/ring']}>
      <LivingClockContext.Provider value={fixtureClock()}>
        <SignalsSourceProvider source={signals}>
          <RingServiceProvider service={service} platform={scenarioPlatform(ring)} sharing={createFakeSharing('on')}>
            <RingPage />
          </RingServiceProvider>
        </SignalsSourceProvider>
      </LivingClockContext.Provider>
    </MemoryRouter>,
  );
}

function renderSignals(tab: SignalsTab, period: PeriodKind, signals: SignalsSource, date: string = FIXTURE_TODAY, ring: RingScenario = 'connected') {
  const service = createFakeRingService(ring, { now: NOW });
  return render(
    <MemoryRouter initialEntries={[`/signals?tab=${tab}&period=${period}&date=${date}`]}>
      <LivingClockContext.Provider value={fixtureClock()}>
        <SignalsSourceProvider source={signals}>
          <RingServiceProvider service={service} platform={scenarioPlatform(ring)} sharing={createFakeSharing('on')}>
            <SignalsPage />
          </RingServiceProvider>
        </SignalsSourceProvider>
      </LivingClockContext.Provider>
    </MemoryRouter>,
  );
}

describe('the scan itself', () => {
  it('finds each forbidden word and the ring brand, and lets ordinary words through', () => {
    expect(problems('Enter the ring password')).toHaveLength(1);
    expect(problems('Set a PIN. Advanced settings. Passcode. MQTT lease. GATT central bond handshake. ring key. Firmware password')).toHaveLength(12);
    expect(problems('ble:jstyle2301|j-style:2301#c3d94f2a')).toHaveLength(1);
    expect(problems('Device AA:BB:CC:DD:EE:FF')).toHaveLength(1);
    expect(problems(`the ${NEEDLE} ring`)).toEqual(['ring retail brand']);
    expect(problems(`my${NEEDLE.toUpperCase()}`)).toEqual(['ring retail brand']);
    expect(problems('a 1 megabit / 10 Gigabit link')).toEqual([]);
    expect(problems('Released today. Unstable: pinned heart rate. Spinning. Stable: 10:30.')).toEqual([]);
    expect(problems('J-Style 2301 · read 6 min ago · tier C: shown as change from your own normal')).toEqual([]);
  });

  it('never prints the brand in a failure message', () => {
    expect(problems(`passcode of ${NEEDLE}`).join('|')).not.toContain(NEEDLE);
  });
});

describe('Ring page', () => {
  it.each(RING_SCENARIOS.map((s) => [s] as const))('%s: nothing forbidden is shown', async (s) => {
    renderRing(s, sources.full);
    await settle();
    const text = readable();
    expect(text.length).toBeGreaterThan(0);
    expect(problems(text)).toEqual([]);
  });

  it.each([['none'], ['unsupported']] as const)('%s with nothing measured: nothing forbidden is shown', async (s) => {
    renderRing(s, sources.empty);
    await settle();
    expect(problems(readable())).toEqual([]);
  });

  it('the pairing flow, the add-ring flow and the forget dialog say nothing forbidden', async () => {
    renderRing('connected', sources.full);
    await settle();
    for (const name of [/add another ring/i, /forget this ring/i]) {
      const key = screen.queryByRole('button', { name });
      if (!key) continue;
      fireEvent.click(key);
      await settle();
      expect(problems(readable()), String(name)).toEqual([]);
    }
  });
});

describe('Body signals page', () => {
  const combos: Array<[Exclude<SignalsScenario, 'sparse'>, SignalsTab]> = [];
  for (const s of ['full', 'noAge', 'empty', 'vendor'] as const) for (const t of SIGNALS_TABS) combos.push([s, t]);

  it.each(combos)('%s · %s tab: nothing forbidden is shown in day, week, month and year', async (s, tab) => {
    for (const period of PERIOD_KINDS) {
      const { unmount } = renderSignals(tab, period, sources[s]);
      await settle();
      const text = readable();
      expect(text.length, `${tab} ${period}`).toBeGreaterThan(0);
      expect(problems(text), `${s} ${tab} ${period}`).toEqual([]);
      unmount();
    }
  }, 60_000);

  it('states with their own wording: unknown-only night, nap, charging gap, a full past month, last week with little data', async () => {
    const cases: Array<[SignalsTab, PeriodKind, string, SignalsSource]> = [
      ['sleep', 'day', '2026-09-28', sources.full],
      ['sleep', 'day', '2026-10-03', sources.full],
      ['activity', 'day', '2026-10-02', sources.full],
      ['heart', 'day', '2026-10-02', sources.full],
      ['sleep', 'month', '2026-09-15', sources.full],
      ['heart', 'week', '2026-10-01', sources.full],
      ['sleep', 'week', FIXTURE_TODAY, createFixtureSignalsSource('sparse')],
      ['heart', 'week', FIXTURE_TODAY, createFixtureSignalsSource('sparse')],
      ['activity', 'week', '2026-09-24', createFixtureSignalsSource('sparse')],
    ];
    for (const [tab, period, date, src] of cases) {
      const { unmount } = renderSignals(tab, period, src, date, 'idle');
      await settle();
      expect(problems(readable()), `${tab} ${period} ${date}`).toEqual([]);
      unmount();
    }
  }, 60_000);

  it('with the ring in each troubled state the page says nothing forbidden', async () => {
    for (const ring of ['unsupported', 'none', 'bluetooth_off', 'permission_needed', 'elsewhere', 'stale', 'error', 'syncing'] as const) {
      const { unmount } = renderSignals('sleep', 'day', sources.empty, FIXTURE_TODAY, ring);
      await settle();
      expect(problems(readable()), ring).toEqual([]);
      unmount();
    }
  }, 60_000);
});
