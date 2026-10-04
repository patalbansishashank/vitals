/*
 * The Android shell bridge (SUITE_SPEC §15.7, §15.8), owned by L-ANDROID: the web side of the native `VitalsShell`
 * plugin (Kotlin, apps/android). The plugin is reached through the global the Capacitor bridge injects
 * (`window.Capacitor`); the root app does not depend on @capacitor/core. Without the plugin (web, pwa, tests) every
 * call resolves and does nothing, and every listener is a no-op.
 */
import { netFetch } from '@/net/net';

/**
 * §15.8's `ShellBridge`, declared here with the same shape: L-WEB's `shell()` (src/platform/shell.ts) returns
 * `androidShell()` when the platform is android.
 */
export interface AndroidShellBridge {
  keepAlive(on: boolean, text: string): Promise<void>;
  notify(n: { kind: NoticeKind; title: string; text: string }): Promise<void>;
  onBluetoothState(cb: (on: boolean) => void): () => void;
  onResume(cb: () => void): () => void;
  /**
   * Whether Android may pause the app in the background (it is not on the battery allow list), and a way to open the
   * system screen that lets the person allow it. Only there when the native plugin is.
   */
  batteryOptimisation?(): Promise<{ restricted: boolean; openSettings(): void }>;
}

export type NoticeKind = 'battery_low' | 'ring_disconnected';
export type LaunchReason = 'launcher' | 'boot' | 'bluetooth' | 'notification' | 'share';
export interface ShellState {
  bluetoothOn: boolean;
  notificationsAllowed: boolean;
  keepAliveOn: boolean;
  launchReason: LaunchReason;
}
/** A file shared to Vitals, already copied by the native side into the app's cache. */
export interface SharedFileEntry {
  name: string;
  mime: string;
  size: number;
  path: string;
}

interface ListenerHandle {
  remove(): Promise<void> | void;
}
/** The native plugin's methods (contract: .jobs/tmp/L-ANDROID.contract.md). */
export interface VitalsShellPlugin {
  keepAlive(o: { on: boolean; text?: string }): Promise<unknown>;
  notify(o: { kind: NoticeKind; title: string; text: string }): Promise<unknown>;
  clearNotice(o: { kind: NoticeKind }): Promise<unknown>;
  setPrefs(o: { keepConnected: boolean; ringKnown: boolean }): Promise<unknown>;
  getState(): Promise<ShellState>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  takeSharedFiles(): Promise<{ files: SharedFileEntry[] }>;
  saveFile(o: { name: string; mime: string; dataBase64: string }): Promise<unknown>;
  batteryOptimisation(): Promise<{ restricted: boolean }>;
  openBatterySettings(): Promise<unknown>;
  addListener(event: string, cb: (data: unknown) => void): Promise<ListenerHandle> | ListenerHandle;
}
/** The part of the injected `window.Capacitor` this module reads. */
export interface CapacitorGlobal {
  isNativePlatform?(): boolean;
  getPlatform?(): string;
  registerPlugin?(name: string): unknown;
  Plugins?: Record<string, unknown>;
  convertFileSrc?(path: string): string;
}

