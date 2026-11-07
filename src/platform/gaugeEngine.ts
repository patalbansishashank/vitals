/*
 * The ring engine on this phone, Android app only (r070): the web side of the native `GaugeEngine` plugin (Kotlin,
 * apps/android). Gauge's engine moved into Vitals: it talks to the ring over Bluetooth, reads Health Connect, counts
 * short videos and uploads to the person's home server. While the separate Gauge app is still installed the engine is
 * `passive` (Gauge owns the ring); after Gauge is uninstalled it is taken over (`needsTakeover` → `active`).
 *
 * Reached through the global the Capacitor bridge injects, like the other plugins here (`androidShell.ts`): the root app
 * does not depend on @capacitor/core. On the web, the PWA and the desktop there is no plugin: `gaugeEngine()` is null and
 * `engineStub` answers "not available" so a caller can use one code path.
 *
 * This file is the contract. Change it together with the native side.
 */
import { capacitor } from './androidShell';

export type Perm = 'granted' | 'denied' | 'partial' | 'unavailable';
export type EngineMode = 'passive' | 'active' | 'needsTakeover';
export type RingConnection = 'none' | 'scanning' | 'connecting' | 'connected' | 'disconnected';
export type RuntimePermission = 'bluetooth' | 'healthConnect' | 'activityRecognition' | 'notifications';
export type MeasureKind = 'hr' | 'spo2' | 'hrv' | 'temp' | 'stress';

export interface EngineState {
  /** passive while Gauge is installed */
  mode: EngineMode;
  gauge: { installed: boolean; pendingUploads: number | null };
  ring: {
    state: RingConnection;
    name?: string;
    address?: string;
    battery?: number;
    lastSyncAt?: string;
    lastError?: string;
    /** Presence and auth state only; the credential itself never crosses back into JavaScript. */
    credentialConfigured?: boolean;
    credentialRequired?: boolean;
    credentialRejected?: boolean;
    /** True only after this connection accepted the credential; absent on older native builds. */
    credentialAuthenticated?: boolean;
  };
  permissions: {
    bluetooth: Perm;
    healthConnect: Perm;
    activityRecognition: Perm;
    notifications: Perm;
    shortVideoAccessibility: boolean;
    /**
     * (r071) Android holds the short-video counter back until it is allowed in Vitals' App info (the "restricted setting" of an
     * app that came onto the phone as a file): true when it does or this install is the kind it holds back, false when it does
     * not, absent when the phone does not say. Only asked while the counter is off.
     */
    shortVideoRestricted?: boolean;
    batteryUnrestricted: boolean;
  };
  upload: { paired: boolean; pending: number; lastSentAt?: string; lastError?: string };
  shortVideo: { enabled: boolean; dailyLimit: number | null; today: { instagram: number; youtube: number } };
}

export interface GaugeEnginePlugin {
  getState(): Promise<EngineState>;
  addListener(event: 'state', cb: (s: EngineState) => void): Promise<{ remove(): Promise<void> }>;
  configure(o: { serverUrl: string; deviceToken: string }): Promise<void>;
  uninstallGauge(): Promise<void>;
  takeOver(): Promise<EngineState>;
  requestPermissions(o: { which: RuntimePermission[] }): Promise<EngineState>;
  openAccessibilitySettings(): Promise<void>;
  /** (r071) Vitals' own App info page: ⋮ › Allow restricted settings is there. Nothing is allowed from the app. */
  openAppInfo(): Promise<void>;
  openBatterySettings(): Promise<void>;
  scanRings(): Promise<{ devices: Array<{ name: string; address: string; rssi: number }> }>;
  connectRing(o: { address: string }): Promise<EngineState>;
  forgetRing(): Promise<EngineState>;
  syncNow(): Promise<EngineState>;
  measure(o: { kind: MeasureKind }): Promise<{ started: boolean }>;
  setShortVideoLimit(o: { dailyLimit: number | null }): Promise<EngineState>;
}

/** The part of the injected `window.Capacitor` this module reads. */
interface Bridge {
  getPlatform?(): string;
  isNativePlatform?(): boolean;
  isPluginAvailable?(name: string): boolean;
  registerPlugin?(name: string): unknown;
  Plugins?: Record<string, unknown>;
}

export const ENGINE_PLUGIN = 'GaugeEngine';

// Capacitor warns when a plugin is registered twice, so the proxy is kept (per bridge object, which tests replace).
let cached: { cap: object; plugin: GaugeEnginePlugin } | null = null;

/** The `GaugeEngine` plugin, or null outside the Android app (or on a shell without it). Never return it from an async function: it is a Proxy. */
export function gaugeEngine(): GaugeEnginePlugin | null {
  const cap = capacitor() as Bridge | undefined;
  if (!cap || cap.getPlatform?.() !== 'android') return null;
  if (cap.isPluginAvailable && !cap.isPluginAvailable(ENGINE_PLUGIN)) return null;
  if (cached?.cap === cap) return cached.plugin;
  const plugin = (cap.registerPlugin?.(ENGINE_PLUGIN) ?? cap.Plugins?.[ENGINE_PLUGIN]) as
    GaugeEnginePlugin | undefined;
  if (!plugin) return null;
  cached = { cap, plugin };
  return plugin;
}

/** True when this device has the engine (the Android app with the plugin). */
export const engineAvailable = (): boolean => gaugeEngine() !== null;

export function resetGaugeEngineForTests(): void {
  cached = null;
}

