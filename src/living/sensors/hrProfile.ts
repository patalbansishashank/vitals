/**
 * HR profile (`hr-profile/1`, energy SPEC §V2.1, RESEARCH III.C, DECISION D6).
 *
 *  - HRmax: a user `override`, else Tanaka `208 − 0.7·age` (SD ≈ 10 bpm). Warrant: empirical-formal B (351-study
 *    meta-analysis, n = 18,712; lab validation n = 514); an individual's true maximum can sit 10-20 bpm either side, so it
 *    is a population default, neither a cap nor a measurement.
 *  - A measured UPWARD suggestion only: ≥ 3 quality bouts within 180 days whose sustained 30-s supported HR exceeds the
 *    current HRmax (P). It needs the person's confirmation; HRmax never moves down automatically (lack of a maximal effort
 *    is not evidence of a lower maximum; RESEARCH III.C).
 *  - HRrest: a WAKING value the person entered (`override`), else the nightly sleeping low only when the owner opted in
 *    (`proxySleepLow`, D6), else none. The sleeping low is stored and shown separately and is never silently HRrest.
 *  - Basis: `hrr` when HRrest exists and HRmax − HRrest ≥ 40 bpm (P validity guard), else `pctMax`. Warrant: analytically
 *    true A for the arithmetic (Swain & Leutholtz 1997: HRR tracks VO2 reserve); the zone edges are a display convention.
 *  - Each session freezes its boundaries at approval (`freezeZoneBoundaries`); a later profile change never rewrites it.
 */
import { SENSOR_VERSIONS, clipSegments, isFiniteNum, sp, type HrSegment, type Interval, type Ms } from './types';

export type HrMaxSource = 'override' | 'tanaka';
export type HrRestSource = 'override' | 'proxySleepLow';
export type ZoneBasis = 'hrr' | 'pctMax';

export interface HrProfileInput {
  ageY: number | null;
  /** A maximum the person set (from a test, a coach, or a confirmed suggestion). */
  hrMaxOverride?: number | null;
  /** A WAKING resting HR the person entered. */
  hrRestOverride?: number | null;
  /** The S2 "sleeping low HR" baseline (`sleepLowHr.median`), shown separately. */
  sleepingLowHr?: number | null;
  /** D6: use the sleeping low as an HRR proxy (opt-in only; default false). */
  proxySleepLowOptIn?: boolean;
}

export interface HrProfile {
  version: typeof SENSOR_VERSIONS.hrProfile;
  hrMax: { bpm: number; source: HrMaxSource; sdBpm: number | null } | null;
  hrRest: { bpm: number; source: HrRestSource } | null;
  /** Shown as "Sleeping low HR"; never a waking RHR. */
  sleepingLowHr: number | null;
  basis: ZoneBasis;
  /** Why the basis is %HRmax when it is (no waking rest, or a reserve under the guard). */
  basisReason: 'hrrAvailable' | 'noRestingHr' | 'reserveTooSmall' | 'noHrMax';
  /** True only when HRrest is a waking value the person entered (TRIMP needs it). */
  wakingRest: boolean;
}

/** Tanaka HRmax, bpm (208 − 0.7·age). NaN for a missing or non-positive age. */
export const tanakaHrMax = (ageY: number): number => (ageY > 0 ? sp('tanakaIntercept') - sp('tanakaSlope') * ageY : Number.NaN);

const plausibleBpm = (x: number | null | undefined): x is number => isFiniteNum(x) && x >= 25 && x <= 250;

export function hrProfile(i: HrProfileInput): HrProfile {
  const hrMax = plausibleBpm(i.hrMaxOverride)
    ? { bpm: i.hrMaxOverride, source: 'override' as const, sdBpm: null }
    : isFiniteNum(i.ageY) && i.ageY > 0
      ? { bpm: tanakaHrMax(i.ageY), source: 'tanaka' as const, sdBpm: sp('tanakaSdBpm') }
      : null;
  const sleepingLowHr = plausibleBpm(i.sleepingLowHr) ? i.sleepingLowHr : null;
  const hrRest = plausibleBpm(i.hrRestOverride)
    ? { bpm: i.hrRestOverride, source: 'override' as const }
    : i.proxySleepLowOptIn === true && sleepingLowHr !== null
      ? { bpm: sleepingLowHr, source: 'proxySleepLow' as const }
      : null;
  let basis: ZoneBasis = 'pctMax';
  let basisReason: HrProfile['basisReason'] = hrMax === null ? 'noHrMax' : 'noRestingHr';
  if (hrMax !== null && hrRest !== null) {
    if (hrMax.bpm - hrRest.bpm >= sp('hrrMinReserveBpm')) {
      basis = 'hrr';
      basisReason = 'hrrAvailable';
    } else basisReason = 'reserveTooSmall';
  }
  return { version: SENSOR_VERSIONS.hrProfile, hrMax, hrRest, sleepingLowHr, basis, basisReason, wakingRest: hrRest?.source === 'override' };
}

