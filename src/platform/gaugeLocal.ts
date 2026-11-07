/*
 * Gauge's workout control on this phone, Android app only (energy SPEC §A.4 item 10): the web side of the native
 * `VitalsGauge` plugin (Kotlin, apps/android: VitalsGaugePlugin). The plugin sends an explicit ordered broadcast to
 * `<package>/com.pulseloop.ui.tile.WorkoutControlReceiver` (`com.pulseloop`, and `com.pulseloop.debug` in a Vitals debug
 * build), holding `<package>.permission.CONTROL_WORKOUT`, and maps Gauge's result to the same ack shape as the server
 * channel (§A.4 item 9), so callers see the transport only as `via`.
 *
 * Feature-detected like `androidUpdates.ts`: an older Android shell has no `VitalsGauge` plugin (its calls reject), so
 * Vitals sends every command through the server and `minNativeVersionCode` is not raised. Nothing here on the web,
 * the PWA or the desktop.
 */
import { capacitor } from './androidShell';

export type LocalWorkoutCommand = 'workout.start' | 'workout.pause' | 'workout.resume' | 'workout.stop' | 'workout.status';
export type LocalAckStatus = 'done' | 'rejected' | 'failed' | 'noop';

/** The plugin's answer: an ack like the server channel's, or a timeout (no answer from Gauge in time). */
export type LocalWorkoutAnswer =
  | { status: LocalAckStatus; code?: string; result?: Record<string, unknown> }
  | { status: 'timeout' };

export interface VitalsGaugeInfo {
  /** The Gauge package this build talks to, or null when none is installed. */
  package: string | null;
  installed: string[];
  /** `<package>.permission.CONTROL_WORKOUT` is granted. */
  granted: boolean;
}

export interface VitalsGaugePlugin {
  info(): Promise<VitalsGaugeInfo>;
  /** Asks for `<package>.permission.CONTROL_WORKOUT` (protection level dangerous: a system prompt). */
  requestPermission(): Promise<VitalsGaugeInfo>;
  /** `activityTypeId` (0.6.3 S26): the catalogue activity, sent as Gauge's `activity_type_id` extra (an older shell drops it). */
  workout(o: { command: LocalWorkoutCommand; type?: string; useGps?: boolean; activityTypeId?: string; sessionId?: string; timeoutMs: number }): Promise<LocalWorkoutAnswer>;
  /**
   * (r063 FX3, S20) After a start that fell back to no GPS: Gauge's location prompt (Gauge 2.8.1 `GRANT_LOCATION`), or the
   * phone's location settings for `gps_location_off`. An older shell has no such method (the call rejects).
   */
  fixGps?(o: { warning?: string }): Promise<{ opened: boolean }>;
}

/** `WORKOUT_STATUS` must answer within this for the local path to be used (§A.4 item 10). */
export const LOCAL_PROBE_MS = 1500;
/** A workout command's own answer (a start brings up Gauge's foreground service). */
export const LOCAL_COMMAND_MS = 5000;

let cached: { cap: object; plugin: VitalsGaugePlugin } | null = null;

/** The `VitalsGauge` plugin, or null outside the Android app. Never return it from an async function: it is a Proxy. */
export function vitalsGauge(): VitalsGaugePlugin | null {
  const cap = capacitor() as (ReturnType<typeof capacitor> & { isPluginAvailable?(name: string): boolean }) | undefined;
  if (!cap || cap.getPlatform?.() !== 'android') return null;
  if (cap.isPluginAvailable && !cap.isPluginAvailable('VitalsGauge')) return null;
  if (cached?.cap === cap) return cached.plugin;
  const plugin = (cap.registerPlugin?.('VitalsGauge') ?? cap.Plugins?.VitalsGauge) as VitalsGaugePlugin | undefined;
  if (!plugin) return null;
  cached = { cap, plugin };
  return plugin;
}

export function resetGaugeLocalForTests(): void {
  cached = null;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve('timeout');
      },
    );
  });

