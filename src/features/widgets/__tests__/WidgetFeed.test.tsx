/**
 * r071 W1: the home-screen feed reads the stores and models, never a card. Nothing here mounts Today or a Today card:
 * only the shell's `WidgetFeed` with the data hooks answering, as the app's models would. Before r071 the energy, steps
 * and sleep figures were published from two cards, so a card removed from Today froze its widget.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetSnapshot } from '@/platform/widgets';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 28, 0, 0, 0);

// the models the cards read, answered by stand-ins
const m = vi.hoisted(() => ({
  useToday: vi.fn(),
  useHeartPoints: vi.fn(),
  useAvailability: vi.fn(),
  useTimeline: vi.fn(),
  useRingDay: vi.fn(),
  ringTimeline: vi.fn(),
  living: { today: vi.fn(), trend: vi.fn() },
}));

vi.mock('@/features/living/boot', () => ({}));
vi.mock('@/features/living/clock', () => ({ useToday: () => '2026-10-28', useLivingClock: () => ({ tz: 'Asia/Kolkata', rolloverH: 4, now: () => new Date() }) }));
vi.mock('@/features/living/activity/data', () => ({ useActivityData: () => ({ useToday: m.useToday, useHeartPoints: m.useHeartPoints, useTimeline: m.useTimeline }) }));
vi.mock('@/features/living/data/source', () => ({ useLiving: (select: (s: unknown) => unknown) => select(m.living) }));
vi.mock('@/features/ring/day', () => ({ useRingDay: m.useRingDay }));
vi.mock('@/features/ring/data', () => ({
  useTimeline: m.ringTimeline,
  useDaily: () => ({ data: { metrics: { hr: { latest: { value: 79, at: '2026-10-28T07:46:00Z' } } } } }),
  useAvailability: m.useAvailability,
}));
vi.mock('@/features/ring/RingToday', () => ({ useRingTodayState: () => 'ready' }));
vi.mock('@/features/ring/components/parts', () => ({ useUnitPrefs: () => ({ units: 'metric' }) }));
vi.mock('@/features/ring/views/cards', () => ({ useRingState: () => ({ battery: 64, batteryAt: '2026-10-28T07:30:00Z' }) }));
vi.mock('@/state/persistence', () => ({ registerEraseHook: () => () => undefined, registerStore: () => undefined }));

import { useSettingsStore } from '@/state/settingsStore';
import { withSystemWrite } from '@/state/scope';
import { resetWidgetsForTests } from '@/platform/widgets';
import { WidgetFeed } from '../WidgetFeed';

const bins = Array.from({ length: 96 }, (_, i) => ({ start: T0 + i * 15 * 60_000, kcal: 27 }));
const hr = Array.from({ length: 1440 }, (_, i) => (i % 3 === 0 && i < 600 ? 60 + (i % 40) : null));
const minutes = (f: (i: number) => number | null) => Array.from({ length: 1440 }, (_, i) => f(i));
const timeline = {
  date: '2026-10-28',
  start: new Date(T0).toISOString(),
  minutes: 1440,
  steps: { selected: minutes((i) => (i % 60 === 0 && i < 600 ? 300 : null)), ring: minutes(() => null), phone: minutes(() => null), source: minutes(() => null), support: minutes(() => null) },
  hr: { bpm: hr },
};
const night = {
  tstText: '7 h 56',
  tstLower: 476,
  onset: T0 - H,
  wake: T0 + 7 * H,
  windowStart: T0 - 70 * 60_000,
  windowEnd: T0 + 8 * H,
  session: { blocks: [{ start: new Date(T0 - 70 * 60_000).toISOString(), end: new Date(T0 + 3 * H).toISOString(), stage: 'light' }, { start: new Date(T0 + 3 * H).toISOString(), end: new Date(T0 + 8 * H).toISOString(), stage: 'deep' }] },
};

interface Shell {
  publish: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
}

/** The Android shell: a fake `VitalsWidgets` plugin that answers `status()` as given and records every publish. */
function shell(status: Record<string, unknown>): Shell {
  const publish = vi.fn(async () => ({ placed: 1 }));
  const st = vi.fn(async () => status);
  const clear = vi.fn(async () => undefined);
  const plugin = { publish, status: st, clear, takeOpen: vi.fn(async () => ({ path: null })), addListener: vi.fn(async () => ({ remove: vi.fn() })) };
  (globalThis as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'android', isNativePlatform: () => true, registerPlugin: vi.fn(() => plugin) };
  return { publish, status: st, clear };
}

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));
/** The person's settings, set the way tests seed them (the store refuses a write outside a command). */
const setSettings = (patch: Record<string, unknown>) => withSystemWrite(() => useSettingsStore.setState(patch as never), 'test settings');
const lastSnapshot = (s: Shell): WidgetSnapshot => (s.publish.mock.calls.at(-1) as unknown as [{ snapshot: WidgetSnapshot }])[0].snapshot;

