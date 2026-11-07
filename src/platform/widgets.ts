/*
 * Home-screen widgets, Android app only (0.6.6): the web side of the native `VitalsWidgets` plugin (Kotlin, apps/android:
 * VitalsWidgetsPlugin). Widgets cannot run the web app, so the app publishes a small snapshot of what Today and the
 * ring show — already formatted, exactly as the app writes it — whenever it changes (throttled) and when the app goes to
 * the background. The native side stores it and redraws the widgets; it turns the instants into "as of 13:20" and the
 * readings' times itself.
 *
 * Quiet mode (the app setting) is words only, no digits: a quiet snapshot carries no figure at all (no energy, no
 * steps, no points, no durations, no readings, no line or bar series), only the app's quiet words, the fills' ratios, the
 * night's stages and the instants (native turns those into parts of the day). The native side enforces the same.
 * Weight is never part of a snapshot unless the person turned on "Show weight on the home screen" (`widgetWeight`).
 *
 * (r071) Every field added since 0.6.6 is optional and the wire version stays 1: an older shell ignores keys it does not
 * read and keeps drawing its own widgets, a newer shell treats a missing field as unknown and draws the empty picture.
 * `status()` says which snapshot revision the shell reads (`contract`) and which widgets are placed (`byCard`), so the
 * feed builds series only for a shell that can draw them and only for widgets that exist.
 *
 * Feature-detected like `gaugeLocal.ts`: an older shell has no `VitalsWidgets` plugin, and the web, the PWA and the
 * desktop have none; every call is then a no-op.
 */
import { capacitor } from './androidShell';

/** The longest series a widget takes (bars: 24 hours or 7 days; lines: one point per half hour). */
export const WIDGET_SERIES_MAX = 48;
/** The longest list of stage spans of a night. */
export const WIDGET_STAGES_MAX = 64;
/** The highest snapshot revision this web bundle writes (`status().contract` of the shell must be at least this for series). */
export const WIDGET_CONTRACT = 2;

/**
 * A small picture's data: values in 0..1 inside the series' own range (never a unit), `null` = no reading (never
 * interpolated, never zero), at most `WIDGET_SERIES_MAX`.
 */
export interface WidgetSeries {
  y: Array<number | null>;
  /** The index of "now" (a line's live end, the current hour's bar): drawn bright. */
  now?: number | null;
  /** A forecast tail (Energy), same length as `y`: its values from `now` on, drawn dotted. */
  ahead?: Array<number | null> | null;
}

/** A night's stage run: its start and end in 0..1 of the recorded window, and a level: 0 awake, 1 REM, 2 light, 3 deep, 4 asleep but not staged. */
export type WidgetStageSpan = [from: number, to: number, stage: 0 | 1 | 2 | 3 | 4];

/** A figure against a goal: the app's display strings, the fill's ratio, the quiet word and, for Steps, the course. */
export interface WidgetFill {
  value?: string | null;
  goal?: string | null;
  ratio?: number | null;
  word?: string | null;
  /** (r071) The course of the day in words ("On course", "Likely under"): no figure. */
  state?: string | null;
  /** (r071) The likely total by bedtime ("12 878"). Never in quiet mode. */
  likely?: string | null;
  /** (r071) Steps by hour: bars, the current hour bright. Never in quiet mode. */
  series?: WidgetSeries | null;
}

export interface WidgetEnergy {
  value: string;
  unit: string;
  range?: string | null;
  /** (r071) Burned so far over the likely day (1 = the likely total). */
  ratio?: number | null;
  /** (r071) The likely day ("2 595"). */
  likely?: string | null;
  /** (r071) "On plan" / "Over plan" / "Under plan"; null without a plan. */
  state?: string | null;
  /** (r071) The day's running burn with its dotted forecast. */
  series?: WidgetSeries | null;
}

export interface WidgetSleep {
  value?: string | null;
  word?: string | null;
  /** (r071) The goal ("7 h 30"). Never in quiet mode. */
  goal?: string | null;
  /** (r071) Asleep over the goal. */
  ratio?: number | null;
  /** (r071) Fell asleep and woke (epoch ms): native says them as clock times, or as parts of the day in quiet mode. */
  onset?: number | null;
  wake?: number | null;
  /** (r071) The night's stage runs (the app draws the hypnogram in quiet mode too). */
  stages?: WidgetStageSpan[] | null;
}