/** What the stub (and the store before the first answer) reports: nothing, and every permission unavailable. */
export const UNAVAILABLE_STATE: EngineState = Object.freeze({
  mode: 'passive',
  gauge: { installed: false, pendingUploads: null },
  ring: { state: 'none' },
  permissions: {
    bluetooth: 'unavailable',
    healthConnect: 'unavailable',
    activityRecognition: 'unavailable',
    notifications: 'unavailable',
    shortVideoAccessibility: false,
    batteryUnrestricted: false,
  },
  upload: { paired: false, pending: 0 },
  shortVideo: { enabled: false, dailyLimit: null, today: { instagram: 0, youtube: 0 } },
}) as EngineState;

export class EngineUnavailableError extends Error {
  readonly code = 'unavailable';
  constructor() {
    super('The ring engine is only in the Android app.');
    this.name = 'EngineUnavailableError';
  }
}

const unavailable = () => Promise.reject(new EngineUnavailableError());

/** The plugin on the web and desktop: reads say "not available", every action rejects, listeners do nothing. */
export const engineStub: GaugeEnginePlugin = {
  getState: () => Promise.resolve(UNAVAILABLE_STATE),
  addListener: () => Promise.resolve({ remove: () => Promise.resolve() }),
  configure: unavailable,
  uninstallGauge: unavailable,
  takeOver: unavailable,
  requestPermissions: unavailable,
  openAccessibilitySettings: unavailable,
  openAppInfo: unavailable,
  openBatterySettings: unavailable,
  scanRings: unavailable,
  connectRing: unavailable,
  forgetRing: unavailable,
  syncNow: unavailable,
  measure: unavailable,
  setShortVideoLimit: unavailable,
};

/** The real plugin, or the stub. */
export const gaugeEngineOrStub = (): GaugeEnginePlugin => gaugeEngine() ?? engineStub;

/* ---- small helpers ----------------------------------------------------------------------------------------------- */

export const isEnginePerm = (p: Perm): boolean => p === 'granted';

/** Every runtime permission the ring needs, in the order the checklist shows them. */
export const RUNTIME_PERMISSIONS: readonly RuntimePermission[] = [
  'bluetooth',
  'healthConnect',
  'activityRecognition',
  'notifications',
];

export type PermissionKey = RuntimePermission | 'shortVideoAccessibility' | 'batteryUnrestricted';

/** The six things the ring needs from the phone, in checklist order. */
export const PERMISSION_KEYS: readonly PermissionKey[] = [
  ...RUNTIME_PERMISSIONS,
  'shortVideoAccessibility',
  'batteryUnrestricted',
];

/** How one permission stands: granted, partly granted, or not (an `unavailable` one cannot be granted here). */
export function permissionOk(s: EngineState, key: PermissionKey): boolean {
  const v = s.permissions[key];
  return typeof v === 'boolean' ? v : v === 'granted';
}

/** The permissions not yet given. The short-video one counts only when the limit is on (it is optional otherwise). */
export function permissionsMissing(s: EngineState): PermissionKey[] {
  return PERMISSION_KEYS.filter(
    (k) => !permissionOk(s, k) && (k !== 'shortVideoAccessibility' || s.shortVideo.enabled),
  );
}

/**
 * (r071) Whether to show the "allow it first" guide for the short-video counter (`RestrictedGuide`): the counter is off, it is
 * wanted (the limit is on, or the person just went to the Accessibility settings to turn it on), and Android is known or likely
 * to hold it back (`shortVideoRestricted`) or the person went there (`asked`) and it is still off. Never when the phone says it is
 * not held back, nor when the counter is on.
 */
export function showAllowGuide(s: EngineState, asked: boolean): boolean {
  const p = s.permissions;
  if (p.shortVideoAccessibility || p.shortVideoRestricted === false) return false;
  if (!s.shortVideo.enabled && !asked) return false;
  return p.shortVideoRestricted === true || asked;
}

/** The `which` list for a runtime permission still to ask for. */
export const isRuntimePermission = (k: PermissionKey): k is RuntimePermission =>
  (RUNTIME_PERMISSIONS as readonly string[]).includes(k);

/** The words the ring's connection state gets. */
export const RING_STATE_WORD: Record<RingConnection, string> = {
  none: 'No ring',
  scanning: 'Looking for the ring',
  connecting: 'Connecting',
  connected: 'Connected',
  disconnected: 'Disconnected',
};

export type RingCredentialIssue = 'missing' | 'rejected' | null;

/** A Bluetooth link can be connected while its readings remain locked by ring authentication. */
export function ringCredentialIssue(s: EngineState): RingCredentialIssue {
  if (s.mode !== 'active' || !s.ring.credentialRequired) return null;
  if (s.ring.credentialRejected) return 'rejected';
  return s.ring.credentialConfigured ? null : 'missing';
}

/** A current Bluetooth link is still waiting for the ring to accept the stored code. */
export function ringAuthenticationPending(s: EngineState): boolean {
  return s.mode === 'active'
    && s.ring.state === 'connected'
    && s.ring.credentialRequired === true
    && s.ring.credentialConfigured === true
    && !s.ring.credentialRejected
    && s.ring.credentialAuthenticated === false;
}

/** A connected link may not yet be allowed to read or measure ring data. */
export function ringDataReady(s: EngineState): boolean {
  return s.ring.state === 'connected' && ringCredentialIssue(s) === null && !ringAuthenticationPending(s);
}

/** The message of any rejection from the plugin, kept short and plain. */
export function engineErrorText(e: unknown): string {
  const m =
    e instanceof Error
      ? e.message
      : typeof e === 'object' && e !== null && 'message' in e
        ? String((e as { message: unknown }).message)
        : '';
  return (m || 'The ring engine could not do that.').slice(0, 200);
}
