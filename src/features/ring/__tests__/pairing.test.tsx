import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components';
import { RingServiceProvider, type RingCandidate, type RingPlatform, type RingService, type RingStatus } from '../data';
import { createFakeRingService, createFakeSharing, scenarioPlatform, type FakeRingService } from '../fixtures';
import { RingPageBody } from '../RingPage';
import { DONE_HOLD_MS, SCAN_MS, SETTLE_MS, pairStage } from '../PairingFlow';
import { signalOf, sortCandidates } from '../ScanList';

// The sections are other files' work; the flow is tested on its own.
vi.mock('../CheckNow', () => ({ CheckNow: () => null }));
vi.mock('../TodayReadings', () => ({ TodayReadings: () => null }));
vi.mock('../Sharing', () => ({ Sharing: () => null }));
vi.mock('../RingSettings', async () => {
  const { createElement } = await import('react');
  return {
    RingSettings: ({ onAddRing }: { onAddRing: (trigger: HTMLButtonElement) => void }) =>
      createElement('button', { type: 'button', onClick: (event: { currentTarget: HTMLButtonElement }) => onAddRing(event.currentTarget) }, 'Add another ring'),
  };
});

const NOW = new Date(2026, 9, 4, 13, 41).getTime();
const FORBIDDEN = [/password/i, /passcode/i, /\bPIN\b/, /mqtt/i, /\blease\b/i, /gatt/i, /credential/i, /advanced/i, /\bkey\b/i];
const ANDROID = scenarioPlatform('none');
const WEB: Partial<RingPlatform> = { platform: 'web', ble: 'web-bluetooth', installedApp: false, keepAlive: false, here: 'this browser' };
const DESKTOP: Partial<RingPlatform> = { platform: 'electron', ble: 'electron', installedApp: true, keepAlive: true, here: 'this computer' };

function renderPage(service: RingService, platform: Partial<RingPlatform> = ANDROID) {
  return render(
    <MemoryRouter initialEntries={['/ring']}>
      <RingServiceProvider service={service} platform={platform} sharing={createFakeSharing()}>
        <RingPageBody />
        <Toaster />
      </RingServiceProvider>
    </MemoryRouter>,
  );
}

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const pair = () => document.querySelector('.rg-pair') as HTMLElement;
const rowNames = () => Array.from(document.querySelectorAll('.rg-scan__row')).map((b) => b.querySelector('.rg-scan__label')?.textContent);
function expectClean() {
  const el = pair() ?? document.body;
  const text = `${el.textContent} ${Array.from(el.querySelectorAll('[aria-label]'))
    .map((n) => n.getAttribute('aria-label'))
    .join(' ')}`;
  for (const re of FORBIDDEN) expect(text).not.toMatch(re);
}