export interface WidgetToday {
  /** The app's local day of these figures (YYYY-MM-DD): the widget never shows another day's as today's. */
  date: string;
  /**
   * (r071) When the app's day ends (epoch ms): the app's day rolls over at `dayRolloverH` (04:00), so between midnight and
   * then the figures are still today's. Without it the widget compares `date` with the calendar day.
   */
  until?: number | null;
  /** Energy so far ("1 240"), its unit and its scenario range ("1 120–1 360"). Never in quiet mode. */
  energy?: WidgetEnergy | null;
  steps?: WidgetFill | null;
  /** The week's Heart Points against 150. */
  heartPoints?: WidgetFill | null;
  /** Last night's sleep ("7 h 12"); the quiet word ("Goal met"). */
  sleep?: WidgetSleep | null;
}

export type WidgetRingState = 'ready' | 'unpaired' | 'unreachable' | 'empty';

export interface WidgetHr {
  value?: string | null;
  unit: string;
  /** When it was measured (epoch ms). */
  at: number;
  /** (r071) The reading in words ("Resting"). */
  state?: string | null;
  /** (r071) The day's low and high ("50–90"). Never in quiet mode. */
  range?: string | null;
  /** (r071) Today's heart rate as a line, its live end the latest reading. Never in quiet mode. */
  series?: WidgetSeries | null;
}

export interface WidgetRing {
  state: WidgetRingState;
  /** The latest heart rate and when it was measured (epoch ms). */
  hr?: WidgetHr | null;
  /** The ring's battery ("64"), the app's quiet word ("Fine" / "Low") and the reading's instant. */
  battery?: { value?: string | null; word?: string | null; at?: number | null } | null;
  /** Gauge's last upload to the server (epoch ms). */
  lastSyncAt?: number | null;
}

/** The trend weight against the plan. Only with Settings › Widgets › "Show weight on the home screen". */
export interface WidgetWeight {
  /** The trend ("85.2"). Never in quiet mode. */
  value?: string | null;
  unit: string;
  state?: 'ahead' | 'onTrack' | 'behind' | null;
  /** The last two weeks of the trend as a line. Never in quiet mode. */
  series?: WidgetSeries | null;
}

export interface WidgetBody {
  weight?: WidgetWeight | null;
}

export interface WidgetSnapshot {
  v: 1;
  /** When it was published (epoch ms). */
  at: number;
  quiet: boolean;
  today: WidgetToday | null;
  ring: WidgetRing | null;
  /** (r071) Left out unless the weight opt-in is on; then present, with `weight` null until there is a trend. */
  body?: WidgetBody | null;
}

/** What the shell says about itself: how many widgets are placed (by card), and which snapshot revision it reads. */
export interface WidgetStatus {
  /** null: the shell did not say (an older one): treat widgets as placed. */
  placed: number | null;
  /** Placed widgets per card id (`today`, `ring`, `energy`, `sleep`, `steps`, `weight`, `log`, `actions`). */
  byCard: Record<string, number>;
  /** The highest snapshot revision the shell reads; 1 when it did not say. */
  contract: number;
  /** The launcher can be asked to pin a widget. */
  pin: boolean;
}

interface ListenerHandle {
  remove(): Promise<void> | void;
}

export interface VitalsWidgetsPlugin {
  publish(o: { snapshot: WidgetSnapshot }): Promise<{ placed?: number }>;
  /** `byCard`, `contract` and `pin` came with r071: an older shell answers `{ placed }` only. */
  status(): Promise<{ placed?: number; byCard?: Record<string, number>; contract?: number; pin?: boolean }>;
  /** Ask the launcher to pin a widget of this card (r071; an older shell has no such method). */
  pin?(o: { card: string }): Promise<{ supported?: boolean; requested?: boolean }>;
  clear(): Promise<unknown>;
  /** The screen a widget tap asked for, once (null when none waits). */
  takeOpen(): Promise<{ path?: string | null }>;
  addListener(event: 'open' | 'pause', cb: (data: unknown) => void): Promise<ListenerHandle> | ListenerHandle;
}

let cached: { cap: object; plugin: VitalsWidgetsPlugin } | null = null;