/** What the plugin says about Gauge on this phone; null outside the app or on an older shell. */
export async function gaugeLocalInfo(): Promise<VitalsGaugeInfo | null> {
  const plugin = vitalsGauge();
  if (!plugin) return null;
  try {
    return await plugin.info();
  } catch {
    return null;
  }
}

/**
 * Ask for the control permission (the agent taps the prompt through adb in tests). Only on the person's own action: the
 * Record sheet's "Allow Vitals to control Gauge on this phone" key (0.6.3 S4/A23).
 */
export async function requestGaugeControl(): Promise<VitalsGaugeInfo | null> {
  const plugin = vitalsGauge();
  if (!plugin) return null;
  try {
    return await plugin.requestPermission();
  } catch {
    return null;
  }
}

/**
 * (r063 FX3, S20) Open what fixes a recording without GPS (only on the person's tap): true when it opened, false when it
 * could not (no Gauge, an older shell), null outside the Android app.
 */
export async function openGaugeGpsFix(warning?: string): Promise<boolean | null> {
  const plugin = vitalsGauge();
  if (!plugin) return null;
  try {
    if (typeof plugin.fixGps !== 'function') return false;
    return (await plugin.fixGps(warning ? { warning } : {})).opened === true;
  } catch {
    return false;
  }
}

/** (r063 FX3, S20) Whether this device can open Gauge's location prompt itself (the Android app with Gauge installed). */
export function canOpenGaugeGpsFix(): boolean {
  return vitalsGauge() !== null;
}

/**
 * The local path is usable when all hold: the plugin is there, a Gauge package is installed, `CONTROL_WORKOUT` is
 * granted, and a `WORKOUT_STATUS` answer arrives within 1.5 s.
 */
export async function probeGaugeLocal(timeoutMs = LOCAL_PROBE_MS): Promise<boolean> {
  const plugin = vitalsGauge();
  if (!plugin) return false;
  const info = await withTimeout(plugin.info(), timeoutMs);
  if (info === 'timeout' || !info.package || !info.granted) return false;
  const status = await withTimeout(plugin.workout({ command: 'workout.status', timeoutMs }), timeoutMs + 250);
  return status !== 'timeout' && status.status === 'done';
}

/** The state each workout command asks for. */
const ASKED: Record<Exclude<LocalWorkoutCommand, 'workout.status'>, string> = {
  'workout.start': 'recording',
  'workout.pause': 'paused',
  'workout.resume': 'recording',
  'workout.stop': 'idle',
};

export type LocalRun = { kind: 'ack'; status: LocalAckStatus; code?: string; result?: Record<string, unknown> } | { kind: 'fallback' };

/**
 * Run one workout command locally. After a timeout it asks `WORKOUT_STATUS` once and adopts the asked state when it
 * is reached (`done`, with that status); otherwise the caller falls back to the server with the same command id
 * (safe: workout commands are idempotent by state).
 */
export async function runLocalWorkout(
  command: Exclude<LocalWorkoutCommand, 'workout.status'>,
  payload: { type?: string; useGps?: boolean; activityTypeId?: string; sessionId?: string },
  o: { timeoutMs?: number; probeMs?: number } = {},
): Promise<LocalRun> {
  const plugin = vitalsGauge();
  if (!plugin) return { kind: 'fallback' };
  const timeoutMs = o.timeoutMs ?? LOCAL_COMMAND_MS;
  const args = {
    command, timeoutMs,
    ...(payload.type !== undefined ? { type: payload.type } : {}),
    ...(payload.useGps !== undefined ? { useGps: payload.useGps } : {}),
    ...(command === 'workout.start' && payload.activityTypeId !== undefined ? { activityTypeId: payload.activityTypeId } : {}),
    ...(payload.sessionId !== undefined ? { sessionId: payload.sessionId } : {}),
  };
  const answer = await withTimeout(plugin.workout(args), timeoutMs + 500);
  if (answer !== 'timeout' && answer.status !== 'timeout') {
    return { kind: 'ack', status: answer.status, ...(answer.code ? { code: answer.code } : {}), ...(answer.result ? { result: answer.result } : {}) };
  }
  const probeMs = o.probeMs ?? LOCAL_PROBE_MS;
  const status = await withTimeout(plugin.workout({ command: 'workout.status', timeoutMs: probeMs }), probeMs + 250);
  if (status !== 'timeout' && status.status === 'done' && status.result?.state === ASKED[command]) {
    return { kind: 'ack', status: 'done', code: 'adopted', result: status.result };
  }
  return { kind: 'fallback' };
}

