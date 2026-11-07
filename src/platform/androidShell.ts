/*
 * The Android shell bridge (SUITE_SPEC §15.7), owned by L-ANDROID: the web side of the native `VitalsShell` plugin
 * (Kotlin, apps/android): files shared to Vitals in, files saved through the share sheet out. The plugin is reached
 * through the global the Capacitor bridge injects (`window.Capacitor`); the root app does not depend on
 * @capacitor/core. Without the plugin (web, pwa, tests) every call resolves and does nothing, and every listener is a
 * no-op.
 */
import { netFetch } from '@/net/net';

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
/** The native plugin's methods. */
export interface VitalsShellPlugin {
  takeSharedFiles(): Promise<{ files: SharedFileEntry[] }>;
  saveFile(o: { name: string; mime: string; dataBase64: string }): Promise<unknown>;
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

/** Write a file to the app's cache and open the system share sheet (the Android way to save or send a file). */
export async function saveFile(file: { name: string; mime: string; dataBase64: string }): Promise<void> {
  await vitalsShell()?.saveFile({ name: file.name, mime: file.mime, dataBase64: file.dataBase64 });
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
 * `sharedFiles` event. Taking clears the native list, so there should be one subscriber. Nothing subscribes since the health-file
 * import went; a feature that accepts shared files hooks in here.
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

/** Tests: forget the cached plugin. */
export function resetAndroidShellForTests(): void {
  cached = null;
}
