/*
 * The Android side of the ring link (SUITE_SPEC §15.7), owned by L-ANDROID. Watches the ring service's statuses and
 * turns them into what the phone shows: the foreground service with its "Ring connected" notification (which keeps the
 * app, and so the ring link in this WebView, alive with the screen off), "Ring battery low" once per charge, and "Ring
 * disconnected" after 10 minutes without the ring. Also hands the boot receiver its two facts (setRingPrefs).
 *
 * With the screen off the CPU sleeps and this WebView's timers count only awake time, so the ring service's own sync
 * timer never comes due. The native side wakes the phone every BACKGROUND_READ_EVERY_MS while the foreground service
 * runs (`ringTick`, wake lock held): this reads every ring that is this device's to keep (`syncNow`), gives sync a
 * moment to upload, checks "ring disconnected" by the wall clock, and lets the phone sleep again (`ringTickDone`).
 *
 * Nothing on the web: installAndroidShell() calls this only in the Android app.
 */
import {
  androidShell,
  clearNotice,
  getShellState,
  onRingTick,
  requestNotificationPermission,
  ringTickDone,
  setRingPrefs,
  setRingTick,
} from './androidShell';

/** The part of a ring status (src/biometrics/service, RingStatus) this module reads. */
export interface RingLinkView {
  ringKey: string;
  state: string;
  battery?: number;
  charging?: boolean;
  paused?: boolean;
}
/** The part of the ring service this module reads. */
export interface RingLinkSource {
  rings(): RingLinkView[];
  subscribe(cb: (rings: RingLinkView[]) => void): () => void;
  /** Read the ring now (history since the last read), reconnecting first when the link is down. */
  syncNow?(ringKey: string): Promise<void>;
}

export const BATTERY_LOW_AT = 15;
/** Battery must climb past this (or the ring go on its charger) before "battery low" can show again. */
const BATTERY_RESET_ABOVE = 20;
export const DISCONNECTED_AFTER_MS = 10 * 60_000;
/** How often the ring is read with the screen off: the ring service's own sync interval (SYNC_EVERY_MS). */
export const BACKGROUND_READ_EVERY_MS = 30 * 60_000;
/** QA only: minutes between background reads instead of BACKGROUND_READ_EVERY_MS (the phone test uses 5). */
export const BACKGROUND_READ_MINUTES_KEY = 'vitals.ring.backgroundReadMinutes';
/** One ring read in a tick may take this long (a full history read takes ~35 s on the phone)… */
export const TICK_READ_TIMEOUT_MS = 100_000;
/** …and all reads of one tick together this long, so the upload grace still fits in the native wake lock (3 min). */
export const TICK_READS_BUDGET_MS = 140_000;
/** After the reads, the wake lock is kept this long so sync can upload what was read. */
export const TICK_UPLOAD_GRACE_MS = 30_000;
/** Ring settings' "Keep my ring connected" switch (L-PAGES), on unless set to '0'. */
export const KEEP_CONNECTED_KEY = 'vitals.ring.keepConnected';

const LINKED = new Set(['connected', 'syncing']);
/** States in which the ring is not this device's to keep: nothing to keep alive and nothing to warn about. */
const NOT_OURS = new Set(['elsewhere', 'unsupported']);

function keepConnectedSetting(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEEP_CONNECTED_KEY) !== '0';
  } catch {
    return true;
  }
}

function backgroundReadEveryMs(): number {
  try {
    const minutes = Number(globalThis.localStorage?.getItem(BACKGROUND_READ_MINUTES_KEY));
    if (Number.isFinite(minutes) && minutes >= 1) return Math.round(minutes * 60_000);
  } catch {
    // no storage: the default
  }
  return BACKGROUND_READ_EVERY_MS;
}

export interface RingLinkOptions {
  keepConnected?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  /** Wall clock (the tick's "ring disconnected" check). */
  now?: () => number;
  /** Waits inside a tick (read timeout, upload grace); tests pass an instant one. */
  sleep?: (ms: number) => Promise<void>;
}