/** The `VitalsWidgets` plugin, or null outside the Android app or on an older shell. Never return it from an async function: it is a Proxy. */
export function vitalsWidgets(): VitalsWidgetsPlugin | null {
  const cap = capacitor() as (ReturnType<typeof capacitor> & { isPluginAvailable?(name: string): boolean }) | undefined;
  if (!cap || cap.getPlatform?.() !== 'android') return null;
  if (cap.isPluginAvailable && !cap.isPluginAvailable('VitalsWidgets')) return null;
  if (cached?.cap === cap) return cached.plugin;
  const plugin = (cap.registerPlugin?.('VitalsWidgets') ?? cap.Plugins?.VitalsWidgets) as VitalsWidgetsPlugin | undefined;
  if (!plugin) return null;
  cached = { cap, plugin };
  return plugin;
}

/** A status as the web reads it: counts as numbers at least 0, the contract at least 1. */
function normaliseStatus(r: { placed?: unknown; byCard?: unknown; contract?: unknown; pin?: unknown } | null | undefined): WidgetStatus {
  const byCard: Record<string, number> = {};
  if (r?.byCard && typeof r.byCard === 'object') {
    for (const [k, v] of Object.entries(r.byCard as Record<string, unknown>)) if (finite(v) && v >= 0) byCard[k] = Math.floor(v);
  }
  return {
    placed: finite(r?.placed) && r.placed >= 0 ? Math.floor(r.placed) : null,
    byCard,
    contract: finite(r?.contract) && r.contract >= 1 ? Math.floor(r.contract) : 1,
    pin: r?.pin === true,
  };
}

/**
 * What the shell says about itself: how many widgets are placed (by card) and which snapshot revision it reads. An older
 * shell says `{ placed }` only (then the contract is 1: no series); a shell that cannot answer counts as "placed, unknown"
 * (the feed then keeps publishing). null outside the Android app.
 */
export async function widgetStatus(): Promise<WidgetStatus | null> {
  const plugin = vitalsWidgets();
  if (!plugin) return null;
  try {
    return normaliseStatus(await plugin.status());
  } catch {
    return normaliseStatus(null);
  }
}

/** Ask the launcher to pin a widget of this card (Android 8+, launcher-dependent); `supported: false` leaves the words to the caller. */
export async function requestPinWidget(card: string): Promise<{ supported: boolean; requested: boolean }> {
  const plugin = vitalsWidgets();
  if (!plugin) return { supported: false, requested: false };
  try {
    const r = await plugin.pin?.({ card });
    return { supported: r?.supported === true, requested: r?.requested === true };
  } catch {
    // an older shell has no pin method
    return { supported: false, requested: false };
  }
}

// ------------------------------------------------------------------------------------------------ quiet

const DIGIT = /\d/;
/** A quiet word: words only (the app's `wordsOnly`), so one carrying a digit is left out. */
const word = (w: string | null | undefined): string | null => (w && !DIGIT.test(w) ? w : null);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const ratioOf = (r: number | null | undefined): number | null => (typeof r === 'number' && Number.isFinite(r) && r >= 0 ? r : null);
const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const instant = (t: number | null | undefined): number | null => (finite(t) && t > 0 ? t : null);

/** A series as it may leave the app: 0..1, at most `WIDGET_SERIES_MAX`, gaps kept as null; null when nothing is drawn. */
function cleanSeries(s: WidgetSeries | null | undefined): WidgetSeries | null {
  if (!s || !Array.isArray(s.y)) return null;
  const line = (xs: ReadonlyArray<number | null>) => xs.slice(0, WIDGET_SERIES_MAX).map((v) => (finite(v) ? round3(Math.min(1, Math.max(0, v))) : null));
  const y = line(s.y);
  if (!y.some((v) => v !== null)) return null;
  const out: WidgetSeries = { y };
  if (Number.isInteger(s.now) && (s.now as number) >= 0 && (s.now as number) < y.length) out.now = s.now as number;
  if (Array.isArray(s.ahead)) {
    const ahead = line(s.ahead);
    if (ahead.some((v) => v !== null)) out.ahead = ahead;
  }
  return out;
}

