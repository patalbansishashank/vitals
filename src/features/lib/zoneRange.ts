/**
 * (0.6.3 A37) Heart-rate zone ranges in words, one rule everywhere (Settings › Heart rate, the activity sheet, the Ring's
 * workout and day zones): a zone holds its lower edge and not its upper one, where the next zone starts — "108 to under
 * 126 bpm"; the top zone ends at the maximum and includes it — "162–180 bpm". Pure.
 */
import type { ZoneBoundaries } from '@/living/sensors';

/** "108 to under 126 bpm", or for the top zone "162–180 bpm". */
export const bpmRangeText = (lo: number, hi: number, top = false): string => (top ? `${Math.round(lo)}–${Math.round(hi)} bpm` : `${Math.round(lo)} to under ${Math.round(hi)} bpm`);

/** "70 to under 80 %", or for the top zone "90–100 %". */
export const pctRangeText = (lo: number, hi: number, top = false): string => (top ? `${lo}–${hi} %` : `${lo} to under ${hi} %`);

/** The range of zone `z` (0-based, 0–4) from frozen boundaries. */
export function zoneBpmRange(b: Pick<ZoneBoundaries, 'edgesBpm'>, z: number): string {
  const e = b.edgesBpm;
  return bpmRangeText(e[z]!, e[z + 1]!, z === 4);
}

/** "over 180 bpm": supported time above the configured maximum (the top zone already includes the maximum itself). */
export const aboveMaxText = (b: Pick<ZoneBoundaries, 'edgesBpm'>): string => `over ${Math.round(b.edgesBpm[5])} bpm`;

/** (0.6.3 INT) Quiet mode names zones by words, never their numbers or ranges (aria too). */
export const ZONE_WORDS = ['Very light', 'Light', 'Moderate', 'Hard', 'Maximum'] as const;

/** "Moderate zone": zone `z` (0-based, 0–4) in quiet mode. */
export const quietZoneLabel = (z: number): string => `${ZONE_WORDS[z] ?? 'A'} zone`;

/** Quiet labels of the rows around the zones: under zone 1 and above the configured maximum. */
export const QUIET_ZONE_EDGES = { below: 'Below the zones', above: 'Above your maximum' } as const;

/** A state strip's zone words in quiet mode (index 0 = under zone 1, then zones 1–5). */
export const QUIET_ZONE_STATES: readonly string[] = [QUIET_ZONE_EDGES.below, ...ZONE_WORDS.map((_, z) => quietZoneLabel(z))];