/** Start watching; returns the stop function. */
export function installAndroidRingLink(source: RingLinkSource, opts: RingLinkOptions = {}): () => void {
  const shell = androidShell();
  const keepConnected = opts.keepConnected ?? keepConnectedSetting;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let keepAliveText: string | null = null; // what the service shows now; null = not running
  let prefs = '';
  let askedNotifications = false;
  let everLinked = false;
  const batteryWarned = new Set<string>(); // warned this charge, not re-armed yet
  const batteryShown = new Set<string>(); // its notice is up (one notice per kind: cleared when the last one goes)
  const linked = new Set<string>();
  const lostTimers = new Map<string, unknown>();
  const lostSince = new Map<string, number>(); // wall time the link went, for the tick's check
  const disconnectWarned = new Set<string>();

  const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);

  /** The link has been gone for 10 minutes (timer, or the tick's wall-clock check): warn once until it is back. */
  function warnLost(key: string): void {
    const t = lostTimers.get(key);
    if (t !== undefined) clearTimer(t);
    lostTimers.delete(key);
    lostSince.delete(key);
    if (linked.has(key) || disconnectWarned.has(key) || !keepConnected()) return;
    disconnectWarned.add(key);
    quiet(shell.notify({ kind: 'ring_disconnected', title: 'Ring disconnected', text: 'Vitals has not reached your ring for 10 minutes. Keep it near your phone.' }));
  }

  function update(rings: RingLinkView[]): void {
    const keep = keepConnected();
    const nextPrefs = `${keep}|${rings.length > 0}`;
    if (nextPrefs !== prefs) {
      prefs = nextPrefs;
      quiet(setRingPrefs({ keepConnected: keep, ringKnown: rings.length > 0 }));
    }

    for (const r of rings) {
      // battery low, once per charge. A charger contact that flaps at a low level does not re-arm it: the ring must
      // climb past the low mark while charging, or past the reset level.
      if (r.battery !== undefined) {
        if (r.charging || r.battery > BATTERY_RESET_ABOVE) {
          if (r.battery > BATTERY_LOW_AT) batteryWarned.delete(r.ringKey);
          if (batteryShown.delete(r.ringKey) && batteryShown.size === 0) quiet(clearNotice('battery_low'));
        } else if (r.battery <= BATTERY_LOW_AT && !batteryWarned.has(r.ringKey)) {
          batteryWarned.add(r.ringKey);
          batteryShown.add(r.ringKey);
          quiet(shell.notify({ kind: 'battery_low', title: 'Ring battery low', text: `${r.battery} % left. Put your ring on its charger.` }));
        }
      }

      // disconnected for 10 minutes, once until it comes back
      if (LINKED.has(r.state)) {
        everLinked = true;
        linked.add(r.ringKey);
        const t = lostTimers.get(r.ringKey);
        if (t !== undefined) clearTimer(t);
        lostTimers.delete(r.ringKey);
        lostSince.delete(r.ringKey);
        if (disconnectWarned.delete(r.ringKey) && disconnectWarned.size === 0) quiet(clearNotice('ring_disconnected'));
      } else if (linked.has(r.ringKey)) {
        linked.delete(r.ringKey);
        // the person pressed Disconnect, or another device took the ring: not a loss to warn about
        if (!r.paused && !NOT_OURS.has(r.state) && keep) {
          const key = r.ringKey;
          lostSince.set(key, now());
          lostTimers.set(
            key,
            setTimer(() => warnLost(key), DISCONNECTED_AFTER_MS),
          );
        }
      }
    }
    // a ring that is gone from the list (forgotten): drop what it left behind
    const present = new Set(rings.map((r) => r.ringKey));
    for (const key of [...linked, ...batteryWarned, ...batteryShown, ...disconnectWarned, ...lostTimers.keys()]) {
      if (present.has(key)) continue;
      linked.delete(key);
      batteryWarned.delete(key);
      if (batteryShown.delete(key) && batteryShown.size === 0) quiet(clearNotice('battery_low'));
      if (disconnectWarned.delete(key) && disconnectWarned.size === 0) quiet(clearNotice('ring_disconnected'));
    }
    for (const key of [...lostTimers.keys()]) {
      if (rings.some((r) => r.ringKey === key && !r.paused && !NOT_OURS.has(r.state))) continue;
      clearTimer(lostTimers.get(key));
      lostTimers.delete(key);
      lostSince.delete(key);
    }

    // the foreground service: from the first connection on (Android needs the Bluetooth permission granted before it
    // starts), for as long as a ring is this device's to keep, including while it reconnects
    const active = rings.filter((r) => !r.paused && !NOT_OURS.has(r.state));
    const want = keep && everLinked && active.length > 0;
    const text = !want
      ? null
      : active.some((r) => r.state === 'syncing')
        ? 'Reading your ring…'
        : active.some((r) => r.state === 'connected')
          ? 'Ring connected'
          : 'Looking for your ring…';
    if (text !== keepAliveText) {
      if (text && !askedNotifications) {
        askedNotifications = true;
        quiet(requestNotificationPermission());
      }
      keepAliveText = text;
      quiet(shell.keepAlive(text !== null, text ?? ''));
    }
  }

  // Android may have refused the service (Bluetooth permission not granted yet, or the app was in the background): the
  // bridge only warns, so when the person is back, ask again if the service is not running.
  async function resync(): Promise<void> {
    const text = keepAliveText;
    if (text === null) return;
    const state = await getShellState().catch(() => null);
    if (state && !state.keepAliveOn && keepAliveText === text) quiet(shell.keepAlive(true, text));
  }

  // The background read. One at a time: a tick that comes while one runs is left to it.
  let reading = false;
  async function onTick(): Promise<void> {
    if (reading) return;
    reading = true;
    try {
      for (const [key, since] of [...lostSince]) if (now() - since >= DISCONNECTED_AFTER_MS) warnLost(key);
      const read = source.syncNow?.bind(source);
      if (read && keepConnected()) {
        // the rings this device keeps: not paused by the person, not another device's; a running read finishes itself
        const ours = source.rings().filter((r) => !r.paused && !NOT_OURS.has(r.state));
        const until = now() + TICK_READS_BUDGET_MS;
        for (const r of ours) {
          if (r.state === 'syncing') continue;
          const left = Math.min(TICK_READ_TIMEOUT_MS, until - now());
          if (left <= 0) break;
          await Promise.race([read(r.ringKey).catch(() => undefined), sleep(left)]);
        }
        // also when a read was already running: it gets the same time to finish and upload under the wake lock
        if (ours.length > 0) await sleep(TICK_UPLOAD_GRACE_MS);
      }
    } finally {
      reading = false;
      quiet(ringTickDone());
    }
  }
  quiet(setRingTick(backgroundReadEveryMs()));
  const offTick = onRingTick(() => void onTick());

  update(source.rings());
  const off = source.subscribe(update);
  const offResume = shell.onResume(() => {
    update(source.rings());
    void resync();
  });
  return () => {
    off();
    offResume();
    offTick();
    for (const t of lostTimers.values()) clearTimer(t);
    lostTimers.clear();
  };
}
