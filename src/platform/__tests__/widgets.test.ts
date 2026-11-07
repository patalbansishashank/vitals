/** The home-screen widgets' publisher: what it sends, its throttle, quiet mode, the plugin glue and a widget tap. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWidgetPublisher,
  onWidgetOpen,
  requestPinWidget,
  resetWidgetsForTests,
  sanitizeSnapshot,
  vitalsWidgets,
  widgetPublisher,
  widgetStatus,
  WIDGET_SERIES_MAX,
  WIDGET_THROTTLE_MS,
  type VitalsWidgetsPlugin,
  type WidgetRing,
  type WidgetSnapshot,
  type WidgetToday,
} from '../widgets';
import { activityWidgetPart, ringWidgetPart, sleepWidgetPart } from '@/features/widgets/feed';

const flush = () => new Promise((r) => setTimeout(r, 0));

const today: WidgetToday = {
  date: '2026-10-28',
  energy: { value: '1 240', unit: 'kcal', range: '1 120–1 360' },
  steps: { value: '6 420', goal: '10 000', ratio: 0.642, word: 'over half of the goal' },
  heartPoints: { value: '84', goal: '150', ratio: 0.56, word: 'on track this week' },
};
const ring: WidgetRing = { state: 'ready', hr: { value: '62', unit: 'bpm', at: 1_000 }, battery: { value: '64', word: 'Fine', at: 900 }, lastSyncAt: 1_100 };

function harness(o: { throttleMs?: number; refreshMs?: number } = {}) {
  let t = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let ids = 0;
  const sent: WidgetSnapshot[] = [];
  const pub = createWidgetPublisher({
    send: (s) => void sent.push(s),
    now: () => t,
    ...o,
    setTimer: (fn, ms) => {
      const id = ++ids;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const advance = (ms: number) => {
    t += ms;
    for (const x of timers.filter((x) => x.at <= t)) {
      timers.splice(timers.indexOf(x), 1);
      x.fn();
    }
  };
  return { pub, sent, advance, pending: () => timers.length };
}

/** Every string of a snapshot outside the instants, ratios, the date and the pictures (series and stage runs carry no text). */
function shownTexts(s: WidgetSnapshot): string[] {
  const out: string[] = [];
  const walk = (v: unknown, k: string) => {
    if (k === 'series' || k === 'stages') return;
    if (typeof v === 'string' && k !== 'date' && k !== 'unit' && !(k === 'state' && ['ready', 'unpaired', 'unreachable', 'empty'].includes(v))) out.push(v);
    else if (typeof v === 'number' && !['at', 'lastSyncAt', 'ratio', 'v', 'onset', 'wake'].includes(k)) out.push(String(v));
    else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
  };
  walk(s, '');
  return out;
}

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
  resetWidgetsForTests();
});