/* ---- (r069 sync) Gauge's data on this phone ---------------------------------------------------------------------- */

/**
 * What Gauge says about its data on this phone (Gauge 2.8.7 `VitalsLocalProvider`, read through the plugin's `local`
 * method): its upload queue and the ring's own count of today's steps. Gauge answers only Vitals' release-signed app
 * (it checks the caller's package and signing certificate), and the plugin talks only to a Gauge signed with the owner's
 * pinned certificate. Counts and times only; never a reading series.
 */
export interface GaugeLocalSnapshot {
  schema: 1;
  /** When Gauge answered (ISO). */
  at: string;
  /** Gauge's version name. */
  app: string | null;
  upload: {
    paired: boolean;
    /** Readings queued on the phone, not yet on the server. */
    pending: number;
    /** Gauge's last upload the server took (ISO). */
    lastSentAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
    /** A server Retry-After: no upload before this (ISO). */
    retryAt: string | null;
    /** The server refused the token: Gauge must be paired again. */
    needsRepair: boolean;
  };
  /** The ring's own count of the phone's today (Gauge's `activity_daily`, never fused), null when none. */
  today: { date: string; ringSteps: number | null; ringStepsAt: string | null } | null;
}

export interface VitalsGaugeLocalPlugin {
  /** `snapshot`: the state now; `flush`: ask Gauge to upload now, then the state. An older shell has no such method. */
  local?(o: { method: 'snapshot' | 'flush' }): Promise<{ json?: string; error?: string }>;
}

const isoOrNull = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const countOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/** Gauge's answer, checked field by field; null when it is not a schema-1 snapshot. */
export function localSnapshotOf(json: string | null | undefined): GaugeLocalSnapshot | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const u = r.upload as Record<string, unknown> | undefined;
  const at = isoOrNull(r.at);
  if (r.schema !== 1 || !at || typeof u !== 'object' || u === null) return null;
  const t = r.today as Record<string, unknown> | null | undefined;
  const date = t && typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null;
  return {
    schema: 1,
    at,
    app: typeof r.app === 'string' ? r.app.slice(0, 40) : null,
    upload: {
      paired: u.paired === true,
      pending: countOf(u.pending) ?? 0,
      lastSentAt: isoOrNull(u.lastSentAt),
      lastError: typeof u.lastError === 'string' ? u.lastError.slice(0, 200) : null,
      lastErrorAt: isoOrNull(u.lastErrorAt),
      retryAt: isoOrNull(u.retryAt),
      needsRepair: u.needsRepair === true,
    },
    today: date && t ? { date, ringSteps: countOf(t.ringSteps), ringStepsAt: isoOrNull(t.ringStepsAt) } : null,
  };
}

/** A local answer must come quickly: this runs when the app comes to the front. */
export const LOCAL_READ_MS = 2000;

async function local(method: 'snapshot' | 'flush'): Promise<GaugeLocalSnapshot | null> {
  const plugin = vitalsGauge() as (VitalsGaugePlugin & VitalsGaugeLocalPlugin) | null;
  if (!plugin || typeof plugin.local !== 'function') return null;
  const answer = await withTimeout(plugin.local({ method }), LOCAL_READ_MS);
  if (answer === 'timeout' || !answer || answer.error) return null;
  return localSnapshotOf(answer.json);
}

/** Gauge's state on this phone; null outside the Android app, on an older shell or Gauge, or when Gauge refused. */
export function readGaugeLocal(): Promise<GaugeLocalSnapshot | null> {
  return local('snapshot');
}

/** Ask Gauge on this phone to upload what it holds now (no network wait here); its state after asking, or null. */
export function flushGaugeLocal(): Promise<GaugeLocalSnapshot | null> {
  return local('flush');
}
