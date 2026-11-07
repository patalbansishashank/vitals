/**
 * (r069 sync) Gauge's data reaches the screen as soon as it reaches the server, and the screen says honestly when Gauge
 * last sent.
 *
 * While the app is in front and paired, one request is held on the server's Gauge pulse (`GET /v1/gauge/pulse`, see
 * `@/net/gaugePulse`). When it answers that new readings landed, every Ring and Progress question on screen asks
 * again and Vitals runs its Gauge import (at most once every `PULSE_REFRESH_GAP_MS`; a burst of uploads is one
 * refresh at its end). The 5-minute import (`./gaugeImport`) stays as the safety net.
 *
 * On the Android app, coming to the front also asks Gauge on this phone to upload what it holds (`flushGaugeLocal`, the
 * plugin's local path): a phone that was dozing sends its queue at once, and the pulse brings it to the screen. The
 * snapshot Gauge answers (its queue, its last upload, the ring's count of today's steps) is kept here for the screens'
 * "Gauge sent" line and the steps the server has not had yet (`@/features/ring/localFill`).
 *
 * (r070) When the ring engine inside Vitals is active (`@/state/gaugeEngine`), it answers instead of Gauge's provider:
 * the same snapshot made from the engine's upload state, and no ring steps (the server's stand).
 */
import { pulseMovedData, gaugePulseApi, type GaugePulse, type GaugePulseAnswer } from '@/net/gaugePulse';
import { getServerClient } from '@/net/server';
import { notifyGaugeDataChanged } from '@/net/gaugeIdentity';
import { flushGaugeLocal, readGaugeLocal, type GaugeLocalSnapshot } from '@/platform/gaugeLocal';
import { engineActive, engineLocalSnapshot, refreshEngine } from './gaugeEngine';

/** A refresh driven by the pulse comes at most this often (a burst of uploads is one refresh). */
export const PULSE_REFRESH_GAP_MS = 30_000;
/** While in front, Gauge's local state is read again this often (an IPC call on the phone, no network). */
export const LOCAL_READ_EVERY_MS = 60_000;
/** After an error the pulse is asked again after this, doubling to `PULSE_RETRY_MAX_MS`. */
export const PULSE_RETRY_MS = 5_000;
export const PULSE_RETRY_MAX_MS = 60_000;
/** An older server without the route is asked again after this. */
export const PULSE_UNSUPPORTED_MS = 30 * 60_000;

export interface GaugeLive {
  /** The server's last pulse answer this session. */
  pulse: GaugePulse | null;
  /** Gauge's own state on this phone (Android app only), and when it was read (ms). */
  local: GaugeLocalSnapshot | null;
  localAt: number | null;
}

let live: GaugeLive = { pulse: null, local: null, localAt: null };
const listeners = new Set<() => void>();
const publish = (next: Partial<GaugeLive>) => {
  live = { ...live, ...next };
  for (const l of [...listeners]) l();
};

/** The pulse and the local snapshot now (a stable object until either changes). */
export function gaugeLive(): GaugeLive {
  return live;
}