describe('widget publisher', () => {
  it('sends nothing before quiet mode is known, then the snapshot as the app shows it', () => {
    const h = harness();
    h.pub.setToday(today);
    h.pub.setRing(ring);
    expect(h.sent).toHaveLength(0);
    h.pub.setQuiet(false);
    expect(h.sent).toHaveLength(1);
    const s = h.sent[0]!;
    expect(s).toMatchObject({ v: 1, quiet: false, at: 1_000_000 });
    expect(s.today).toEqual({ ...today, sleep: null });
    expect(s.ring).toEqual(ring);
  });

  it('merges parts of the same day, and another day replaces them', () => {
    const h = harness();
    h.pub.setQuiet(false);
    h.pub.setToday(today);
    h.pub.setToday({ date: '2026-10-28', sleep: { value: '7 h 12', word: 'Goal met' } });
    expect(h.pub.current().today).toMatchObject({ steps: today.steps, sleep: { value: '7 h 12', word: 'Goal met' } });
    h.pub.setToday({ date: '2026-10-29', sleep: { value: '6 h 40' } });
    expect(h.pub.current().today).toEqual({ date: '2026-10-29', energy: null, steps: null, heartPoints: null, sleep: { value: '6 h 40', word: null } });
  });

  it('throttles: the first at once, then one at the end of the window with the latest parts', () => {
    const h = harness();
    h.pub.setQuiet(false);
    h.pub.setToday(today);
    expect(h.sent).toHaveLength(1);
    h.pub.setRing(ring);
    h.pub.setToday({ ...today, steps: { ...today.steps, value: '6 500', ratio: 0.65 } });
    expect(h.sent).toHaveLength(1);
    expect(h.pending()).toBe(1);
    h.advance(WIDGET_THROTTLE_MS - 1);
    expect(h.sent).toHaveLength(1);
    h.advance(1);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.today?.steps?.value).toBe('6 500');
    expect(h.sent[1]!.ring).toEqual(ring);
  });

  it('skips an unchanged snapshot until the refresh interval, and a flush always sends', () => {
    const h = harness({ refreshMs: 600_000 });
    h.pub.setQuiet(false);
    h.pub.setToday(today);
    h.advance(WIDGET_THROTTLE_MS);
    h.pub.setToday(today);
    expect(h.sent).toHaveLength(1);
    h.advance(600_000);
    h.pub.setToday(today);
    expect(h.sent).toHaveLength(2);
    h.pub.flush();
    expect(h.sent).toHaveLength(3);
    expect(h.sent[2]!.at).toBe(h.sent[1]!.at);
  });

  it('a change of quiet mode reaches the home screen at once', () => {
    const h = harness();
    h.pub.setQuiet(false);
    h.pub.setToday(today);
    h.pub.setQuiet(true);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.quiet).toBe(true);
    expect(h.sent[1]!.today?.energy).toBeNull();
  });

  it('forgets everything on reset (erased data)', () => {
    const h = harness();
    h.pub.setQuiet(false);
    h.pub.setToday(today);
    h.pub.reset();
    h.pub.flush();
    expect(h.sent).toHaveLength(1);
    expect(h.pub.current().today).toBeNull();
  });
});

describe('quiet mode', () => {
  it('a quiet snapshot carries words only: no energy, no figure, no word with a digit', () => {
    const s = sanitizeSnapshot({
      v: 1,
      at: 5,
      quiet: true,
      today: { ...today, sleep: { value: '7 h 12', word: 'Goal met' }, heartPoints: { ...today.heartPoints, word: '84 points' } },
      ring,
    });
    expect(s.today?.energy).toBeNull();
    expect(s.today?.steps).toEqual({ ratio: 0.642, word: 'over half of the goal' });
    expect(s.today?.heartPoints).toBeNull();
    expect(s.today?.sleep).toEqual({ word: 'Goal met' });
    expect(s.ring?.hr).toEqual({ unit: 'bpm', at: 1_000 });
    expect(s.ring?.battery).toEqual({ word: 'Fine', at: 900 });
    for (const t of shownTexts(s)) expect(t).not.toMatch(/\d/);
  });

  it('the builders give the app quiet words, and quiet snapshots of them show no digit', () => {
    const act = activityWidgetPart({
      date: '2026-10-28',
      unit: 'kcal',
      energy: { soFar: 1240, envelope: { lo: 1800, hi: 2200 }, total: 2000 },
      steps: { soFar: 6420, goal: 10000 },
      heartPoints: { week: 84, daysIn: 3 },
    });
    expect(act.energy).toMatchObject({ unit: 'kcal' });
    expect(act.energy?.value).toMatch(/1.240/);
    expect(act.energy?.range).toMatch(/^1.116–1.364$/);
    expect(act.steps).toMatchObject({ ratio: 0.642, word: 'over half of the goal' });
    expect(act.steps?.goal).toMatch(/^10.000$/);
    expect(act.heartPoints).toMatchObject({ value: '84', goal: '150', word: 'on track this week' });
    const sleep = sleepWidgetPart('2026-10-28', { tstText: '7 h 12', tstLower: 432 }, 420);
    expect(sleep.sleep).toEqual({ value: '7 h 12', word: 'Goal met', goal: '7 h', ratio: 432 / 420 });
    const r = ringWidgetPart({ state: 'ready', hr: { text: '62', at: '2026-10-28T07:46:00Z' }, battery: { percent: 15, at: null }, lastUploadAt: '2026-10-28T07:47:00Z' });
    expect(r).toEqual({ state: 'ready', hr: { value: '62', unit: 'bpm', at: Date.parse('2026-10-28T07:46:00Z') }, battery: { value: '15', word: 'Low', at: null }, lastSyncAt: Date.parse('2026-10-28T07:47:00Z') });
    const q = sanitizeSnapshot({ v: 1, at: 1, quiet: true, today: { ...act, ...sleep }, ring: r });
    for (const t of shownTexts(q)) expect(t).not.toMatch(/\d/);
    expect(q.today?.steps?.word).toBe('over half of the goal');
    expect(q.today?.sleep?.word).toBe('Goal met');
  });

  it('unknown steps and points are said as unknown, never zero', () => {
    const act = activityWidgetPart({ date: '2026-10-28', unit: 'kcal', energy: null, steps: { soFar: null, goal: 10000 }, heartPoints: { week: null, daysIn: 1 } });
    expect(act.energy).toBeNull();
    expect(act.steps).toMatchObject({ value: null, ratio: null, word: 'no value yet' });
    expect(act.heartPoints).toMatchObject({ value: null, ratio: null, word: 'No readings' });
  });
});