/** A fake whose scan yields `cands` (one per step) and then waits until it is stopped. */
function withScan(fake: FakeRingService, cands: RingCandidate[], stepMs = 0): FakeRingService {
  return {
    ...fake,
    async *scan(signal) {
      fake.calls.push('scan');
      for (const c of cands) {
        if (stepMs) await new Promise((r) => setTimeout(r, stepMs));
        if (signal.aborted) return;
        yield c;
      }
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('pairing flow (§5.5)', () => {
  it.each([ANDROID, DESKTOP])('keeps the chooser alive until the selected ring is paired ($ble)', async (platform) => {
    let signal: AbortSignal | undefined;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const base = createFakeRingService('none', { now: NOW });
    const fake: FakeRingService = {
      ...base,
      async *scan(s) {
        signal = s;
        yield* base.scan(s);
      },
      async pair(id) {
        // Native and desktop transports cancel the pending selection as soon as this scan is aborted.
        if (signal?.aborted) throw new Error('Chooser cancelled before selection');
        await pending;
        return base.pair(id);
      },
    };
    renderPage(fake, platform);
    fireEvent.click(screen.getByRole('button', { name: 'Look for rings' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /ending 4F2A/ }));
    await flush(SCAN_MS);
    expect(signal?.aborted).toBe(false);
    expect(pair().textContent).not.toContain('Couldn’t connect.');
    finish();
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(pair().textContent).toContain('Connected.');
  });

  it('step 1 → scan list → tap → connected, toast, back to the page', async () => {
    const fake = createFakeRingService('none', { now: NOW });
    renderPage(fake);
    // step 1
    expect(document.querySelector('.rg-page')?.getAttribute('data-layout')).toBe('pairing');
    expect(document.querySelector('.rg-span .rg-pair')).not.toBeNull();
    expect(within(pair()).getByRole('heading', { name: 'Connect your ring' })).toBeTruthy();
    expect(pair().textContent).toContain(
      'Put the ring on your finger or its charger and keep it near this phone. If another app is connected to it (for example the ring’s own app), close that app first: a ring talks to one device at a time.',
    );
    expect(pair().textContent).not.toContain('Your browser will show a list of nearby devices.');
    expectClean();
    // step 2
    fireEvent.click(screen.getByRole('button', { name: 'Look for rings' }));
    await flush();
    expect(fake.calls).toContain('scan');
    expect(within(pair()).getByRole('status').textContent).toBe('looking for rings…');
    expect(within(pair()).getByRole('status')).toHaveFocus();
    expect(rowNames()).toEqual(['J-Style 2301 · ending 4F2A', 'J-Style 2301 · ending 91C0']);
    const rows = screen.getAllByRole('button', { name: /J-Style 2301 · ending/ });
    expect(rows[0]!.textContent).toContain('near');
    expect(rows[1]!.textContent).toContain('far');
    expect(rows[0]!.querySelectorAll('.rg-meter__bar[data-on]')).toHaveLength(3);
    expect(rows[1]!.querySelectorAll('.rg-meter__bar[data-on]')).toHaveLength(1);
    expect(pair().textContent).toContain('Not seeing yours? Tap the ring or put it on its charger to wake it.');
    expectClean();
    // step 3
    fireEvent.click(rows[0]!);
    await flush();
    expect(fake.calls).toContain('pair:cand-1');
    expect(pair().textContent).toContain('Connected.');
    expect(within(pair()).getByRole('status')).toHaveFocus();
    expectClean();
    await flush(DONE_HOLD_MS);
    expect(document.querySelector('.rg-pair')).toBeNull();
    expect(document.querySelector('.rg-page')?.getAttribute('data-layout')).toBe('split');
    expect(document.querySelector('.rg-card .rg-card__word-now')?.textContent).toBe('connected');
    expect(within(document.querySelector('.rg-card') as HTMLElement).getByRole('heading', { level: 2 })).toHaveFocus();
    expect(screen.getByText('Your ring is connected')).toBeTruthy();
  });

  it('adding a ring moves focus into the flow and then to the connected card', async () => {
    const fake = createFakeRingService('connected', { now: NOW });
    renderPage(fake);
    const trigger = screen.getByRole('button', { name: 'Add another ring' });
    trigger.focus();
    fireEvent.click(trigger);
    const look = screen.getByRole('button', { name: 'Look for rings' });
    expect(look).toHaveFocus();
    fireEvent.click(look);
    await flush();
    const candidate = screen.getAllByRole('button', { name: /ending 4F2A/ })[0]!;
    candidate.focus();
    fireEvent.click(candidate);
    await flush();
    expect(within(pair()).getByRole('status')).toHaveFocus();
    await flush(DONE_HOLD_MS);
    expect(pair()).toBeNull();
    expect(within(document.querySelector('.rg-card') as HTMLElement).getByRole('heading', { level: 2 })).toHaveFocus();
  });

  it('a failed pair offers Try again and Choose another ring', async () => {
    const fake = createFakeRingService('none', { now: NOW });
    fake.failNextPair(true);
    renderPage(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Look for rings' }));
    await flush();
    fireEvent.click(screen.getAllByRole('button', { name: /ending 91C0/ })[0]!);
    await flush();
    expect(pair().textContent).toContain('Couldn’t connect. Keep the ring close and try again.');
    expect(screen.getByRole('button', { name: 'Choose another ring' })).toBeTruthy();
    expectClean();
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    expect(retry).toHaveFocus();
    fireEvent.click(retry);
    expect(within(pair()).getByRole('status')).toHaveFocus();
    await flush();
    expect(fake.calls.filter((c) => c === 'pair:cand-2')).toHaveLength(2);
    expect(pair().textContent).toContain('Connected.');
  });

  it('a double tap on a ring starts one pair, not two', async () => {
    const fake = createFakeRingService('none', { now: NOW });
    renderPage(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Look for rings' }));
    await flush();
    const row = screen.getAllByRole('button', { name: /ending 4F2A/ })[0]!;
    // both taps land before React has swapped the list for the connecting step
    act(() => {
      fireEvent.click(row);
      fireEvent.click(row);
    });
    await flush();
    expect(fake.calls.filter((c) => c.startsWith('pair:'))).toEqual(['pair:cand-1']);
    expect(pair().textContent).toContain('Connected.');
  });

  it('Try again after a failure still starts a new pair (the guard is released)', async () => {
    const fake = createFakeRingService('none', { now: NOW });
    fake.failNextPair(true);
    renderPage(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Look for rings' }));
    await flush();
    fireEvent.click(screen.getAllByRole('button', { name: /ending 4F2A/ })[0]!);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(fake.calls.filter((c) => c === 'pair:cand-1')).toHaveLength(2);
  });

  it('Choose another ring looks again', async () => {
    const fake = createFakeRingService('none', { now: NOW });
    fake.failNextPair(true);
    renderPage(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Look for rings' }));
    await flush();
    fireEvent.click(screen.getAllByRole('button', { name: /ending 4F2A/ })[0]!);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another ring' }));
    await flush();
    expect(fake.calls.filter((c) => c === 'scan')).toHaveLength(2);
    expect(within(pair()).getByRole('status').textContent).toBe('looking for rings…');
    expect(rowNames()).toHaveLength(2);
  });

  it('stops looking after 30 s; the list stays with Look again', async () => {
    const fake = createFakeRingService('none', { now: NOW });
    renderPage(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Look for rings' }));
    await flush(SCAN_MS - 1);
    expect(within(pair()).getByRole('status').textContent).toBe('looking for rings…');
    await flush(1);
    expect(within(pair()).getByRole('status').textContent).toBe('Stopped looking.');
    expect(rowNames()).toHaveLength(2);
    expect(pair().textContent).not.toContain('No rings found.');
    fireEvent.click(screen.getByRole('button', { name: 'Look again' }));
    await flush();
    expect(within(pair()).getByRole('status').textContent).toBe('looking for rings…');
  });

  it('nothing found after 30 s says so', async () => {
    const fake = withScan(createFakeRingService('none', { now: NOW }), []);
    renderPage(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Look for rings' }));
    await flush(SCAN_MS);
    expect(pair().textContent).toContain('No rings found. Check it’s charged and close to this phone, close any other app using it, then look again.');
    expectClean();
  });

  it('Stop aborts the scan', async () => {
    let aborted = false;
    const base = createFakeRingService('none', { now: NOW });
    const fake: FakeRingService = {
      ...base,
      async *scan(signal) {
        signal.addEventListener('abort', () => (aborted = true));
        yield* base.scan(signal);
      },
    };
    renderPage(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Look for rings' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await flush();
    expect(aborted).toBe(true);
    expect(within(pair()).getByRole('status').textContent).toBe('Stopped looking.');
    expect(pair().textContent).not.toContain('No rings found.');
  });

  it('the list never reorders under the finger: rows append, then sort after 2 s of quiet', async () => {
    const cands: RingCandidate[] = [
      { candidateId: 'a', driverId: 'jstyle2301', label: 'J-Style 2301', rssi: -84, known: false, idTail: 'AAAA' },
      { candidateId: 'b', driverId: 'jstyle2301', label: 'J-Style 2301', rssi: -58, known: false, idTail: 'BBBB' },
      { candidateId: 'c', driverId: 'jstyle2301', label: 'J-Style 2301', rssi: -90, known: true, idTail: 'CCCC' },
    ];
    const fake = withScan(createFakeRingService('none', { now: NOW }), cands, 500);
    renderPage(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Look for rings' }));
    await flush(500);
    await flush(500);
    await flush(500);
    expect(rowNames()).toEqual(['J-Style 2301 · ending AAAA', 'J-Style 2301 · ending BBBB', 'J-Style 2301 · ending CCCC']);
    expect(screen.getByRole('button', { name: /ending CCCC/ }).textContent).toContain('yours');
    await flush(SETTLE_MS - 1);
    expect(rowNames()[0]).toBe('J-Style 2301 · ending AAAA');
    await flush(1);
    expect(rowNames()).toEqual(['J-Style 2301 · ending CCCC', 'J-Style 2301 · ending BBBB', 'J-Style 2301 · ending AAAA']);
  });

  it('Android: the system pairing prompt is announced while connecting', async () => {
    const fake = createFakeRingService('none', { now: NOW, stepMs: 1000 });
    renderPage(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Look for rings' }));
    await flush(1000);
    fireEvent.click(screen.getByRole('button', { name: /ending 4F2A/ }));
    await flush();
    expect(pair().textContent).toContain('Connecting to J-Style 2301…');
    expect(pair().textContent).toContain('Your phone may ask to pair with the ring. That’s expected: tap Pair.');
    expect(within(pair()).getByRole('progressbar')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await flush(1000);
    expect(pair().textContent).toContain('Connected.');
  });

  it('shows setting up and the first read with its progress', async () => {
    const base = createFakeRingService('none', { now: NOW });
    const ring: RingStatus = { ringKey: 'ble:jstyle2301|j-style:2301#00004f2a', label: 'J-Style 2301', state: 'connected' };
    let release: () => void = () => {};
    const fake: FakeRingService = {
      ...base,
      async pair(id) {
        base.calls.push(`pair:${id}`);
        base.setRings([ring]);
        await new Promise<void>((r) => (release = r));
        base.setRings([{ ...ring, state: 'syncing', syncProgress: 0.34 }]);
        await new Promise<void>((r) => (release = r));
        base.setRings([ring]);
        return ring;
      },
    };
    renderPage(fake, DESKTOP);
    // the desktop app shows its own list after Look for rings: no browser chooser line (J1-08)
    expect(pair().textContent).not.toMatch(/browser/i);
    expect(pair().textContent).toContain('keep it near this computer');
    fireEvent.click(screen.getByRole('button', { name: 'Look for rings' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /ending 4F2A/ }));
    await flush();
    expect(pair().textContent).toContain('Setting up…');
    expect(pair().textContent).not.toContain('Your phone may ask');
    await act(async () => release());
    expect(pair().textContent).toContain('Reading what your ring has stored · 34 %');
    expect(within(pair()).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('34');
    await act(async () => release());
    expect(pair().textContent).toContain('Connected.');
    expect(pair().textContent).not.toMatch(/Read \d+ nights/);
  });

  it('web: the browser chooser replaces the list and its ring is paired', async () => {
    const fake = createFakeRingService('none', { now: NOW });
    renderPage(fake, WEB);
    expect(pair().textContent).toContain('Your browser will show a list of nearby devices. Choose your ring there.');
    fireEvent.click(screen.getByRole('button', { name: 'Look for rings' }));
    await flush();
    expect(document.querySelector('.rg-scan')).toBeNull();
    expect(fake.calls).toEqual(['scan', 'pair:cand-1']);
    expect(pair().textContent).toContain('Connected.');
  });
});

describe('pairing step 1 when the platform is not ready', () => {
  it('Bluetooth off (Android): the line and Turn on Bluetooth replace Look for rings', async () => {
    const fake = createFakeRingService('bluetooth_off', { now: NOW });
    fake.setRings([]);
    renderPage(fake);
    expect(document.querySelector('.rg-span .rg-pair')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Look for rings' })).toBeNull();
    expect(pair().querySelector('.lm-inline-warn')?.textContent).toContain('Turn on Bluetooth to reach your ring.');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Turn on Bluetooth' })));
    expect(fake.calls).toContain('requestBluetooth');
    expectClean();
  });

  it('Bluetooth off (computer): the settings line, no key', () => {
    const fake = createFakeRingService('bluetooth_off', { now: NOW });
    fake.setRings([]);
    renderPage(fake, DESKTOP);
    expect(pair().querySelector('.lm-inline-warn')?.textContent).toContain('Turn on Bluetooth in your computer’s settings to reach your ring.');
    expect(within(pair()).queryAllByRole('button')).toHaveLength(0);
  });

  it('permission needed: the line and Allow', async () => {
    const fake = createFakeRingService('permission_needed', { now: NOW });
    fake.setRings([]);
    renderPage(fake);
    expect(pair().querySelector('.lm-inline-warn')?.textContent).toContain('Vitals needs the Nearby devices permission to find your ring. Allow it in Android settings for Vitals.');
    expect(screen.queryByRole('button', { name: 'Look for rings' })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Allow' })));
    expect(fake.calls).toContain('requestPermission');
    expectClean();
  });

  it('a candidate without an id tail shows the label alone', async () => {
    const fake = withScan(createFakeRingService('none', { now: NOW }), [{ candidateId: 'x', driverId: 'jstyle2301', label: 'J-Style 2301', rssi: -70, known: false }]);
    renderPage(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Look for rings' }));
    await flush();
    expect(rowNames()).toEqual(['J-Style 2301']);
    expect(screen.getByRole('button', { name: /J-Style 2301/ }).textContent).toContain('close');
  });
});

describe('scan list helpers', () => {
  it('signal words: near ≥ −65, close −65…−80, far < −80', () => {
    expect(signalOf(-40)).toBe('near');
    expect(signalOf(-65)).toBe('near');
    expect(signalOf(-66)).toBe('close');
    expect(signalOf(-80)).toBe('close');
    expect(signalOf(-81)).toBe('far');
    expect(signalOf(undefined)).toBeNull();
  });
  it('known rings first, then the strongest', () => {
    const c = (id: string, rssi: number | undefined, known = false): RingCandidate => ({ candidateId: id, driverId: 'd', label: 'J-Style 2301', rssi, known });
    expect(sortCandidates([c('a', -90), c('b', -50), c('c', -95, true), c('d', undefined)]).map((x) => x.candidateId)).toEqual(['c', 'b', 'a', 'd']);
  });
  it('pair stage follows the ring the service publishes', () => {
    const r = (state: RingStatus['state'], syncProgress?: number): RingStatus => ({ ringKey: 'new', label: 'J-Style 2301', state, syncProgress });
    expect(pairStage([], [], false)).toEqual({ stage: 'connect' });
    expect(pairStage([r('connecting')], [], false)).toEqual({ stage: 'connect' });
    expect(pairStage([r('connected')], [], false)).toEqual({ stage: 'setup' });
    expect(pairStage([r('syncing', 0.5)], [], false)).toEqual({ stage: 'reading', progress: 0.5 });
    expect(pairStage([r('connected')], ['new'], false)).toEqual({ stage: 'connect' });
    expect(pairStage([r('syncing', 0.2)], ['new'], true)).toEqual({ stage: 'reading', progress: 0.2 });
  });
});