export function onGaugeLive(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export interface GaugePulseDeps {
  pulse: (since: string | null, o: { wait?: number; signal?: AbortSignal }) => Promise<GaugePulseAnswer>;
  /** Import local history and derived context; concurrent pulse requests are coalesced. */
  refresh: (current: () => boolean) => Promise<void>;
  readLocal: () => Promise<GaugeLocalSnapshot | null>;
  flushLocal: () => Promise<GaugeLocalSnapshot | null>;
  visible: () => boolean;
  /** Calls back when the pairing changes; returns the unsubscribe. */
  onPairing: (fn: () => void) => () => void;
  isPaired: () => boolean;
  now: () => number;
}

async function defaultRefresh(current: () => boolean): Promise<void> {
  const { runGaugeImport } = await import('./gaugeImport');
  if (current()) await runGaugeImport({}, current);
  // A successful import still publishes its own completion: local derived context may have changed.
}

function defaultDeps(): GaugePulseDeps {
  return {
    pulse: (since, o) => gaugePulseApi.pulse(since, o),
    refresh: defaultRefresh,
    // (r070) once the engine runs the ring on this phone, its state answers; Gauge's 2.8.7 provider only while Gauge is installed
    readLocal: () => (engineActive() ? Promise.resolve(engineLocalSnapshot()) : readGaugeLocal()),
    flushLocal: async () => {
      if (!engineActive()) return flushGaugeLocal();
      await refreshEngine();
      return engineLocalSnapshot();
    },
    visible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
    onPairing: (fn) => getServerClient().subscribe(fn),
    isPaired: () => getServerClient().isPaired(),
    now: () => Date.now(),
  };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

let stopper: (() => void) | null = null;

/**
 * Holds the pulse while the app is in front and paired; reads (and, on coming to the front, flushes) Gauge on this
 * phone. Idempotent; returns the stop function.
 */
export function startGaugePulse(over: Partial<GaugePulseDeps> = {}): () => void {
  if (stopper) return stopper;
  const d = { ...defaultDeps(), ...over };
  let ctl: AbortController | null = null;
  let since: string | null = null;
  let lastRefreshAt = Number.NEGATIVE_INFINITY;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let localTimer: ReturnType<typeof setInterval> | null = null;
  let unsupportedUntil = 0;
  let pairingGeneration = 0;
  let importing: Promise<void> | null = null;
  let importAgain = false;
  let refreshGeneration = 0;

  const report = (e: unknown) => console.error('Vitals: Gauge refresh failed', e);
  const fire = () => {
    refreshTimer = null;
    lastRefreshAt = d.now();
    // Server reads need not wait for local reconciliation, even during a long import.
    notifyGaugeDataChanged();
    if (importing) { importAgain = true; return; }
    const gen = pairingGeneration;
    const refreshGen = refreshGeneration;
    const work = d.refresh(() => gen === pairingGeneration && refreshGen === refreshGeneration && d.visible() && d.isPaired()).catch(report);
    importing = work;
    void work.finally(() => {
      if (importing !== work) return;
      importing = null;
      if (gen !== pairingGeneration || !importAgain || !d.visible() || !d.isPaired()) return;
      importAgain = false;
      // A pulse arriving after the old import read detections must get a fresh read.
      // Reuse the same cadence; never retry merely because an import completed.
      refreshSoon();
    });
  };
  const refreshSoon = () => {
    if (refreshTimer) return;
    const wait = lastRefreshAt + PULSE_REFRESH_GAP_MS - d.now();
    if (wait <= 0) fire();
    else refreshTimer = setTimeout(fire, wait);
  };
  const takeLocal = (s: GaugeLocalSnapshot | null, gen: number) => {
    if (s && gen === pairingGeneration) publish({ local: s, localAt: d.now() });
  };
  const readLocal = () => {
    const gen = pairingGeneration;
    void d.readLocal().then((s) => takeLocal(s, gen), () => undefined);
  };

  async function loop(signal: AbortSignal) {
    let backoff = PULSE_RETRY_MS;
    while (!signal.aborted) {
      let r: GaugePulseAnswer;
      try {
        r = await d.pulse(since, { signal });
      } catch {
        return; // aborted
      }
      if (signal.aborted) return;
      if (!r.ok) {
        if (r.problem === 'not_paired' || r.problem === 'unauthorized') {
          since = null;
          publish({ pulse: null });
          return; // the pairing subscription starts it again
        }
        if (r.problem === 'not_supported') {
          unsupportedUntil = d.now() + PULSE_UNSUPPORTED_MS;
          return;
        }
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, PULSE_RETRY_MAX_MS);
        continue;
      }
      backoff = PULSE_RETRY_MS;
      const prev = live.pulse;
      since = r.pulse.token;
      publish({ pulse: r.pulse });
      if (pulseMovedData(prev, r.pulse)) refreshSoon();
      // Gauge sent something: its queue on this phone moved too
      if (prev && prev.uploads !== r.pulse.uploads) readLocal();
    }
  }

  const stop = () => {
    refreshGeneration++;
    importAgain = false;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    ctl?.abort();
    ctl = null;
    if (localTimer) clearInterval(localTimer);
    localTimer = null;
  };
  const begin = () => {
    if (ctl || !d.visible() || !d.isPaired() || d.now() < unsupportedUntil) return;
    const c = new AbortController();
    ctl = c;
    void loop(c.signal).finally(() => {
      if (ctl === c) ctl = null;
    });
  };
  const front = () => {
    if (!d.visible()) return stop();
    // the phone may have held Gauge's uploads while it dozed: ask Gauge to send now (the pulse brings it here)
    const gen = pairingGeneration;
    void d.flushLocal().then((s) => takeLocal(s, gen), () => undefined);
    if (!localTimer) localTimer = setInterval(readLocal, LOCAL_READ_EVERY_MS);
    begin();
  };
  const onVisible = () => front();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
    // the Android shell's own resume event (Capacitor fires it on the document), in case the WebView's visibility lags
    document.addEventListener('resume', onVisible);
  }
  const offPairing = d.onPairing(() => {
    // Direct replacement can remain paired throughout. Never send the previous server's cursor or show its status.
    pairingGeneration++;
    importing = null;
    stop();
    since = null;
    unsupportedUntil = 0;
    lastRefreshAt = Number.NEGATIVE_INFINITY;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    publish({ pulse: null, local: null, localAt: null });
    if (d.isPaired()) front();
  });
  front();
  stopper = () => {
    pairingGeneration++;
    stop();
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('resume', onVisible);
    }
    offPairing();
    stopper = null;
  };
  return stopper;
}

/** Tests: forget the pulse and the local state. */
export function resetGaugeLiveForTests(): void {
  stopper?.();
  live = { pulse: null, local: null, localAt: null };
}