/** A night's stage runs as they may leave the app: runs inside 0..1, in order, a level 0 to 4. */
function cleanStages(x: WidgetStageSpan[] | null | undefined): WidgetStageSpan[] | null {
  if (!Array.isArray(x)) return null;
  const out: WidgetStageSpan[] = [];
  for (const r of x.slice(0, WIDGET_STAGES_MAX)) {
    if (!Array.isArray(r)) continue;
    const [a, b, k] = r;
    if (finite(a) && finite(b) && Number.isInteger(k) && k >= 0 && k <= 4 && a >= 0 && b <= 1 && b > a) out.push([round3(a), round3(b), k as WidgetStageSpan[2]]);
  }
  return out.length ? out : null;
}

const fill = (f: WidgetFill | null | undefined, quiet: boolean): WidgetFill | null => {
  if (!f) return null;
  const out: WidgetFill = quiet ? { ratio: ratioOf(f.ratio), word: word(f.word) } : { value: f.value ?? null, goal: f.goal ?? null, ratio: ratioOf(f.ratio), word: word(f.word) };
  const state = word(f.state);
  if (state) out.state = state;
  if (!quiet) {
    if (f.likely) out.likely = f.likely;
    const series = cleanSeries(f.series);
    if (series) out.series = series;
  }
  return out.value || out.word ? out : null;
};

const energy = (e: WidgetEnergy | null | undefined, quiet: boolean): WidgetEnergy | null => {
  // quiet mode: no calorie talk at all
  if (quiet || !e) return null;
  const out: WidgetEnergy = { value: e.value, unit: e.unit, range: e.range ?? null };
  const ratio = ratioOf(e.ratio);
  if (ratio !== null) out.ratio = ratio;
  if (e.likely) out.likely = e.likely;
  const state = word(e.state);
  if (state) out.state = state;
  const series = cleanSeries(e.series);
  if (series) out.series = series;
  return out;
};

const sleep = (sl: WidgetSleep | null | undefined, quiet: boolean): WidgetSleep | null => {
  if (!sl) return null;
  const out: WidgetSleep = quiet ? { word: word(sl.word) } : { value: sl.value ?? null, word: word(sl.word) };
  const ratio = ratioOf(sl.ratio);
  if (ratio !== null) out.ratio = ratio;
  if (!quiet && sl.goal) out.goal = sl.goal;
  const onset = instant(sl.onset);
  if (onset !== null) out.onset = onset;
  const wake = instant(sl.wake);
  if (wake !== null) out.wake = wake;
  // the app draws the hypnogram in quiet mode too
  const stages = cleanStages(sl.stages);
  if (stages) out.stages = stages;
  return out.word || ('value' in out && out.value) || ratio !== null || stages ? out : null;
};

const hr = (h: WidgetHr | null | undefined, quiet: boolean): WidgetHr | null => {
  if (!h) return null;
  const out: WidgetHr = quiet ? { unit: h.unit, at: h.at } : { value: h.value ?? null, unit: h.unit, at: h.at };
  const state = word(h.state);
  if (state) out.state = state;
  if (!quiet) {
    if (h.range) out.range = h.range;
    const series = cleanSeries(h.series);
    if (series) out.series = series;
  }
  return out;
};

const weight = (w: WidgetWeight | null | undefined, quiet: boolean): WidgetWeight | null => {
  if (!w) return null;
  const state = w.state === 'ahead' || w.state === 'onTrack' || w.state === 'behind' ? w.state : null;
  // quiet mode shows the trend weight as a word only (the state), never the figure or its line
  if (quiet) return state ? { unit: w.unit, state } : null;
  if (!w.value) return null;
  const out: WidgetWeight = { value: w.value, unit: w.unit, state };
  const series = cleanSeries(w.series);
  if (series) out.series = series;
  return out;
};

/**
 * The snapshot as it may leave the app: in quiet mode only words, ratios, stages and instants (no energy, no figure, no
 * line or bar, no word with a digit); weight only when the person opted in (`opts.weight`). Pure.
 */
