/**
 * (social-time) Reading the ring engine's local social state on this phone, and the plugin actions the card and Settings
 * call. The native engineer adds `social` to the engine state and the matching plugin methods (`@/platform/gaugeEngine`,
 * which this feature does not edit): everything here is read and called defensively, since a phone on the old native app
 * sends no `social` field and an older plugin has none of the methods. On web and desktop there is no plugin at all.
 *
 * The engine's `social.today` is the instant provisional number (same rule as steps: the server is the source of truth,
 * the local value stands in only until the server has the day).
 */
import { gaugeEngine, type EngineState } from '@/platform/gaugeEngine';
import { refreshEngine, type EngineSnapshot } from '@/state/gaugeEngine';
import { SOCIAL_TARGET_MAX_MINUTES, SOCIAL_TARGET_MIN_MINUTES, type SocialAppKey } from '@/net/gaugeSocial';

/**
 * What a newer native app adds to the engine state (all optional; an older app sends none of it). `today` is this
 * phone's running total for the local day, `usageAccess` whether Android's Usage access is granted, and the rest the
 * person's in-app settings mirrored back.
 */
export interface EngineSocial {
  usageAccess: boolean;
  today: { date: string; totalSeconds: number; perApp: Record<string, number> } | null;
  targetMinMinutes: number;
  targetMaxMinutes: number;
  enabledApps: SocialAppKey[];
}

type StateWithSocial = EngineState & { social?: unknown };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

function perAppOf(v: unknown): Record<string, number> {
  if (!isObj(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) {
    const s = intOrNull(n);
    if (s !== null && s > 0) out[k] = s;
  }
  return out;
}

/** The engine's social state, field by field; null when the phone sends none (old app, or no engine here). */
export function socialOf(snap: EngineSnapshot): EngineSocial | null {
  const raw = (snap.state as StateWithSocial | null | undefined)?.social;
  if (!isObj(raw)) return null;
  const today = isObj(raw.today) && typeof raw.today.date === 'string'
    ? { date: raw.today.date, totalSeconds: intOrNull(raw.today.totalSeconds) ?? 0, perApp: perAppOf(raw.today.perApp) }
    : null;
  const apps = Array.isArray(raw.enabledApps) ? raw.enabledApps.filter((x): x is SocialAppKey => typeof x === 'string') : [];
  return {
    usageAccess: raw.usageAccess === true,
    today,
    targetMinMinutes: intOrNull(raw.targetMinMinutes) ?? SOCIAL_TARGET_MIN_MINUTES,
    targetMaxMinutes: intOrNull(raw.targetMaxMinutes) ?? SOCIAL_TARGET_MAX_MINUTES,
    enabledApps: apps,
  };
}

/** The plugin's social methods, surfaced by a newer native app; each may be absent, so every call is guarded. */
interface SocialPluginMethods {
  openUsageAccessSettings?(): Promise<void>;
  setSocialSettings?(o: { enabledApps?: string[]; targetMinMinutes?: number; targetMaxMinutes?: number }): Promise<unknown>;
}

const socialPlugin = (): SocialPluginMethods | null => gaugeEngine() as (SocialPluginMethods & object) | null;

/** True when this device can open the Usage access settings (the Android app with a plugin that exposes it). */
export function canOpenUsageAccess(): boolean {
  return typeof socialPlugin()?.openUsageAccessSettings === 'function';
}

/** Open Android's Usage access settings, if the plugin exposes it. Resolves whether or not it could. */
export async function openUsageAccessSettings(): Promise<void> {
  const p = socialPlugin();
  if (typeof p?.openUsageAccessSettings !== 'function') return;
  try {
    await p.openUsageAccessSettings();
  } catch {
    // the person stays on the card; the system screen simply did not open
  }
}

/** True when this device can change the social settings (apps, target) from here. */
export function canSetSocialSettings(): boolean {
  return typeof socialPlugin()?.setSocialSettings === 'function';
}

/** Change the person's social settings on the phone, if the plugin exposes it, then re-read the engine state. */
export async function setSocialSettings(o: { enabledApps?: SocialAppKey[]; targetMinMinutes?: number; targetMaxMinutes?: number }): Promise<void> {
  const p = socialPlugin();
  if (typeof p?.setSocialSettings !== 'function') return;
  try {
    await p.setSocialSettings(o);
  } catch {
    // keep what we have; the control reverts to the engine's own state on the next read
  }
  await refreshEngine();
}
