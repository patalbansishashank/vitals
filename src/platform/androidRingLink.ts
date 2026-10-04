/*
 * The Android side of the ring link (SUITE_SPEC §15.7), owned by L-ANDROID. Watches the ring service's statuses and
 * turns them into what the phone shows: the foreground service with its "Ring connected" notification (which keeps the
 * app, and so the ring link in this WebView, alive with the screen off), "Ring battery low" once per charge, and "Ring
 * disconnected" after 10 minutes without the ring. Also hands the boot receiver its two facts (setRingPrefs).
 *
 * Nothing on the web: installAndroidShell() calls this only in the Android app.
 */
import { androidShell, clearNotice, requestNotificationPermission, setRingPrefs } from './androidShell';

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
}

export const BATTERY_LOW_AT = 15;
/** Battery must climb past this (or the ring go on its charger) before "battery low" can show again. */
const BATTERY_RESET_ABOVE = 20;
export const DISCONNECTED_AFTER_MS = 10 * 60_000;
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

export interface RingLinkOptions {
  keepConnected?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/** Start watching; returns the stop function. */
export function installAndroidRingLink(source: RingLinkSource, opts: RingLinkOptions = {}): () => void {
  const shell = androidShell();
  const keepConnected = opts.keepConnected ?? keepConnectedSetting;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));

  let keepAliveText: string | null = null; // what the service shows now; null = not running
  let prefs = '';
  let askedNotifications = false;
  let everLinked = false;
  const batteryWarned = new Set<string>();
  const linked = new Set<string>();
  const lostTimers = new Map<string, unknown>();
  const disconnectWarned = new Set<string>();

  const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);

  function update(rings: RingLinkView[]): void {
    const keep = keepConnected();
    const nextPrefs = `${keep}|${rings.length > 0}`;
    if (nextPrefs !== prefs) {
      prefs = nextPrefs;
      quiet(setRingPrefs({ keepConnected: keep, ringKnown: rings.length > 0 }));
    }

    for (const r of rings) {
      // battery low, once per charge
      if (r.battery !== undefined) {
        if (r.charging || r.battery > BATTERY_RESET_ABOVE) {
          if (batteryWarned.delete(r.ringKey)) quiet(clearNotice('battery_low'));
        } else if (r.battery <= BATTERY_LOW_AT && !batteryWarned.has(r.ringKey)) {
          batteryWarned.add(r.ringKey);
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
        if (disconnectWarned.delete(r.ringKey)) quiet(clearNotice('ring_disconnected'));
      } else if (linked.has(r.ringKey)) {
        linked.delete(r.ringKey);
        // the person pressed Disconnect, or another device took the ring: not a loss to warn about
        if (!r.paused && !NOT_OURS.has(r.state) && keep) {
          const key = r.ringKey;
          lostTimers.set(
            key,
            setTimer(() => {
              lostTimers.delete(key);
              if (linked.has(key)) return;
              disconnectWarned.add(key);
              quiet(shell.notify({ kind: 'ring_disconnected', title: 'Ring disconnected', text: 'Vitals has not reached your ring for 10 minutes. Keep it near your phone.' }));
            }, DISCONNECTED_AFTER_MS),
          );
        }
      }
    }
    for (const key of [...lostTimers.keys()]) {
      if (rings.some((r) => r.ringKey === key && !r.paused && !NOT_OURS.has(r.state))) continue;
      clearTimer(lostTimers.get(key));
      lostTimers.delete(key);
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

  update(source.rings());
  const off = source.subscribe(update);
  const offResume = shell.onResume(() => update(source.rings()));
  return () => {
    off();
    offResume();
    for (const t of lostTimers.values()) clearTimer(t);
    lostTimers.clear();
  };
}
