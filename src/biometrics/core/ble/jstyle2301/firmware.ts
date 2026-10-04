/**
 * Version-specific semantics on top of the 2301 framing. Tier P. Port of the owner's `ring/JStyle2301FirmwareProfile.kt`.
 * An unknown revision keeps opaque values but never promotes them to HRV or named sleep stages.
 */

export type FirmwareProfileId = 'V0525' | 'V0789' | 'UNKNOWN';
export type SleepStageName = 'deep' | 'light' | 'rem' | 'awake' | 'unknown';

export interface FirmwareProfile {
  id: FirmwareProfileId;
  requiresAuthentication: boolean;
  /** Vendor raw HRV byte → ms, or null when the revision is not validated. */
  hrvMillis(raw: number): number | null;
  sleepStage(raw: number): SleepStageName;
  /** Activity-total exercise field (seconds) → whole active minutes, or null when unknown. */
  activeMinutes(exerciseDurationRawS: number): number | null;
  replacesActiveMinutes: boolean;
}

/**
 * HRV: owner's parity check, 399/399 timestamp-matched V0525 samples: vendor-app RMSSD == floor(raw / 2 + 5); V0789 2/2 post-OTA
 * samples agreed (raw 91 → 50 ms, raw 113 → 61 ms). Source: JStyle2301FirmwareProfile.kt comments (R10 §3.5).
 */
const hrvVendor = (raw: number): number => Math.floor(raw / 2) + 5;
/** Exercise field advances as seconds on V0525 (693 → 722 → 730 → 735) and V0789; whole minutes, never rounded up. */
const minutesFloor = (s: number): number => Math.min(Math.floor(s / 60), 0x7fffffff);

const V0525: FirmwareProfile = {
  id: 'V0525',
  requiresAuthentication: false,
  hrvMillis: hrvVendor,
  // 5 is the ordinary awake code; 11/12 occur only as the first minute of a V0525 packet and aligned with the vendor app's awake intervals.
  sleepStage: (raw) => (raw === 1 ? 'deep' : raw === 2 ? 'light' : raw === 3 ? 'rem' : raw === 5 || raw === 11 || raw === 12 ? 'awake' : 'unknown'),
  activeMinutes: minutesFloor,
  replacesActiveMinutes: true,
};

const V0789: FirmwareProfile = {
  id: 'V0789',
  requiresAuthentication: true,
  hrvMillis: hrvVendor,
  // Two consecutive vendor-app comparisons resolved 5 as awake; 10/11 are observed awake markers.
  sleepStage: (raw) => (raw === 1 ? 'deep' : raw === 2 ? 'light' : raw === 3 ? 'rem' : raw === 5 || raw === 10 || raw === 11 ? 'awake' : 'unknown'),
  activeMinutes: minutesFloor,
  replacesActiveMinutes: true,
};

const UNKNOWN: FirmwareProfile = {
  id: 'UNKNOWN',
  requiresAuthentication: false,
  hrvMillis: () => null,
  sleepStage: () => 'unknown',
  activeMinutes: () => null,
  replacesActiveMinutes: false,
};

/** `forRevision`: trims, upper-cases and strips a leading 'V'. */
export function firmwareProfile(revision: string | null | undefined): FirmwareProfile {
  const r = revision?.trim().toUpperCase();
  const bare = r?.startsWith('V') ? r.slice(1) : r;
  return bare === '0525' ? V0525 : bare === '0789' ? V0789 : UNKNOWN;
}