export function capacitor(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True inside the Android app (the native bridge is there). L-WEB's `detectPlatform()` decides the same way. */
export function onAndroid(): boolean {
  const cap = capacitor();
  return !!cap && cap.isNativePlatform?.() !== false && cap.getPlatform?.() === 'android';
}

// Capacitor warns when a plugin is registered twice, so the proxy is kept (per bridge object, which tests replace).
let cached: { cap: CapacitorGlobal; plugin: VitalsShellPlugin } | null = null;

/** The `VitalsShell` plugin, or null outside the Android app. Never return it from an async function: it is a Proxy. */
export function vitalsShell(): VitalsShellPlugin | null {
  const cap = capacitor();
  if (!cap || cap.getPlatform?.() !== 'android') return null;
  if (cached?.cap === cap) return cached.plugin;
  const plugin = (cap.registerPlugin?.('VitalsShell') ?? cap.Plugins?.VitalsShell) as VitalsShellPlugin | undefined;
  if (!plugin) return null;
  cached = { cap, plugin };
  return plugin;
}

const noop = () => {};

/** Subscribe to a plugin event; the returned function removes the listener (also when the handle arrives later). */
function listen(event: string, cb: (data: unknown) => void): () => void {
  const p = vitalsShell();
  if (!p) return noop;
  let off = false;
  let handle: ListenerHandle | null = null;
  const drop = (h: ListenerHandle) => void Promise.resolve().then(() => h.remove()).catch(noop);
  try {
    void Promise.resolve(p.addListener(event, (d) => !off && cb(d))).then(
      (h) => (off ? drop(h) : (handle = h)),
      () => console.warn(`Vitals: could not listen to the Android shell (${event}).`),
    );
  } catch {
    console.warn(`Vitals: could not listen to the Android shell (${event}).`);
  }
  return () => {
    if (off) return;
    off = true;
    if (handle) drop(handle);
  };
}

const codeOf = (e: unknown): unknown => (e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined);

// One warning until keepAlive works again: the ring service calls it on every status change.
let permissionWarned = false;
// Codes keepAlive reports for "Android will not run the service now": warned about, never thrown at the ring service.
const KEEP_ALIVE_REFUSED = new Set(['permission', 'not_allowed']);

const bridge: AndroidShellBridge = {
  async keepAlive(on, text) {
    const p = vitalsShell();
    if (!p) return;
    try {
      await p.keepAlive(text ? { on, text } : { on });
      permissionWarned = false;
    } catch (e) {
      if (!KEEP_ALIVE_REFUSED.has(codeOf(e) as string)) throw e;
      if (!permissionWarned) console.warn('Vitals: Android did not start the ring notification (Bluetooth permission missing, or the app is in the background).');
      permissionWarned = true;
    }
  },
  async notify(n) {
    await vitalsShell()?.notify({ kind: n.kind, title: n.title, text: n.text });
  },
  onBluetoothState: (cb) => listen('bluetoothState', (d) => cb(!!(d as { on?: unknown } | null)?.on)),
  onResume: (cb) => listen('resume', () => cb()),
};

const batteryBridge: AndroidShellBridge = {
  ...bridge,
  async batteryOptimisation() {
    const p = vitalsShell();
    if (!p) return { restricted: false, openSettings: noop };
    const r = await p.batteryOptimisation();
    return {
      restricted: !!r?.restricted,
      openSettings: () => {
        const warn = () => console.warn('Vitals: could not open the Android battery settings.');
        try {
          void Promise.resolve(p.openBatterySettings()).catch(warn);
        } catch {
          warn();
        }
      },
    };
  },
};

/** The §15.8 bridge over `VitalsShell`; every call is a no-op without the plugin (and `batteryOptimisation` is absent). */
export function androidShell(): AndroidShellBridge {
  return vitalsShell() ? batteryBridge : bridge;
}

/* ------------------------------------------------------------------ Android-only helpers */

/** Remove the notification of one kind ("Ring battery low", "Ring disconnected"). */
export async function clearNotice(kind: NoticeKind): Promise<void> {
  await vitalsShell()?.clearNotice({ kind });
}

/** What the boot and Bluetooth-on receivers read: start the ring link only when both are true. */
export async function setRingPrefs(prefs: { keepConnected: boolean; ringKnown: boolean }): Promise<void> {
  await vitalsShell()?.setPrefs({ keepConnected: prefs.keepConnected, ringKnown: prefs.ringKnown });
}

/** Ask for POST_NOTIFICATIONS (Android 13+). False without the plugin. */
export async function requestNotificationPermission(): Promise<boolean> {
  const p = vitalsShell();
  if (!p) return false;
  const r = await p.requestNotificationPermission();
  return !!r?.granted;
}

/** Bluetooth, notifications, the foreground service and why the app was started; null without the plugin. */
export async function getShellState(): Promise<ShellState | null> {
  const p = vitalsShell();
  if (!p) return null;
  const s = await p.getState();
  return { ...s };
}

/** Write a file to the app's cache and open the system share sheet (the Android way to save or send a file). */
export async function saveFile(file: { name: string; mime: string; dataBase64: string }): Promise<void> {
  await vitalsShell()?.saveFile({ name: file.name, mime: file.mime, dataBase64: file.dataBase64 });
}

/** The app was started after a phone restart (fired once, when the first listener is added). */
export function onBootCompleted(cb: () => void): () => void {
  return listen('bootCompleted', () => cb());
}

async function readShared(cap: CapacitorGlobal, f: SharedFileEntry): Promise<File | null> {
  if (typeof cap.convertFileSrc !== 'function' || typeof f?.path !== 'string') return null;
  try {
    const res = await netFetch(cap.convertFileSrc(f.path));
    if (!res.ok) return null;
    const blob = await res.blob();
    return new File([blob], f.name || 'shared-file', { type: f.mime || blob.type });
  } catch {
    return null;
  }
}

/**
 * Files shared to Vitals ("Share to Vitals", opening a file with Vitals): drains what is waiting now, then again on each
 * `sharedFiles` event. Taking clears the native list, so there should be one subscriber (the intake, androidIntake.ts).
 * `onUnreadable` hears how many shared files could not be read (or taken at all, with the number 1).
 */
export function onSharedFiles(cb: (files: File[]) => void, onUnreadable?: (count: number) => void): () => void {
  const p = vitalsShell();
  const cap = capacitor();
  if (!p || !cap) return noop;
  let off = false;
  let chain: Promise<void> = Promise.resolve();
  const drain = () => {
    chain = chain
      .then(async () => {
        if (off) return;
        const r = await p.takeSharedFiles();
        const entries = Array.isArray(r?.files) ? r.files : [];
        const files = (await Promise.all(entries.map((f) => readShared(cap, f)))).filter((f): f is File => f !== null);
        const lost = entries.length - files.length;
        if (lost > 0) {
          console.warn(`Vitals: ${lost} shared file(s) could not be read.`);
          if (!off) onUnreadable?.(lost);
        }
        if (!off && files.length) cb(files);
      })
      .catch(() => {
        console.warn('Vitals: could not take the shared files.');
        if (!off) onUnreadable?.(1);
      });
  };
  const stop = listen('sharedFiles', drain);
  drain();
  return () => {
    off = true;
    stop();
  };
}

/** Tests: forget the cached plugin and the warning state. */
export function resetAndroidShellForTests(): void {
  cached = null;
  permissionWarned = false;
}