export function sanitizeSnapshot(s: WidgetSnapshot, opts: { weight?: boolean } = {}): WidgetSnapshot {
  const q = s.quiet;
  const t = s.today;
  const r = s.ring;
  const battery = r?.battery ? (q ? { word: word(r.battery.word), at: r.battery.at ?? null } : { value: r.battery.value ?? null, word: word(r.battery.word), at: r.battery.at ?? null }) : null;
  const out: WidgetSnapshot = {
    v: 1,
    at: s.at,
    quiet: q,
    today: t
      ? {
          date: t.date,
          ...(instant(t.until) !== null ? { until: instant(t.until)! } : {}),
          energy: energy(t.energy, q),
          steps: fill(t.steps, q),
          heartPoints: fill(t.heartPoints, q),
          sleep: sleep(t.sleep, q),
        }
      : null,
    ring: r
      ? {
          state: r.state,
          hr: hr(r.hr, q),
          battery: battery && (battery.word || ('value' in battery && battery.value)) ? battery : null,
          lastSyncAt: r.lastSyncAt ?? null,
        }
      : null,
  };
  // with the opt-in on the body part is there even before there is a trend (weight null): the widget then says "no trend
  // yet" instead of "off for widgets"
  if (opts.weight === true) out.body = { weight: weight(s.body?.weight, q) };
  return out;
}

// ------------------------------------------------------------------------------------------------ publisher

/** At most one publish per this (the native side redraws every placed widget on each). */
export const WIDGET_THROTTLE_MS = 30_000;
/** An unchanged snapshot is sent again after this, so the widget's "as of" stays fresh while the app is in use. */
export const WIDGET_REFRESH_MS = 10 * 60_000;

export interface WidgetPublisherOptions {
  send(s: WidgetSnapshot): Promise<unknown> | unknown;
  now?: () => number;
  throttleMs?: number;
  refreshMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface WidgetPublisher {
  setQuiet(quiet: boolean): void;
  /** Today's figures. A part for another date replaces what was kept; one for the same date is merged into it. */
  setToday(part: WidgetToday | null): void;
  setRing(part: WidgetRing | null): void;
  /** (r071) The trend weight, sent only while `setWeightAllowed(true)` (Settings › Widgets). */
  setBody(part: WidgetBody | null): void;
  /** (r071) The person's opt-in to weight on the home screen: turning it off reaches the widgets at once (privacy). */
  setWeightAllowed(allowed: boolean): void;
  /** Send what is kept now (the app goes to the background), unthrottled. */
  flush(): void;
  /** Forget every part (the data was erased): nothing is sent until a new part arrives. */
  reset(): void;
  /** What would be sent now (tests, diagnostics). */
  current(): WidgetSnapshot;
  dispose(): void;
}

/**
 * Keeps the latest parts and sends a snapshot at most once per `throttleMs` (the first at once, later ones at the end
 * of the window); an identical snapshot is not sent again until `refreshMs` has passed. Nothing is sent before the
 * first part arrives, nor before quiet mode is known (`setQuiet`), so a figure never leaves while the setting is still
 * unread.
 */
export function createWidgetPublisher(o: WidgetPublisherOptions): WidgetPublisher {
  const now = o.now ?? Date.now;
  const throttle = o.throttleMs ?? WIDGET_THROTTLE_MS;
  const refresh = o.refreshMs ?? WIDGET_REFRESH_MS;
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let quiet: boolean | null = null;
  let today: WidgetToday | null = null;
  let ring: WidgetRing | null = null;
  let body: WidgetBody | null = null;
  let weightAllowed = false;
  let touched = false;
  let lastKey: string | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  let disposed = false;

  const snapshot = (): WidgetSnapshot => sanitizeSnapshot({ v: 1, at: now(), quiet: quiet ?? true, today, ring, body }, { weight: weightAllowed });
  const keyOf = (s: WidgetSnapshot) => JSON.stringify({ ...s, at: 0 });

  /**
   * A setting that decides what may be on the home screen (quiet mode on, weight off) changed before this session
   * published anything: what the phone still holds was published under the other setting. Replace it with a snapshot of
   * no figure at all (the widgets then ask for the app) rather than leave figures the setting no longer allows.
   */
  const sendEmpty = () => {
    if (disposed) return;
    lastKey = null;
    try {
      void Promise.resolve(o.send({ v: 1, at: now(), quiet: quiet ?? true, today: null, ring: null })).catch(() => undefined);
    } catch {
      /* an older shell: nothing to do */
    }
  };

  const send = (force: boolean) => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (disposed || !touched || quiet === null) return;
    const s = snapshot();
    const key = keyOf(s);
    if (!force && key === lastKey && s.at - lastAt < refresh) return;
    lastKey = key;
    lastAt = s.at;
    try {
      void Promise.resolve(o.send(s)).catch(() => undefined);
    } catch {
      /* an older shell: nothing to do */
    }
  };

