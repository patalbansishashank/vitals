/**
 * Settings › Heart rate, pure (energy SPEC §V4.7, §V2.1, D6): the profile the settings make (V2 `hrProfile`), the zones it
 * would freeze into the next approved workout (V2 `freezeZoneBoundaries`), the measured upward HRmax suggestion (V2
 * `suggestHrMaxRaise`, shown until the person accepts or declines it) and the words that say how each value was made.
 */
import { freezeZoneBoundaries, hrProfile, suggestHrMaxRaise, type HrMaxEvidenceBout, type HrMaxSuggestion, type HrProfile, type Ms, type ZoneBoundaries } from '@/living/sensors';
import type { HeartSettings } from './v3Adapter';

export function profileOf(s: HeartSettings, ageY: number | null, sleepingLowHr: number | null): HrProfile {
  return hrProfile({
    ageY,
    hrMaxOverride: s.hrProfile.hrMaxOverride ?? null,
    hrRestOverride: s.hrProfile.hrRestOverride ?? null,
    sleepingLowHr,
    proxySleepLowOptIn: s.hrProfile.useSleepLowAsRest,
  });
}

export interface ZoneRow {
  zone: 1 | 2 | 3 | 4 | 5;
  /** bpm, rounded; the upper edge belongs to the zone above (Z5 includes 100 %). */
  fromBpm: number;
  toBpm: number;
  fromPct: number;
  toPct: number;
}

/** Five rows from frozen boundaries: Z1 [50, 60) … Z5 [90, 100] % of the basis. */
export function zoneRows(b: ZoneBoundaries | null): ZoneRow[] {
  if (!b) return [];
  const e = b.edgesBpm;
  return ([1, 2, 3, 4, 5] as const).map((z) => ({ zone: z, fromBpm: Math.round(e[z - 1]!), toBpm: Math.round(e[z]!), fromPct: 40 + 10 * z, toPct: 50 + 10 * z }));
}

export const zonesOf = (p: HrProfile): ZoneBoundaries | null => freezeZoneBoundaries(p);

/** The suggestion to show: V2's, unless the person declined that value (or a higher one) already. */
export function suggestionOf(p: HrProfile, bouts: readonly HrMaxEvidenceBout[], now: Ms, declinedBpm: number | null): HrMaxSuggestion | null {
  const s = suggestHrMaxRaise(p, bouts, now);
  if (!s) return null;
  if (declinedBpm !== null && s.suggestedBpm <= declinedBpm) return null;
  return s;
}
