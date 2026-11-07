/**
 * (r070) The ring engine's state on this phone, as a reactive store the screens read, and the actions they call.
 *
 * Android app only: `startGaugeEngine` (called once at boot, `installAndroidShell`) reads the plugin's state, listens to
 * its `state` events, re-reads when the app comes to the front (the person may have come back from a system screen:
 * uninstalling Gauge, a permission, battery settings), and hands the plugin the paired server's address and device token
 * (`configure`, again whenever the pairing changes). On the web and the desktop nothing starts: `available` stays false
 * and every Android-only control stays hidden.
 *
 * The token goes to the plugin only; it is never logged or kept here.
 */
import { getServerClient, SERVER_KEY } from '@/net/server';
import {
  engineErrorText,
  gaugeEngine,
  type EngineState,
  type GaugeEnginePlugin,
  type MeasureKind,
  type PermissionKey,
  type RuntimePermission,
  isRuntimePermission,
} from '@/platform/gaugeEngine';
import type { GaugeLocalSnapshot } from '@/platform/gaugeLocal';
import { useSyncExternalStore } from 'react';

export interface EngineSnapshot {
  /** The plugin is there (the Android app with the engine). */
  available: boolean;
  /** The engine's last answer; null until the first one. */
  state: EngineState | null;
  /** When `state` arrived (ms). */
  at: number | null;
  /** Actions in flight, by key (`takeOver`, `permission:bluetooth`, `sync`, …). */
  busy: readonly string[];
  /** The last action that failed, in words. Cleared when the next action starts. */
  error: { action: string; message: string } | null;
  /** The plugin has the server address and token (false until `configure` resolved; without a pairing it stays false). */
  configured: boolean;
  /**
   * (r071) The person was sent to the Accessibility settings to turn the short-video counter on, and it is not on since. It
   * lets the "allow it first" guide show for a phone that does not say whether Android holds the counter back.
   */
  accessAsked: boolean;
}

const INITIAL: EngineSnapshot = {
  available: false,
  state: null,
  at: null,
  busy: [],
  error: null,
  configured: false,
  accessAsked: false,
};
let snap: EngineSnapshot = INITIAL;
const listeners = new Set<() => void>();
const publish = (next: Partial<EngineSnapshot>) => {
  snap = { ...snap, ...next };
  // the counter is on: the question of how to turn it on is over
  if (snap.accessAsked && snap.state?.permissions.shortVideoAccessibility)
    snap = { ...snap, accessAsked: false };
  for (const l of [...listeners]) l();
};

/** The engine's state now (a stable object until it changes). */
export const engineSnapshot = (): EngineSnapshot => snap;