describe('the plugin', () => {
  function install(plugin: Partial<VitalsWidgetsPlugin> | null, o: { platform?: string; available?: boolean } = {}) {
    const cap = {
      getPlatform: () => o.platform ?? 'android',
      isNativePlatform: () => true,
      registerPlugin: vi.fn(() => plugin),
      ...(o.available !== undefined ? { isPluginAvailable: (n: string) => n === 'VitalsWidgets' && o.available! } : {}),
    };
    (globalThis as { Capacitor?: unknown }).Capacitor = cap;
  }

  it('is there only in the Android app with the plugin', () => {
    expect(vitalsWidgets()).toBeNull();
    expect(widgetPublisher()).toBeNull();
    install({}, { platform: 'web' });
    expect(vitalsWidgets()).toBeNull();
    install({}, { available: false });
    expect(vitalsWidgets()).toBeNull();
    install({ publish: vi.fn() }, { available: true });
    expect(vitalsWidgets()).not.toBeNull();
  });

  it('publishes the sanitized snapshot through the plugin', async () => {
    const publish = vi.fn(async () => ({ placed: 1 }));
    install({ publish });
    const pub = widgetPublisher()!;
    pub.setQuiet(true);
    pub.setToday(today);
    await flush();
    expect(publish).toHaveBeenCalledTimes(1);
    const arg = (publish.mock.calls[0] as unknown as [{ snapshot: WidgetSnapshot }])[0];
    expect(arg.snapshot.quiet).toBe(true);
    expect(arg.snapshot.today?.energy).toBeNull();
    expect(arg.snapshot.today?.steps).toEqual({ ratio: 0.642, word: 'over half of the goal' });
  });

  it('a widget tap opens its screen once: what waits at start, then on each event', async () => {
    const listeners: Array<() => void> = [];
    const waiting = ['/train?log=1', null, '/ring', '//evil.example', 'https://evil.example'];
    install({
      takeOpen: vi.fn(async () => ({ path: waiting.shift() ?? null })),
      addListener: vi.fn(async (_e: string, cb: () => void) => {
        listeners.push(cb);
        return { remove: vi.fn() };
      }),
    });
    const open = vi.fn();
    const stop = onWidgetOpen(open);
    await flush();
    await flush();
    expect(open).toHaveBeenCalledWith('/train?log=1');
    listeners[0]!();
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
    listeners[0]!();
    await flush();
    expect(open).toHaveBeenLastCalledWith('/ring');
    listeners[0]!();
    listeners[0]!();
    await flush();
    expect(open).toHaveBeenCalledTimes(2);
    stop();
  });
});