/** The frozen zone boundaries of one session (SPEC V2.1: frozen at approval, replayed unchanged). */
export interface ZoneBoundaries {
  zonesVersion: typeof SENSOR_VERSIONS.hrZones;
  basis: ZoneBasis;
  hrMax: number;
  /** Used only when basis is `hrr`. */
  hrRest: number | null;
  /** bpm at 50, 60, 70, 80, 90 and 100 % of the basis. */
  edgesBpm: readonly [number, number, number, number, number, number];
}

/** Fraction of the basis a heart rate represents (HRR: (HR − rest)/(max − rest); %max: HR/max). */
export function basisFraction(bpm: number, b: Pick<ZoneBoundaries, 'basis' | 'hrMax' | 'hrRest'>): number {
  if (b.basis === 'hrr' && b.hrRest !== null) return (bpm - b.hrRest) / (b.hrMax - b.hrRest);
  return bpm / b.hrMax;
}

/** Freeze a profile into session boundaries; null without an HRmax. */
export function freezeZoneBoundaries(p: HrProfile): ZoneBoundaries | null {
  if (p.hrMax === null) return null;
  const max = p.hrMax.bpm;
  const rest = p.basis === 'hrr' && p.hrRest ? p.hrRest.bpm : null;
  // rounded to 1e-6 bpm so a nominal edge (0.7 × 180 = 126) is exactly representable and owned by the zone above
  const at = (q: number) => Math.round((rest !== null ? rest + q * (max - rest) : q * max) * 1e6) / 1e6;
  return {
    zonesVersion: SENSOR_VERSIONS.hrZones,
    basis: rest !== null ? 'hrr' : 'pctMax',
    hrMax: max,
    hrRest: rest,
    edgesBpm: [at(0.5), at(0.6), at(0.7), at(0.8), at(0.9), at(1.0)],
  };
}

/**
 * Highest HR held for at least `holdS` seconds of contiguous supported time (the max over windows of the min HR inside).
 * Contiguous means each segment starts where the previous ended. Null when no contiguous run is that long.
 */
export function sustainedPeakBpm(segments: readonly HrSegment[], holdS: number = sp('hrMaxSustainS')): number | null {
  const s = clipSegments(segments, { start: -Infinity, end: Infinity });
  const need = holdS * 1000;
  let best: number | null = null;
  for (let i = 0; i < s.length; i++) {
    let covered = 0;
    let lo = Infinity;
    for (let j = i; j < s.length; j++) {
      if (j > i && s[j]!.start !== s[j - 1]!.end) break;
      covered += s[j]!.end - s[j]!.start;
      lo = Math.min(lo, s[j]!.bpm);
      if (covered >= need) {
        if (best === null || lo > best) best = lo;
        break;
      }
    }
  }
  return best;
}

/** One past bout considered for an HRmax suggestion. */
export interface HrMaxEvidenceBout {
  id: string;
  window: Interval;
  segments: readonly HrSegment[];
  /** Signal quality accepted (S2/Gauge quality flags, no motion artefact). */
  quality: boolean;
}

export interface HrMaxSuggestion {
  /** The suggested new HRmax: the value sustained ≥ 30 s in at least 3 of the qualifying bouts (the 3rd highest peak). */
  suggestedBpm: number;
  currentBpm: number;
  boutIds: string[];
  /** Always true: the person confirms; nothing changes automatically. */
  needsConfirmation: true;
}

/**
 * The measured upward suggestion of SPEC V2.1, or null. Only bouts with accepted quality that ended within 180 days of
 * `now` count; a bout counts when its sustained 30-s peak exceeds the current HRmax. Never a downward suggestion.
 */
export function suggestHrMaxRaise(current: HrProfile, bouts: readonly HrMaxEvidenceBout[], now: Ms): HrMaxSuggestion | null {
  if (current.hrMax === null) return null;
  const since = now - sp('hrMaxRaiseWindowDays') * 86_400_000;
  const peaks: Array<{ id: string; peak: number }> = [];
  for (const b of bouts) {
    if (!b.quality || b.window.end <= since || b.window.end > now) continue;
    const peak = sustainedPeakBpm(clipSegments(b.segments, b.window));
    if (peak !== null && peak > current.hrMax.bpm) peaks.push({ id: b.id, peak });
  }
  const need = sp('hrMaxRaiseBouts');
  if (peaks.length < need) return null;
  peaks.sort((a, b) => b.peak - a.peak);
  return { suggestedBpm: Math.round(peaks[need - 1]!.peak), currentBpm: current.hrMax.bpm, boutIds: peaks.map((p) => p.id), needsConfirmation: true };
}
