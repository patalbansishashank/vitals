/**
 * Social time (vitals-research/social-time/SPEC.md): the person's whole-app foreground time across a set of social apps,
 * from Android's Usage access, measured in seconds and dated per local day. It replaces the accessibility-based
 * short-video count. The web client is one method on the shared Gauge client (`socialTime`, added in `./gauge`), so it
 * shares the same cache, request limiter and freshness machinery as the other daily reads; this file holds the wire
 * types, the fixed app catalogue (keys are the wire/storage names: never rename) and the target band.
 *
 * Server route: `GET /v1/gauge/social-time?from=&to=&tz=` →
 *   { from, to, tz, days: [{ date, totalSeconds, perApp, targetMinMinutes, targetMaxMinutes }], source }
 *
 * `data` carries durations only, never content. Everything here is optional on the device side: a phone on the old
 * native app sends no social data, and desktop/web have no phone.
 */
/** A social app's stable key (the wire/storage name). A package maps to at most one key; keys are never renamed. */
export type SocialAppKey = 'instagram' | 'youtube' | 'facebook' | 'snapchat' | 'twitter' | 'reddit' | 'tiktok';

/** The common set (owner, 2026-11-16), editable in-app. `label` is what the UI shows; `packages` are the Android apps. */
export const SOCIAL_APPS: ReadonlyArray<{ key: SocialAppKey; label: string; packages: readonly string[] }> = [
  { key: 'instagram', label: 'Instagram', packages: ['com.instagram.android'] },
  { key: 'youtube', label: 'YouTube', packages: ['com.google.android.youtube'] },
  { key: 'facebook', label: 'Facebook', packages: ['com.facebook.katana'] },
  { key: 'snapchat', label: 'Snapchat', packages: ['com.snapchat.android'] },
  { key: 'twitter', label: 'X', packages: ['com.twitter.android'] },
  { key: 'reddit', label: 'Reddit', packages: ['com.reddit.frontpage'] },
  { key: 'tiktok', label: 'TikTok', packages: ['com.zhiliaoapp.musically', 'com.ss.android.ugc.trill'] },
] as const;

/** The app keys in catalogue order (the default enabled set is all of them). */
export const SOCIAL_APP_KEYS: readonly SocialAppKey[] = SOCIAL_APPS.map((a) => a.key);

/** A key's label, falling back to the key itself for anything the server sends that the catalogue does not know. */
export function socialAppLabel(key: string): string {
  return SOCIAL_APPS.find((a) => a.key === key)?.label ?? key;
}

/** The default daily target band, in minutes (editable in Settings). */
export const SOCIAL_TARGET_MIN_MINUTES = 30;
export const SOCIAL_TARGET_MAX_MINUTES = 45;

/** One day's social time (`perApp` holds only apps with time > 0 that day; seconds are integers). */
export interface GaugeSocialTimeDay {
  date: string;
  totalSeconds: number;
  perApp: Record<string, number>;
  targetMinMinutes: number;
  targetMaxMinutes: number;
}

/**
 * `gauge_social_time`: durations only, never content. `source` here is how the time was measured ("usage_access"), not a
 * Lumen provenance, so this response does not extend `GaugeProvenance`.
 */
export interface GaugeSocialTime {
  from: string;
  to: string;
  tz: string;
  days: GaugeSocialTimeDay[];
  source: string;
}