/** Mount the feed, let the shell answer, then send what it holds the way the app does when it goes to the background. */
async function mount(s: Shell) {
  const { widgetPublisher } = await import('@/platform/widgets');
  render(<WidgetFeed />);
  await settle();
  await settle();
  widgetPublisher()?.flush();
  await settle();
  return s;
}

beforeEach(() => {
  m.useToday.mockReset().mockReturnValue({
    model: { steps: { fusedSoFar: 7605, goal: { value: 9000 }, prior: 1, total: 12878 }, energy: { soFar: 1096, byBedtime: 2595, plan: 2540 } },
    day: { envelope: { lo: 2300, hi: 2900 }, total: 2595, bins15: bins },
    plan: null,
  });
  m.useHeartPoints.mockReset().mockReturnValue({ today: 10, week: 84 });
  m.useAvailability.mockReset().mockReturnValue({ data: { freshness: { lastUploadAt: '2026-10-28T07:47:00Z' } } });
  m.useTimeline.mockReset().mockReturnValue(timeline);
  m.ringTimeline.mockReset().mockReturnValue({ status: 'ready', data: timeline });
  m.useRingDay.mockReset().mockReturnValue({ night, goals: { sleepMin: { value: 450 } } });
  m.living.today.mockReset().mockReturnValue({ trendWeight: { kg: 85.2, sd: 0.2 }, drift: [{ state: 'onTrack' }] });
  m.living.trend.mockReset().mockReturnValue({ trend: [86.1, 86, 85.8, Number.NaN, 85.5, 85.2] });
  setSettings({ quietMode: false, quietModeSet: true });
});

afterEach(() => {
  cleanup();
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
  resetWidgetsForTests();
  setSettings({ widgetWeight: undefined });
});

const placed = { today: 1, energy: 1, steps: 1, sleep: 1, ring: 1, weight: 0, actions: 0, log: 0 };