export function onEngine(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The engine's state in a component. */
export function useGaugeEngine(): EngineSnapshot {
  return useSyncExternalStore(onEngine, engineSnapshot, engineSnapshot);
}

/** The engine runs the ring on this phone (Gauge is gone and taken over). */
export const engineActive = (s: EngineSnapshot = snap): boolean => s.available && s.state?.mode === 'active';

/**
 * (r070) The engine's upload state in the shape Gauge's 2.8.7 provider used (`GaugeLocalSnapshot`), so "Gauge sent hh:mm"
 * and the readings waiting on the phone come from the engine when it is active. Null when it is not: Gauge's own
 * provider answers then. The engine has no ring step count of its own here, so `today` is null (the server's steps stand).
 */
export function engineLocalSnapshot(s: EngineSnapshot = snap): GaugeLocalSnapshot | null {
  if (!engineActive(s) || !s.state || s.at === null) return null;
  const u = s.state.upload;
  return {
    schema: 1,
    at: new Date(s.at).toISOString(),
    app: null,
    upload: {
      paired: u.paired,
      pending: u.pending,
      lastSentAt: u.lastSentAt ?? null,
      lastError: u.lastError ?? null,
      lastErrorAt: null,
      retryAt: null,
      needsRepair: false,
    },
    today: null,
  };
}

/* ---- credentials ------------------------------------------------------------------------------------------------- */

export interface EngineCredentials {
  serverUrl: string;
  deviceToken: string;
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** The paired server's address and this device's token, or null when not paired. Never logged. */
export function pairedCredentials(): EngineCredentials | null {
  try {
    const raw = localStorage.getItem(SERVER_KEY);
    const p: unknown = raw ? JSON.parse(raw) : null;
    if (typeof p !== 'object' || p === null) return null;
    const o = p as Record<string, unknown>;
    return nonEmpty(o.baseUrl) && nonEmpty(o.token) ? { serverUrl: o.baseUrl, deviceToken: o.token } : null;
  } catch {
    return null;
  }
}

/* ---- the loop ---------------------------------------------------------------------------------------------------- */

export interface EngineDeps {
  plugin: () => GaugeEnginePlugin | null;
  credentials: () => EngineCredentials | null;
  /** Calls back when the pairing changes; returns the unsubscribe. */
  onPairing: (fn: () => void) => () => void;
  visible: () => boolean;
  now: () => number;
}

const defaultDeps = (): EngineDeps => ({
  plugin: gaugeEngine,
  credentials: pairedCredentials,
  onPairing: (fn) => getServerClient().subscribe(fn),
  visible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
  now: () => Date.now(),
});

let current: GaugeEnginePlugin | null = null;
let stopper: (() => void) | null = null;
// Bridge calls and an explicit detach share one queue, including across a stopped/restarted web listener.
let configurationTail: Promise<void> = Promise.resolve();
let detachCurrent: (() => Promise<void>) | null = null;
const EMPTY_IDENTITY: EngineCredentials = { serverUrl: '', deviceToken: '' };
function serializeConfiguration(work: () => Promise<void>): Promise<void> {
  const next = configurationTail.then(work);
  configurationTail = next.catch(() => undefined);
  return next;
}

/** Stop native uploads before forgetting/erasing the web pairing. Ring acquisition and native history stay intact. */
export function clearGaugeEngineServer(): Promise<void> {
  if (detachCurrent) return detachCurrent();
  const plugin = gaugeEngine();
  return plugin ? serializeConfiguration(() => plugin.configure(EMPTY_IDENTITY)) : Promise.resolve();
}

/** Start reading the engine; idempotent; returns the stop function. A no-op where there is no plugin. */
export function startGaugeEngine(over: Partial<EngineDeps> = {}): () => void {
  if (stopper) return stopper;
  const d = { ...defaultDeps(), ...over };
  const plugin = d.plugin();
  // a shell that answers for any plugin name but is not the engine has no `getState`
  if (!plugin || typeof plugin.getState !== 'function') {
    publish({ available: false, state: null });
    return () => undefined;
  }
  current = plugin;
  publish({ available: true });
  let off = false;
  let handle: { remove(): Promise<void> } | null = null;
  let desiredKey: string | null | undefined;
  let appliedKey: string | null | undefined;
  let pending = 0;
  let latest: Promise<void> = Promise.resolve();
  // Erase can detach before its web keys are removed. A foreground event must not send those old keys again.
  let detached = false;

  const take = (s: EngineState) => {
    if (!off && s) publish({ state: s, at: d.now() });
  };
  const read = () => void plugin.getState().then(take, () => undefined);
  const setConfiguration = (credentials: EngineCredentials | null): Promise<void> => {
    const key = credentials ? `${credentials.serverUrl}\n${credentials.deviceToken}` : null;
    if (key === desiredKey && (appliedKey === key || pending > 0)) return latest;
    desiredKey = key;
    publish({ configured: false });
    pending++;
    latest = serializeConfiguration(async () => {
      // Coalesce obsolete queued targets; never overlap a clear with an older native pair request.
      if (off || desiredKey !== key || appliedKey === key) return;
      // A rejected bridge call may have saved an identity before failing. Its previous successful target is unknown.
      appliedKey = undefined;
      await plugin.configure(credentials ?? EMPTY_IDENTITY);
      appliedKey = key;
      if (!off && desiredKey === key) publish({ configured: key !== null });
    }).finally(() => { pending--; });
    return latest;
  };
  const configure = () => { void setConfiguration(detached ? null : d.credentials()).catch(() => undefined); };
  const detach = () => {
    detached = true;
    return setConfiguration(null);
  };
  detachCurrent = detach;

  void Promise.resolve(plugin.addListener('state', take)).then(
    (h) => (off ? void h.remove().catch(() => undefined) : (handle = h)),
    () => undefined,
  );
  read();
  configure();

  const onVisible = () => {
    if (!d.visible()) return;
    read();
    configure();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('resume', onVisible);
  }
  const offPairing = d.onPairing(() => { detached = false; configure(); });
  stopper = () => {
    off = true;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('resume', onVisible);
    }
    offPairing();
    if (detachCurrent === detach) detachCurrent = null;
    void handle?.remove().catch(() => undefined);
    handle = null;
    current = null;
    stopper = null;
  };
  return stopper;
}

/** Tests: stop the loop and forget everything. */
export function resetGaugeEngineStoreForTests(): void {
  stopper?.();
  current = null;
  snap = INITIAL;
}

/* ---- actions ----------------------------------------------------------------------------------------------------- */

/** Re-read the engine's state now. */
export async function refreshEngine(): Promise<void> {
  try {
    const s = await current?.getState();
    if (s) publish({ state: s, at: Date.now() });
  } catch {
    // keep what we have
  }
}

/**
 * Run one plugin call: its key shows as busy meanwhile, a returned state is taken, and a rejection becomes `error`
 * (words, not a throw) so a screen shows it where the person tapped. Resolves to the call's value, or undefined.
 */
export async function runEngine<T>(
  key: string,
  call: (p: GaugeEnginePlugin) => Promise<T>,
): Promise<T | undefined> {
  const p = current;
  if (!p) return undefined;
  publish({ busy: [...snap.busy.filter((k) => k !== key), key], error: null });
  try {
    const out = await call(p);
    if (out && typeof out === 'object' && 'mode' in out && 'permissions' in out)
      publish({ state: out as unknown as EngineState, at: Date.now() });
    return out;
  } catch (e) {
    publish({ error: { action: key, message: engineErrorText(e) } });
    return undefined;
  } finally {
    publish({ busy: snap.busy.filter((k) => k !== key) });
  }
}

export const isBusy = (s: EngineSnapshot, ...keys: string[]): boolean => keys.some((k) => s.busy.includes(k));

/** (r071) The Accessibility settings, where the short-video counter is switched on; remembers the person was sent there. */
function openAccessibility() {
  if (current) publish({ accessAsked: true });
  return runEngine('permission:shortVideoAccessibility', (p) => p.openAccessibilitySettings());
}

/** What the screens call. Each resolves when the plugin answered; failures land in the snapshot's `error`. */
export const engine = {
  uninstallGauge: () =>
    runEngine('uninstall', async (p) => (await p.uninstallGauge(), (await p.getState()) as EngineState)),
  takeOver: () => runEngine('takeOver', (p) => p.takeOver()),
  /** One permission, one tap: a runtime one asks; the two settings ones open the system screen. */
  fix: (k: PermissionKey) =>
    isRuntimePermission(k)
      ? runEngine(`permission:${k}`, (p) => p.requestPermissions({ which: [k as RuntimePermission] }))
      : k === 'shortVideoAccessibility'
        ? openAccessibility()
        : runEngine('permission:batteryUnrestricted', (p) => p.openBatterySettings()),
  /** (r071) Vitals' App info page, where the person allows restricted settings themselves (⋮ menu). */
  openAppInfo: () => runEngine('appInfo', (p) => p.openAppInfo()),
  scan: () => runEngine('scan', (p) => p.scanRings()),
  connect: (address: string) => runEngine('connect', (p) => p.connectRing({ address })),
  forget: () => runEngine('forget', (p) => p.forgetRing()),
  syncNow: () => runEngine('sync', (p) => p.syncNow()),
  measure: (kind: MeasureKind) => runEngine('measure', (p) => p.measure({ kind })),
  setLimit: (dailyLimit: number | null) => runEngine('limit', (p) => p.setShortVideoLimit({ dailyLimit })),
};