  const schedule = () => {
    if (disposed) return;
    touched = true;
    const wait = lastAt + throttle - now();
    if (wait <= 0) return send(false);
    if (timer === null) timer = setTimer(() => send(false), wait);
  };

  return {
    setQuiet(q) {
      if (q === quiet) return;
      const was = quiet;
      quiet = q;
      // leaving or entering quiet mode reaches the home screen at once (privacy); the first answer is not a change
      if (touched) send(true);
      else if (was !== null) sendEmpty();
    },
    setToday(part) {
      today = part && today && part.date === today.date ? { ...today, ...part } : part;
      schedule();
    },
    setRing(part) {
      ring = part;
      schedule();
    },
    setBody(part) {
      body = part;
      schedule();
    },
    setWeightAllowed(allowed) {
      if (allowed === weightAllowed) return;
      weightAllowed = allowed;
      // turning weight off (or on) reaches the home screen at once
      if (touched) send(true);
      else if (!allowed) sendEmpty();
    },
    flush: () => send(true),
    reset() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      today = null;
      ring = null;
      body = null;
      touched = false;
      lastKey = null;
      lastAt = Number.NEGATIVE_INFINITY;
    },
    current: snapshot,
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}

// ------------------------------------------------------------------------------------------------ the app's publisher

let shared: WidgetPublisher | null = null;

/** The app's publisher, bound to the plugin; null outside the Android app. */
export function widgetPublisher(): WidgetPublisher | null {
  const plugin = vitalsWidgets();
  if (!plugin) return null;
  shared ??= createWidgetPublisher({ send: (snapshot) => vitalsWidgets()?.publish({ snapshot }) });
  return shared;
}

const noop = () => {};

function listen(plugin: VitalsWidgetsPlugin, event: 'open' | 'pause', cb: () => void): () => void {
  let off = false;
  let handle: ListenerHandle | null = null;
  const drop = (h: ListenerHandle) => void Promise.resolve().then(() => h.remove()).catch(noop);
  try {
    void Promise.resolve(plugin.addListener(event, () => !off && cb())).then(
      (h) => (off ? drop(h) : (handle = h)),
      noop,
    );
  } catch {
    /* an older shell */
  }
  return () => {
    if (off) return;
    off = true;
    if (handle) drop(handle);
  };
}

/**
 * Publish what is kept whenever the app goes to the background (the native pause, and the page turning hidden). The
 * returned function stops it.
 */
export function startWidgetFlushOnPause(): () => void {
  const plugin = vitalsWidgets();
  const pub = widgetPublisher();
  if (!plugin || !pub) return noop;
  const stopPause = listen(plugin, 'pause', () => pub.flush());
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') pub.flush();
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    stopPause();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * A widget tap: `open(path)` with the screen it asked for (the router's navigate port checks it is a screen of the app).
 * Takes what is waiting now (a cold start), then again on each `open` event. The returned function stops it.
 */
export function onWidgetOpen(open: (path: string) => unknown): () => void {
  const plugin = vitalsWidgets();
  if (!plugin) return noop;
  let off = false;
  const take = () =>
    void Promise.resolve()
      .then(() => plugin.takeOpen())
      .then((r) => {
        const path = typeof r?.path === 'string' ? r.path : null;
        if (!off && path && path.startsWith('/') && !path.startsWith('//')) open(path);
      })
      .catch(noop);
  const stop = listen(plugin, 'open', take);
  take();
  return () => {
    off = true;
    stop();
  };
}

/** Forget the snapshot on this phone (erased data, an unpaired server): the widgets ask for the app again. */
export async function clearWidgets(): Promise<void> {
  shared?.reset();
  try {
    await vitalsWidgets()?.clear();
  } catch {
    /* an older shell */
  }
}

/** Tests: forget the cached plugin and publisher. */
export function resetWidgetsForTests(): void {
  shared?.dispose();
  shared = null;
  cached = null;
}