describe('the feed reads the models, not the cards', () => {
  it('publishes energy, steps, sleep and the ring with no Today card mounted', async () => {
    const s = await mount(shell({ placed: 5, byCard: placed, contract: 2, pin: true }));
    const snap = lastSnapshot(s);
    expect(snap.v).toBe(1);
    expect(snap.today?.energy).toMatchObject({ unit: 'kcal', state: 'On plan' });
    expect(snap.today?.energy?.value).toMatch(/^1.096$/);
    expect(snap.today?.steps).toMatchObject({ ratio: 7605 / 9000, state: 'On course' });
    expect(snap.today?.steps?.value).toMatch(/^7.605$/);
    expect(snap.today?.sleep).toMatchObject({ value: '7 h 56', word: 'Goal met', goal: '7 h 30' });
    expect(snap.ring?.hr).toMatchObject({ value: '79', unit: 'bpm', state: 'Normal' });
    expect(snap.ring?.battery).toMatchObject({ value: '64', word: 'Fine' });
  });

  it('does not read or send what no widget of this shell draws: the week’s Heart Points and the last sync', async () => {
    const snap = lastSnapshot(await mount(shell({ placed: 5, byCard: placed, contract: 2 })));
    expect(m.useHeartPoints).not.toHaveBeenCalled();
    expect(m.useAvailability).not.toHaveBeenCalled();
    expect(snap.today?.heartPoints ?? null).toBeNull();
    expect(snap.ring?.lastSyncAt).toBeNull();
  });

  it('builds the pictures when the shell reads them and a widget that draws them is placed', async () => {
    const snap = lastSnapshot(await mount(shell({ placed: 5, byCard: placed, contract: 2 })));
    expect(snap.today?.energy?.series?.y).toHaveLength(48);
    expect(snap.today?.steps?.series?.y).toHaveLength(24);
    expect(snap.today?.sleep?.stages?.length).toBeGreaterThan(0);
    expect(snap.ring?.hr?.series).toBeDefined();
    expect(snap.ring?.hr?.range).toMatch(/^\d+–\d+$/);
  });

  it('reads nothing at all while no widget is placed, and the snapshot the phone still holds goes', async () => {
    const s = await mount(shell({ placed: 0, byCard: { today: 0, energy: 0, steps: 0, sleep: 0, ring: 0, weight: 0 }, contract: 2 }));
    expect(s.publish).not.toHaveBeenCalled();
    expect(m.useToday).not.toHaveBeenCalled();
    expect(m.useRingDay).not.toHaveBeenCalled();
    // a widget placed later must not draw figures published under a setting that has changed since
    expect(s.clear).toHaveBeenCalled();
  });

  it('says when the app day ends: the 04:00 rollover, so the widgets keep the night’s figures until then', async () => {
    const snap = lastSnapshot(await mount(shell({ placed: 5, byCard: placed, contract: 2 })));
    // 2026-10-29 04:00 in Kolkata
    expect(snap.today?.until).toBe(Date.parse('2026-10-29T04:00:00+05:30'));
  });

  it('reads only what a placed widget needs: a Sleep widget alone never starts the energy run', async () => {
    const s = await mount(shell({ placed: 1, byCard: { ...placed, today: 0, energy: 0, steps: 0, ring: 0 }, contract: 2 }));
    expect(m.useRingDay).toHaveBeenCalled();
    expect(m.useToday).not.toHaveBeenCalled();
    const snap = lastSnapshot(s);
    expect(snap.today?.sleep?.value).toBe('7 h 56');
    expect(snap.today?.energy).toBeNull();
    expect(snap.today?.steps).toBeNull();
    expect(snap.ring).toBeNull();
  });

  it('an older shell that only says how many are placed gets everything it draws (Heart Points, the last sync), and no pictures', async () => {
    const snap = lastSnapshot(await mount(shell({ placed: 2 })));
    expect(snap.today?.heartPoints).toMatchObject({ value: '84', goal: '150' });
    expect(snap.ring?.lastSyncAt).toBe(Date.parse('2026-10-28T07:47:00Z'));
    expect(snap.today?.energy?.value).toMatch(/^1.096$/);
    expect(snap.today?.sleep?.value).toBe('7 h 56');
    expect(snap.ring?.hr?.value).toBe('79');
    expect(snap.today?.energy?.series).toBeUndefined();
    expect(snap.today?.steps?.series).toBeUndefined();
    expect(snap.today?.sleep?.stages).toBeUndefined();
    expect(snap.ring?.hr?.series).toBeUndefined();
  });

  it('quiet mode: no energy and no figure leave the app, the words and ratios do', async () => {
    setSettings({ quietMode: true, quietModeSet: true });
    const snap = lastSnapshot(await mount(shell({ placed: 5, byCard: placed, contract: 2 })));
    expect(snap.quiet).toBe(true);
    expect(snap.today?.energy).toBeNull();
    expect(snap.today?.steps).toEqual({ ratio: 7605 / 9000, word: 'over half of the goal', state: 'On course' });
    expect(snap.today?.sleep?.value).toBeUndefined();
    expect(snap.today?.sleep?.word).toBe('Goal met');
    expect(snap.ring?.hr?.value).toBeUndefined();
    expect(snap.ring?.hr?.series).toBeUndefined();
  });
});

describe('weight is opt-in', () => {
  const withWeight = { ...placed, weight: 1 };

  it('stays off the home screen by default, and with a widget placed but no opt-in', async () => {
    const snap = lastSnapshot(await mount(shell({ placed: 6, byCard: withWeight, contract: 2 })));
    expect(snap.body).toBeUndefined();
    expect(m.living.today).not.toHaveBeenCalled();
  });

  it('is sent once the person turns it on, and taken back the moment they turn it off', async () => {
    setSettings({ widgetWeight: true });
    const s = await mount(shell({ placed: 6, byCard: withWeight, contract: 2 }));
    expect(lastSnapshot(s).body?.weight).toMatchObject({ value: '85.2', unit: 'kg', state: 'onTrack' });
    expect(lastSnapshot(s).body?.weight?.series?.y.length).toBeGreaterThan(2);
    await act(async () => {
      setSettings({ widgetWeight: false });
    });
    await settle();
    expect(lastSnapshot(s).body).toBeUndefined();
  });
});