// ------------------------------------------------------------------------------------------------ r071: the new fields

const line = { y: [0, 0.2, 0.5, null, 0.9], now: 4 };
const richToday: WidgetToday = {
  date: '2026-10-28',
  energy: { value: '1 096', unit: 'kcal', range: '983–1 209', ratio: 0.42, likely: '2 595', state: 'On plan', series: { y: [0, 0.2, 0.42, null, null], now: 2, ahead: [null, null, 0.42, 0.7, 1] } },
  steps: { value: '7 605', goal: '9 000', ratio: 0.845, word: 'over half of the goal', state: 'On course', likely: '12 878', series: { y: [0.2, 1, null, 0.5], now: 3 } },
  heartPoints: { value: '84', goal: '150', ratio: 0.56, word: 'on track this week' },
  sleep: { value: '7 h 56', word: 'Goal met', goal: '7 h 30', ratio: 1.06, onset: 1_000, wake: 2_000, stages: [[0, 0.5, 2], [0.5, 1, 3]] },
};
const richRing: WidgetRing = { state: 'ready', hr: { value: '79', unit: 'bpm', at: 1_000, state: 'Normal', range: '50–90', series: line }, battery: { value: '64', word: 'Fine', at: 900 }, lastSyncAt: 1_100 };

describe('the snapshot contract (r071): new fields are optional and travel as written', () => {
  it('keeps what a placed widget draws, leaves out what is absent, and keeps v at 1', () => {
    const s = sanitizeSnapshot({ v: 1, at: 5, quiet: false, today: richToday, ring: richRing });
    expect(s.v).toBe(1);
    expect(s.today?.energy).toEqual(richToday.energy);
    expect(s.today?.steps).toEqual(richToday.steps);
    expect(s.today?.sleep).toEqual(richToday.sleep);
    expect(s.ring?.hr).toEqual(richRing.hr);
    // nothing new is added as a null: a snapshot without them is the snapshot of before
    const plain = sanitizeSnapshot({ v: 1, at: 5, quiet: false, today: { date: '2026-10-28', energy: { value: '1', unit: 'kcal' }, steps: { value: '2', ratio: 0.1 } }, ring: null });
    expect(plain.today?.energy).toEqual({ value: '1', unit: 'kcal', range: null });
    expect(Object.keys(plain.today?.steps ?? {}).sort()).toEqual(['goal', 'ratio', 'value', 'word']);
    expect(plain.body).toBeUndefined();
  });

  it('series stay inside 0..1, keep their gaps and never pass 48 points; a series with nothing in it is dropped', () => {
    const long = Array.from({ length: 60 }, (_, i) => (i === 5 ? null : i / 59));
    const s = sanitizeSnapshot({
      v: 1,
      at: 1,
      quiet: false,
      today: { date: 'd', steps: { value: '1', series: { y: [-1, 0.123456, 7, null, Number.NaN], now: 9 } }, energy: { value: '1', unit: 'kcal', series: { y: long, now: 3, ahead: long } } },
      ring: { state: 'ready', hr: { unit: 'bpm', at: 5, series: { y: [null, null] } } },
    });
    expect(s.today?.steps?.series).toEqual({ y: [0, 0.123, 1, null, null] });
    expect(s.today?.energy?.series?.y).toHaveLength(WIDGET_SERIES_MAX);
    expect(s.today?.energy?.series?.y[5]).toBeNull();
    expect(s.today?.energy?.series?.now).toBe(3);
    expect(s.today?.energy?.series?.ahead).toHaveLength(WIDGET_SERIES_MAX);
    expect(s.ring?.hr?.series).toBeUndefined();
  });

  it('stage runs: ordered inside 0..1 with a level 0 to 4; anything else is left out', () => {
    const s = sanitizeSnapshot({
      v: 1,
      at: 1,
      quiet: false,
      today: { date: 'd', sleep: { value: '7 h', stages: [[0, 0.4, 2], [0.4, 0.2, 3], [0.5, 1.5, 3], [0.5, 0.9, 7] as never, [0.6, 0.9, 4], ['x', 1, 1] as never] } },
      ring: null,
    });
    expect(s.today?.sleep?.stages).toEqual([[0, 0.4, 2], [0.6, 0.9, 4]]);
  });

  it('quiet mode: no energy, no figure, no line or bar, no goal or range; ratios, words, stages and instants stay', () => {
    const s = sanitizeSnapshot({ v: 1, at: 5, quiet: true, today: richToday, ring: richRing }, { weight: true });
    expect(s.today?.energy).toBeNull();
    expect(s.today?.steps).toEqual({ ratio: 0.845, word: 'over half of the goal', state: 'On course' });
    expect(s.today?.sleep).toEqual({ word: 'Goal met', ratio: 1.06, onset: 1_000, wake: 2_000, stages: [[0, 0.5, 2], [0.5, 1, 3]] });
    expect(s.ring?.hr).toEqual({ unit: 'bpm', at: 1_000, state: 'Normal' });
    for (const t of shownTexts(s)) expect(t, t).not.toMatch(/\d/);
    // a word with a digit in it never leaves, in either mode
    const w = sanitizeSnapshot({ v: 1, at: 1, quiet: false, today: { date: 'd', steps: { value: '1', state: 'On course by 18:00' }, energy: { value: '1', unit: 'kcal', state: 'Over by 50' } }, ring: null });
    expect(w.today?.steps?.state).toBeUndefined();
    expect(w.today?.energy?.state).toBeUndefined();
  });

  it('weight is never in a snapshot unless the person opted in; quiet mode keeps the state word only', () => {
    const body = { weight: { value: '85.2', unit: 'kg', state: 'onTrack' as const, series: line } };
    const base = { v: 1 as const, at: 1, quiet: false, today: null, ring: null, body };
    expect(sanitizeSnapshot(base).body).toBeUndefined();
    expect(sanitizeSnapshot(base, { weight: false }).body).toBeUndefined();
    expect(sanitizeSnapshot(base, { weight: true }).body).toEqual({ weight: { value: '85.2', unit: 'kg', state: 'onTrack', series: { y: [0, 0.2, 0.5, null, 0.9], now: 4 } } });
    expect(sanitizeSnapshot({ ...base, quiet: true }, { weight: true }).body).toEqual({ weight: { unit: 'kg', state: 'onTrack' } });
    // opted in but nothing to show (no trend yet, or quiet with no state): the body is there and its weight is null
    expect(sanitizeSnapshot({ ...base, quiet: true, body: { weight: { value: '85.2', unit: 'kg' } } }, { weight: true }).body).toEqual({ weight: null });
    expect(sanitizeSnapshot({ ...base, body: { weight: { value: '', unit: 'kg' } } }, { weight: true }).body).toEqual({ weight: null });
    expect(sanitizeSnapshot({ ...base, body: null }, { weight: true }).body).toEqual({ weight: null });
  });
});

describe('the app day and the settings that decide what may be on the home screen (r071)', () => {
  it('keeps when the app day ends, in either mode, and leaves it out when it is not an instant', () => {
    const base = { v: 1 as const, at: 5, today: { date: '2026-10-28', until: 1_793_226_600_000, steps: { value: '1', ratio: 0.1, word: 'under half of the goal' } }, ring: null };
    expect(sanitizeSnapshot({ ...base, quiet: false }).today?.until).toBe(1_793_226_600_000);
    expect(sanitizeSnapshot({ ...base, quiet: true }).today?.until).toBe(1_793_226_600_000);
    for (const bad of [null, undefined, 0, -5, Number.NaN]) {
      expect('until' in (sanitizeSnapshot({ ...base, quiet: false, today: { ...base.today, until: bad } }).today ?? {})).toBe(false);
    }
  });

  it('turning quiet mode on before anything was published replaces what the phone holds with no figure at all; the first answer is no change', () => {
    const h = harness();
    h.pub.setQuiet(false);
    expect(h.sent).toHaveLength(0);
    h.pub.setQuiet(true);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ v: 1, quiet: true, today: null, ring: null });
    // a part that arrives afterwards still goes out, whatever was sent before
    h.pub.setToday({ date: '2026-10-28', sleep: { word: 'Goal met' } });
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.today?.sleep).toEqual({ word: 'Goal met' });
  });

  it('turning weight off before anything was published does the same; turning it on, or the first answer, sends nothing', () => {
    const h = harness();
    h.pub.setQuiet(false);
    h.pub.setWeightAllowed(false);
    expect(h.sent).toHaveLength(0);
    h.pub.setWeightAllowed(true);
    expect(h.sent).toHaveLength(0);
    h.pub.setWeightAllowed(false);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ today: null, ring: null });
    expect(h.sent[0]!.body).toBeUndefined();
  });
});

describe('the publisher and weight (r071)', () => {
  it('sends weight only while the opt-in is on, and a change of the opt-in reaches the home screen at once', () => {
    const h = harness();
    h.pub.setQuiet(false);
    h.pub.setToday(today);
    h.pub.setBody({ weight: { value: '85.2', unit: 'kg', state: 'ahead' } });
    h.advance(WIDGET_THROTTLE_MS);
    expect(h.sent.at(-1)!.body).toBeUndefined();
    const n = h.sent.length;
    h.pub.setWeightAllowed(true);
    expect(h.sent).toHaveLength(n + 1);
    expect(h.sent.at(-1)!.body?.weight).toMatchObject({ value: '85.2', state: 'ahead' });
    h.pub.setWeightAllowed(true);
    expect(h.sent).toHaveLength(n + 1);
    h.pub.setWeightAllowed(false);
    expect(h.sent).toHaveLength(n + 2);
    expect(h.sent.at(-1)!.body).toBeUndefined();
    h.pub.setWeightAllowed(true);
    h.pub.reset();
    h.pub.flush();
    // the setting stays, the weight is forgotten (erased data)
    expect(h.pub.current().body).toEqual({ weight: null });
  });
});

describe('the shell status and pin (r071)', () => {
  function install(plugin: Partial<VitalsWidgetsPlugin>) {
    (globalThis as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'android', isNativePlatform: () => true, registerPlugin: vi.fn(() => plugin) };
  }

  it('reads what the shell says, and an older shell counts as placed with the first revision', async () => {
    expect(await widgetStatus()).toBeNull();
    install({ status: vi.fn(async () => ({ placed: 3, byCard: { energy: 2, steps: 1, junk: -4, bad: 'x' } as never, contract: 2, pin: true })) });
    expect(await widgetStatus()).toEqual({ placed: 3, byCard: { energy: 2, steps: 1 }, contract: 2, pin: true });
    resetWidgetsForTests();
    install({ status: vi.fn(async () => ({ placed: 2 })) });
    expect(await widgetStatus()).toEqual({ placed: 2, byCard: {}, contract: 1, pin: false });
    resetWidgetsForTests();
    install({ status: vi.fn(async () => Promise.reject(new Error('no such method'))) });
    expect(await widgetStatus()).toEqual({ placed: null, byCard: {}, contract: 1, pin: false });
  });

  it('asks the launcher to pin a card; an older shell or a launcher that cannot says so', async () => {
    expect(await requestPinWidget('energy')).toEqual({ supported: false, requested: false });
    const pin = vi.fn(async () => ({ supported: true, requested: true }));
    install({ pin });
    expect(await requestPinWidget('energy')).toEqual({ supported: true, requested: true });
    expect(pin).toHaveBeenCalledWith({ card: 'energy' });
    resetWidgetsForTests();
    install({ pin: vi.fn(async () => Promise.reject(new Error('UNIMPLEMENTED'))) });
    expect(await requestPinWidget('energy')).toEqual({ supported: false, requested: false });
    resetWidgetsForTests();
    install({ pin: vi.fn(async () => ({ supported: false })) });
    expect(await requestPinWidget('energy')).toEqual({ supported: false, requested: false });
  });
});
