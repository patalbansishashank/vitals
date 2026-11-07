/**
 * Automatic activity detection `detect/2` (r065 autodetect CONTRACT §2; design `gpt-6.1-sol.md` §2, the more
 * conservative rule of `gpt-6-astra.md` where they differ). Pure: no store, no clock (the caller passes `nowMs`), no
 * time zone. `./features.ts` builds the minute evidence from the store, `./job.ts` runs it in the background and
 * `./episodes.ts` keeps the episodes' identity.
 *
 * Input: one entry per UTC minute. A null count is unknown, never zero: a phone zero is only `observed` (a listening
 * window with the step detector registered, no record), a coarse record (a counter span, the ring's ten-minute fallback)
 * never becomes a minute cadence. HR is the time-weighted mean over supported seconds (`hr-support/1`); a minute needs
 * at least 30 supported seconds to count.
 *
 * The detector finds bouts first and names them only as specifically as the evidence allows. Families, in order, each
 * taking its minutes away from the later ones (one episode per movement, competing labels as alternatives):
 *
 * 1. Masks: known sleep and Android `IN_VEHICLE` minutes are never part of a passive episode and never bridged (a
 *    diagnostic is kept when they hold activity-like counts).
 * 2. Cycling (AR-led): `ON_BICYCLE` minutes, ≥ 10 min, ≥ 70 % of the known recognition time, recognition known ≥ 50 %.
 * 3. Gait (phone-led): the phone's own minute cadence, never the fused headline. Walk ≥ 10 min with ≥ 80 % of minutes
 *    ≥ 60/min; run ≥ 6 min only with `RUNNING` recognition (≥ 60 % of the known time, median ≥ 140/min) or accepted GPS
 *    ≥ 2.8 m/s with median ≥ 150/min: high cadence alone stays a walk with `run` as an alternative. Then slow walking:
 *    ≥ 20 min, ≥ 90 % of minutes ≥ 40/min, steady cadence (1.4826·MAD/median ≤ 0.20).
 *    Setting: accepted stationary location → `treadmill_walk` / `treadmill_run`; accepted GPS movement → outdoor; steady
 *    phone cadence with the ring observed at ≤ 20 % of it (the hands-on-the-keyboard treadmill) and no location →
 *    `walk_possibly_treadmill` (missing GPS is never "indoors"); otherwise `walk` (location unknown).
 * 4. Ring bursts: ≥ 3 sets of 1–3 minutes at ≥ 40/min separated by 1–4 quiet minutes (≤ 10/min), ≥ 15 min, little
 *    phone walking, and a supported HR response → `possible_workout` with `possible_strength` as an alternative. Ring
 *    counts are a movement proxy, never repetitions; phone zero is never evidence for strength.
 * 5. Ring-only gait: steady ring ≥ 60/min for ≥ 10 min while the phone saw no gait (zero or unknown) →
 *    `possible_workout` with `walk` as an alternative (typing, cooking and tool use can do this; existence ≤ 0.59).
 * 6. GPS-only cycling: accepted 3–12 m/s for ≥ 15 min, the phone observed with low cadence, and a supported HR response
 *    → `possible_cycling` (existence ≤ 0.59, type ≤ 0.45).
 * 7. HR-led: ≥ 15 min of supported HR (≥ 30 s a minute, ≥ 70 % of the bout) above the threshold over a pre-bout awake
 *    baseline B (≥ 10 supported minutes in the 30 before), the steps observed low, a recovery within 30 min and at most
 *    2 h → `possible_workout` (existence ≤ 0.45, type ≤ 0.30). An elevated baseline, no baseline, no recovery or poor
 *    support suppress it (diagnostics only).
 *
 * Segmentation: qualifying minutes bridge at most 2 others (3 close the bout at its last qualifying minute); ring-burst
 * rests up to 4. `moving` lists the qualifying minutes; boundaries are minute-approximate.
 *
 * Scores (ranking heuristics, not probabilities): existence `E = clamp(0.35C + 0.25P + 0.20X + 0.20H − 0.25K, 0, 0.95)`
 * after the gates (C primary coverage, P persistence 0.6 at the class minimum → 1 at 20 min, X corroboration counted
 * once, H HR response, K material contradiction), with the caps above; `typeScore` from the evidence table; `level`
 * low < 0.60 ≤ medium < 0.80 ≤ high, of the smaller of the two. Every level stays pending review.
 *
 * State: `open` while less than 5 minutes of the primary lineage's evidence follow the bout (and it ended under 2 h
 * before `nowMs`), else `final`. Late evidence revises a final episode too (`./episodes.ts`).
 */
import { createHash } from 'node:crypto';

export const DETECTOR = 'detect/2';
/** The rule set's version (semver): any threshold change bumps it, and with it every episode's evidence hash. */
export const DETECT_CONFIG = '2.0.0';

export type ArActivity = 'IN_VEHICLE' | 'ON_BICYCLE' | 'RUNNING' | 'WALKING' | 'STILL';
export const AR_ACTIVITIES: readonly ArActivity[] = ['IN_VEHICLE', 'ON_BICYCLE', 'RUNNING', 'WALKING', 'STILL'];
export type DetectLabel =
  | 'walk' | 'walk_possibly_treadmill' | 'treadmill_walk' | 'run' | 'treadmill_run' | 'cycling' | 'possible_cycling' | 'possible_workout' | 'possible_strength';
export type Family = 'gait' | 'cycle' | 'other';
export type Level = 'low' | 'medium' | 'high';
/** `counted`: a minute-supported count (0 allowed); `zero`: an observed zero; `coarse`: only a longer record covers it. */
export type PhoneState = 'counted' | 'zero' | 'coarse' | 'unknown';
export type RingState = 'counted' | 'coarse' | 'unknown';
type Lineage = 'phone' | 'ring' | 'ar' | 'hr' | 'gps';

export interface MinuteEvidence {
  phone: number | null;
  phoneState: PhoneState;
  ring: number | null;
  ringState: RingState;
  /** Step fusion's selected minute count and lineage (reported only; detection reads the lineages). */
  fused?: number | null;
  fusedLineage?: string | null;
  /** Time-weighted mean bpm over the supported seconds, and those seconds (0–60). */
  hr: number | null;
  hrS: number;
  /** The mean of the minute's readings without declared cadence (never counted as support). */
  hrSampled?: number | null;
  /** Known asleep (true), known awake (false), unknown (null). */
  sleep: boolean | null;
  /** The recognised activity, null when unknown (no listening interval, or no state yet). */
  ar: ArActivity | null;
  /** Accepted route-derived speed (m/s), Gauge workouts only. */
  gpsMps: number | null;
  /** The minute's mean accurate fix (≤ 25 m), for the stationary-location test. */
  gpsPos?: { lat: number; lon: number } | null;
}

export interface DetectInput {
  /** The first minute (UTC, minute-aligned). */
  startMs: number;
  minutes: readonly MinuteEvidence[];
  /** The ring's coarse records (ten-minute fallback, quarter hour) in the window: compared to the phone as totals only. */
  ringCoarse?: ReadonlyArray<{ startMs: number; endMs: number; steps: number }>;
  /** The person's HR profile when known (the server has none: the baseline rule `B + 25` applies). */
  profile?: { restingHr?: number | null; maxHr?: number | null } | null;
  /** Explicit recordings (`gauge:<session>`, `hc:<id>`): an overlapping one is listed, Vitals absorbs by its rule. */
  recordings?: ReadonlyArray<{ ref: string; startMs: number; endMs: number }>;
  /** The newest instant each lineage's evidence reaches (its newest upload), beyond the window too. */
  edges?: Partial<Record<Lineage, number | null>>;
  nowMs: number;
  options?: { slowWalk?: boolean };
}

export interface DetectedEpisode {
  startMs: number;
  endMs: number;
  moving: Array<{ startMs: number; endMs: number }>;
  state: 'open' | 'final';
  family: Family;
  label: DetectLabel;
  alternatives: DetectLabel[];
  existence: number;
  typeScore: number;
  level: Level;
  reasons: string[];
  coverage: Record<Lineage, number>;
  evidenceHash: string;
  recordingRefs: string[];
}

export interface Suppression {
  startMs: number;
  endMs: number;
  reason: string;
}

export interface DetectResult {
  detector: typeof DETECTOR;
  config: typeof DETECT_CONFIG;
  episodes: DetectedEpisode[];
  suppressed: Suppression[];
}

// --- parameters (product defaults, P; tuned against owner labels later)

export const PARAMS = {
  bridge: 2,
  gaitFloor: 40,
  walk: { minMin: 10, cadence: 60, share: 0.8 },
  slow: { minMin: 20, cadence: 40, share: 0.9 },
  run: { minMin: 6, cadence: 140, arShare: 0.6, gpsCadence: 150, gpsMps: 2.8 },
  brisk: 100,
  stableCv: 0.2,
  ringLow: { ratio: 0.2, share: 0.8, joint: 0.5 },
  ringAgree: { ratio: 0.5, share: 0.6 },
  arKnown: 0.5,
  arAgree: 0.6,
  cycling: { minMin: 10, arShare: 0.7, gpsLo: 3, gpsHi: 12 },
  gpsCycling: { minMin: 15, share: 0.8, phoneObserved: 0.5 },
  strength: { burst: 40, quiet: 10, maxSet: 3, maxRest: 4, minSets: 3, minMin: 15, phoneGaitShare: 0.2 },
  ringOnly: { minMin: 10, cadence: 60, share: 0.8 },
  hr: { minS: 30, coverage: 0.7, minMin: 15, share: 0.7, observedLow: 0.8, baselineMin: 10, baselineWindow: 30, maxMin: 120, recoveryWindow: 30, recoveryMin: 5 },
  outdoor: { moving: 0.5, walkHi: 2.2, share: 0.7 },
  stationary: { share: 0.8, radiusM: 25, within: 0.9, maxMps: 0.5 },
  finalizeAfterMin: 5,
  finalizeSafetyMs: 2 * 3_600_000,
  maxEpisodeMin: 12 * 60,
  maskDiagnosticMin: 5,
} as const;

const MIN = 60_000;
const r2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
/** `1.4826 × MAD / median`: the robust between-minute variability of a cadence (null without a positive median). */
export function robustCv(xs: readonly number[]): number | null {
  const med = median(xs);
  if (med === null || !(med > 0)) return null;
  return (1.4826 * median(xs.map((x) => Math.abs(x - med)))!) / med;
}
export const levelOf = (x: number): Level => (x >= 0.8 ? 'high' : x >= 0.6 ? 'medium' : 'low');

function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_008.8;
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The HR threshold over baseline `b` (bpm) with the profile when valid; null when neither gives one. */
export function hrThreshold(b: number | null, profile: DetectInput['profile']): number | null {
  const rest = typeof profile?.restingHr === 'number' && profile.restingHr >= 30 && profile.restingHr <= 120 ? profile.restingHr : null;
  const max = typeof profile?.maxHr === 'number' && profile.maxHr >= 100 && profile.maxHr <= 230 ? profile.maxHr : null;
  if (rest !== null && max !== null && max > rest + 20) return Math.max(b !== null ? b + 20 : 0, rest + 0.4 * (max - rest));
  if (max !== null) return Math.max(b !== null ? b + 20 : 0, 0.64 * max);
  return b !== null ? b + 25 : null;
}

interface Candidate {
  a: number;
  b: number;
  family: Family;
  primary: Lineage;
  label: DetectLabel;
  alternatives: DetectLabel[];
  E: number;
  T: number;
  reasons: string[];
  moving: number[];
}

export function detect2(input: DetectInput): DetectResult {
  const m = input.minutes;
  const n = m.length;
  const t0 = input.startMs;
  const P = PARAMS;
  const at = (i: number) => t0 + i * MIN;
  const masked = m.map((x) => x.sleep === true || x.ar === 'IN_VEHICLE');
  const taken: boolean[] = new Array(n).fill(false);
  const out: Candidate[] = [];
  const suppressed: Suppression[] = [];
  const suppress = (a: number, b: number, reason: string) => suppressed.push({ startMs: at(a), endMs: at(b + 1), reason });

  const phoneCounted = (i: number) => m[i]!.phoneState === 'counted' && m[i]!.phone !== null;
  const phoneGait = (i: number, c: number = P.gaitFloor) => phoneCounted(i) && m[i]!.phone! >= c;
  const ringCounted = (i: number) => m[i]!.ringState === 'counted' && m[i]!.ring !== null;
  const phoneObserved = (i: number) => phoneCounted(i) || m[i]!.phoneState === 'zero';
  const hrOk = (i: number) => m[i]!.hrS >= P.hr.minS && m[i]!.hr !== null;
  /** At least one step lineage observed, none at gait. */
  const observedLow = (i: number) => {
    const ph = m[i]!.phoneState === 'zero' || (phoneCounted(i) && m[i]!.phone! < P.gaitFloor);
    const rg = ringCounted(i) && m[i]!.ring! < P.gaitFloor;
    const anyGait = phoneGait(i) || (ringCounted(i) && m[i]!.ring! >= P.gaitFloor);
    return (ph || rg) && !anyGait;
  };

  /** Runs of qualifying minutes bridging at most `bridge` others; a blocked minute closes the run. */
  const segments = (q: (i: number) => boolean, blocked: (i: number) => boolean, bridge: number = P.bridge): Array<[number, number]> => {
    const segs: Array<[number, number]> = [];
    let a = -1;
    let last = -1;
    for (let i = 0; i < n; i++) {
      if (blocked(i)) {
        if (a >= 0) segs.push([a, last]);
        a = -1;
        continue;
      }
      if (!q(i)) continue;
      if (a >= 0 && i - last - 1 <= bridge) last = i;
      else {
        if (a >= 0) segs.push([a, last]);
        a = last = i;
      }
    }
    if (a >= 0) segs.push([a, last]);
    return segs;
  };
  const blockedBase = (i: number) => masked[i]! || taken[i]!;
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
  const persistence = (len: number, minMin: number) => (len >= 20 ? 1 : clamp(0.6 + (0.4 * (len - minMin)) / Math.max(1, 20 - minMin), 0.6, 1));

  // --- HR helpers
  const baseline = (a: number): number | null => {
    const xs: number[] = [];
    for (let i = Math.max(0, a - P.hr.baselineWindow); i < a; i++) {
      if (!hrOk(i) || m[i]!.sleep === true || phoneGait(i) || (ringCounted(i) && m[i]!.ring! >= P.gaitFloor)) continue;
      xs.push(m[i]!.hr!);
    }
    return xs.length >= P.hr.baselineMin ? median(xs) : null;
  };
  const meanHr = (a: number, b: number) => {
    let w = 0;
    let s = 0;
    for (let i = a; i <= b; i++) if (hrOk(i)) {
      w += m[i]!.hrS;
      s += m[i]!.hrS * m[i]!.hr!;
    }
    return w > 0 ? s / w : null;
  };
  const supportedShare = (a: number, b: number) => range(a, b).reduce((x, i) => x + Math.min(60, m[i]!.hrS), 0) / ((b - a + 1) * 60);
  const recovered = (b: number, thr: number) => {
    let k = 0;
    for (let i = b + 1; i < Math.min(n, b + 1 + P.hr.recoveryWindow); i++) if (hrOk(i) && m[i]!.hr! < thr) k++;
    return k >= P.hr.recoveryMin;
  };
  /** H: 1 a well-supported bounded response, 0.5 a supported elevation without it, 0 none. */
  const hrScore = (a: number, b: number, reasons: string[]): number => {
    const base = baseline(a);
    const thr = hrThreshold(base, input.profile);
    const share = supportedShare(a, b);
    const mean = meanHr(a, b);
    if (thr !== null && mean !== null && mean >= thr) {
      if (share >= P.hr.coverage && base !== null && recovered(b, thr)) {
        reasons.push('hr_raised', 'hr_bounded');
        return 1;
      }
      if (share >= 0.5) {
        reasons.push('hr_raised');
        return 0.5;
      }
    }
    if (thr !== null) {
      const sampled = range(a, b).map((i) => m[i]!.hrSampled).filter((x): x is number => typeof x === 'number');
      const sm = median(sampled);
      if (sampled.length >= 3 && sm !== null && sm >= thr) reasons.push('hr_sampled_raised');
    }
    return 0;
  };

  // --- location
  const location = (a: number, b: number): { stationary: boolean; moving: boolean; movingMps: number | null } => {
    const len = b - a + 1;
    const pos = range(a, b).map((i) => m[i]!.gpsPos).filter((x): x is { lat: number; lon: number } => !!x);
    const speeds = range(a, b).map((i) => m[i]!.gpsMps).filter((x): x is number => x !== null);
    let stationary = false;
    if (pos.length >= P.stationary.share * len) {
      const c = { lat: median(pos.map((p) => p.lat))!, lon: median(pos.map((p) => p.lon))! };
      const near = pos.filter((p) => haversineM(p, c) <= P.stationary.radiusM).length;
      const ms = median(speeds);
      stationary = near >= P.stationary.within * pos.length && (ms === null || ms <= P.stationary.maxMps);
    }
    const movingMins = speeds.filter((v) => v >= P.outdoor.moving);
    const moving = !stationary && movingMins.length >= P.outdoor.share * len;
    return { stationary, moving, movingMps: moving ? median(movingMins) : null };
  };
  const arShare = (a: number, b: number, act: ArActivity) => {
    const known = range(a, b).filter((i) => m[i]!.ar !== null);
    return { known: known.length / (b - a + 1), share: known.length ? known.filter((i) => m[i]!.ar === act).length / known.length : 0 };
  };

  // 1. masks: a diagnostic where a mask hides activity-like evidence
  for (const [a, b] of segments((i) => masked[i]! && (phoneGait(i, 60) || (ringCounted(i) && m[i]!.ring! >= 60) || m[i]!.ar === 'ON_BICYCLE'), () => false)) {
    if (b - a + 1 < P.maskDiagnosticMin) continue;
    suppress(a, b, range(a, b).some((i) => m[i]!.sleep === true) ? 'sleep' : 'vehicle');
  }

  const emit = (c: Candidate) => {
    if (c.b - c.a + 1 > P.maxEpisodeMin) {
      suppress(c.a, c.b, 'too_long');
      return;
    }
    out.push(c);
    for (let i = c.a; i <= c.b; i++) taken[i] = true;
  };

  // 2. cycling (AR-led)
  for (const [a, b] of segments((i) => m[i]!.ar === 'ON_BICYCLE', blockedBase)) {
    const len = b - a + 1;
    const ar = arShare(a, b, 'ON_BICYCLE');
    if (len < P.cycling.minMin || ar.known < P.arKnown || ar.share < P.cycling.arShare) continue;
    const reasons = ['ar_bicycle'];
    const loc = location(a, b);
    const speeds = range(a, b).map((i) => m[i]!.gpsMps).filter((x): x is number => x !== null);
    const sm = median(speeds);
    const gpsOk = speeds.length >= 0.5 * len && sm !== null && sm >= P.cycling.gpsLo && sm <= P.cycling.gpsHi;
    const phoneMed = median(range(a, b).filter(phoneCounted).map((i) => m[i]!.phone!));
    const phoneLow = range(a, b).filter(phoneObserved).length >= 0.5 * len && (phoneMed === null || phoneMed < P.walk.cadence);
    let K = 0;
    if (phoneMed !== null && phoneMed >= 80) {
      K = 1;
      reasons.push('phone_gait_during_cycling');
    }
    if (gpsOk) reasons.push('gps_moving');
    else if (loc.stationary) reasons.push('stationary_location');
    if (phoneLow) reasons.push('phone_low_cadence');
    const X = gpsOk ? 1 : phoneLow ? 0.5 : 0;
    const H = hrScore(a, b, reasons);
    const E = 0.35 * ar.known + 0.25 * persistence(len, P.cycling.minMin) + 0.2 * X + 0.2 * H - 0.25 * K;
    emit({ a, b, family: 'cycle', primary: 'ar', label: 'cycling', alternatives: loc.stationary ? ['possible_workout'] : [], E, T: gpsOk ? 0.95 : 0.85, reasons, moving: range(a, b).filter((i) => m[i]!.ar === 'ON_BICYCLE') });
  }

  // 3. gait, phone-led: walk and run first (≥ 60/min), then slow walking (≥ 40/min)
  const gaitCandidate = (a: number, b: number, slow: boolean): Candidate | null => {
    const len = b - a + 1;
    const idx = range(a, b);
    const counted = idx.filter((i) => phoneGait(i));
    const cad = counted.map((i) => m[i]!.phone!);
    const med = median(cad) ?? 0;
    const cv = robustCv(cad);
    const steady = cv !== null && cv <= P.stableCv;
    const share60 = idx.filter((i) => phoneGait(i, P.walk.cadence)).length / len;
    const share40 = counted.length / len;
    const loc = location(a, b);
    const arRun = arShare(a, b, 'RUNNING');
    const arWalk = arShare(a, b, 'WALKING');
    const arBike = arShare(a, b, 'ON_BICYCLE');
    const runByAr = arRun.known >= P.arKnown && arRun.share >= P.run.arShare && med >= P.run.cadence;
    const runByGps = loc.moving && (loc.movingMps ?? 0) >= P.run.gpsMps && med >= P.run.gpsCadence;
    const runGate = !slow && len >= P.run.minMin && share60 >= P.walk.share && (runByAr || runByGps);
    const walkGate = !slow && len >= P.walk.minMin && share60 >= P.walk.share;
    const slowGate = slow && (input.options?.slowWalk ?? true) && len >= P.slow.minMin && share40 >= P.slow.share && steady;
    if (!runGate && !walkGate && !slowGate) return null;
    const reasons = ['phone_cadence'];
    if (steady) reasons.push('steady_cadence');
    if (slowGate) reasons.push('slow_cadence', 'no_intensity_claim');
    else if (med >= P.brisk) reasons.push('brisk_cadence');
    // the ring beside the phone: minute pairs, then coarse ring records against the phone's minutes they cover
    let joint = 0;
    let low = 0;
    let agree = 0;
    for (const i of idx) {
      if (!ringCounted(i) || !phoneGait(i)) continue;
      joint++;
      if (m[i]!.ring! <= P.ringLow.ratio * m[i]!.phone!) low++;
      if (m[i]!.ring! >= P.ringAgree.ratio * m[i]!.phone!) agree++;
    }
    for (const c of input.ringCoarse ?? []) {
      const ca = Math.floor((c.startMs - t0) / MIN);
      const cb = Math.ceil((c.endMs - t0) / MIN) - 1;
      if (ca < a || cb > b) continue;
      const ph = range(ca, cb).filter((i) => phoneCounted(i));
      if (ph.length < 0.9 * (cb - ca + 1)) continue;
      const pSteps = ph.reduce((x, i) => x + m[i]!.phone!, 0);
      joint += ph.length;
      if (c.steps <= P.ringLow.ratio * pSteps) low += ph.length;
      if (c.steps >= P.ringAgree.ratio * pSteps) agree += ph.length;
    }
    const ringLow = joint >= P.ringLow.joint * len && low >= P.ringLow.share * joint;
    const ringAgrees = joint >= P.ringLow.joint * len && agree >= P.ringAgree.share * joint;
    if (ringLow) reasons.push('ring_low');
    if (ringAgrees) reasons.push('ring_agrees');
    const arWalking = arWalk.known >= P.arKnown && arWalk.share >= P.arAgree;
    const arRunning = arRun.known >= P.arKnown && arRun.share >= P.arAgree;
    if (arWalking) reasons.push('ar_walking');
    if (arRunning) reasons.push('ar_running');
    let K = 0;
    if (arBike.known >= P.arKnown && arBike.share >= P.arAgree) {
      K = 1;
      reasons.push('ar_conflict');
    }
    let label: DetectLabel;
    let alternatives: DetectLabel[] = [];
    let T: number;
    if (runGate) {
      if (loc.stationary) {
        label = 'treadmill_run';
        alternatives = ['run'];
        T = 0.7;
        reasons.push('stationary_location');
      } else {
        label = 'run';
        T = runByAr ? 0.85 : 0.7;
        if (loc.moving) reasons.push('gps_moving');
        else reasons.push('location_unknown');
        alternatives = loc.moving ? [] : ['treadmill_run'];
      }
    } else if (loc.stationary && steady) {
      label = 'treadmill_walk';
      alternatives = ['walk'];
      T = 0.7;
      reasons.push('stationary_location');
    } else if (loc.moving) {
      label = 'walk';
      T = 0.8;
      reasons.push('gps_moving');
    } else if (ringLow && steady) {
      // the owner's keyboard treadmill: steady phone gait, the ring's hands-fixed near zero; no location evidence
      label = 'walk_possibly_treadmill';
      alternatives = ['walk', 'treadmill_walk'];
      T = 0.45;
      reasons.push('location_unknown');
    } else {
      label = 'walk';
      T = arWalking ? 0.8 : 0.6;
      reasons.push('location_unknown');
    }
    if (!runGate && med >= P.run.cadence) {
      // high cadence alone never preselects running
      T = Math.min(T, 0.45);
      alternatives = [...alternatives, 'run'];
      reasons.push('high_cadence_unresolved');
    }
    const X = ringAgrees || loc.moving || loc.stationary ? 1 : arWalking || arRunning ? 0.5 : 0;
    const H = hrScore(a, b, reasons);
    const C = idx.filter(phoneObserved).length / len;
    const minMin = runGate && len < P.walk.minMin ? P.run.minMin : slowGate ? P.slow.minMin : P.walk.minMin;
    const E = 0.35 * C + 0.25 * persistence(len, minMin) + 0.2 * X + 0.2 * H - 0.25 * K;
    return { a, b, family: 'gait', primary: 'phone', label, alternatives, E, T, reasons, moving: slowGate ? counted : idx.filter((i) => phoneGait(i, P.walk.cadence)) };
  };
  for (const [a, b] of segments((i) => phoneGait(i, P.walk.cadence), blockedBase)) {
    const c = gaitCandidate(a, b, false);
    if (c) emit(c);
  }
  for (const [a, b] of segments((i) => phoneGait(i), blockedBase)) {
    const c = gaitCandidate(a, b, true);
    if (c) emit(c);
  }

  // 4. ring bursts (strength-like): sets of 1–3 burst minutes, rests of 1–4 quiet minutes
  {
    const burst = (i: number) => !blockedBase(i) && ringCounted(i) && m[i]!.ring! >= P.strength.burst;
    const quiet = (i: number) => !blockedBase(i) && ringCounted(i) && m[i]!.ring! <= P.strength.quiet;
    let i = 0;
    while (i < n) {
      if (!burst(i)) {
        i++;
        continue;
      }
      const sets: Array<[number, number]> = [];
      let j = i;
      for (;;) {
        let k = j;
        while (k < n && burst(k)) k++;
        const setLen = k - j;
        if (setLen > P.strength.maxSet) break;
        sets.push([j, k - 1]);
        let r = k;
        while (r < n && quiet(r)) r++;
        const rest = r - k;
        if (rest < 1 || rest > P.strength.maxRest || r >= n || !burst(r)) break;
        j = r;
      }
      if (!sets.length) {
        while (i < n && burst(i)) i++;
        continue;
      }
      const a = sets[0]![0];
      const b = sets.at(-1)![1];
      const len = b - a + 1;
      i = b + 1;
      if (sets.length < P.strength.minSets || len < P.strength.minMin) continue;
      if (range(a, b).filter((x) => phoneGait(x)).length >= P.strength.phoneGaitShare * len) continue;
      const reasons = ['ring_bursts'];
      const H = hrScore(a, b, reasons);
      if (H < 0.5) {
        suppress(a, b, 'ring_bursts_without_hr');
        continue;
      }
      const C = range(a, b).filter(ringCounted).length / len;
      const E = Math.min(0.79, 0.35 * C + 0.25 * persistence(len, P.strength.minMin) + 0.2 * H);
      reasons.push('type_unknown');
      emit({ a, b, family: 'other', primary: 'ring', label: 'possible_workout', alternatives: ['possible_strength'], E, T: 0.45, reasons, moving: sets.flatMap(([x, y]) => range(x, y)) });
    }
  }

  // 5. ring-only gait: the ring moved steadily while the phone saw no gait
  for (const [a, b] of segments((i) => ringCounted(i) && m[i]!.ring! >= P.ringOnly.cadence && !phoneGait(i), blockedBase)) {
    const len = b - a + 1;
    const idx = range(a, b);
    const cad = idx.filter((i) => ringCounted(i) && m[i]!.ring! >= P.ringOnly.cadence).map((i) => m[i]!.ring!);
    const cv = robustCv(cad);
    if (len < P.ringOnly.minMin || cad.length < P.ringOnly.share * len || cv === null || cv > P.stableCv) continue;
    const reasons = ['ring_only_movement', 'steady_cadence'];
    const zero = idx.filter((i) => m[i]!.phoneState === 'zero').length;
    let K = 0;
    if (zero >= 0.5 * len) {
      K = 1;
      reasons.push('phone_zero');
    } else reasons.push('phone_unknown');
    const H = hrScore(a, b, reasons);
    const C = idx.filter(ringCounted).length / len;
    const E = Math.min(0.59, 0.35 * C + 0.25 * persistence(len, P.ringOnly.minMin) + 0.2 * H - 0.25 * K);
    reasons.push('type_unknown');
    emit({ a, b, family: 'other', primary: 'ring', label: 'possible_workout', alternatives: ['walk'], E, T: 0.45, reasons, moving: idx.filter((i) => ringCounted(i) && m[i]!.ring! >= P.ringOnly.cadence) });
  }

  // 6. GPS-only cycling: a hypothesis, low at most, and only with an exertion response
  for (const [a, b] of segments((i) => m[i]!.gpsMps !== null && m[i]!.gpsMps! >= P.cycling.gpsLo && m[i]!.gpsMps! <= P.cycling.gpsHi && !phoneGait(i), blockedBase)) {
    const len = b - a + 1;
    const idx = range(a, b);
    const q = idx.filter((i) => m[i]!.gpsMps !== null && m[i]!.gpsMps! >= P.cycling.gpsLo && m[i]!.gpsMps! <= P.cycling.gpsHi).length;
    if (len < P.gpsCycling.minMin || q < P.gpsCycling.share * len) continue;
    const phoneMed = median(idx.filter(phoneCounted).map((i) => m[i]!.phone!)) ?? 0;
    if (idx.filter(phoneObserved).length < P.gpsCycling.phoneObserved * len || phoneMed >= P.gaitFloor) {
      suppress(a, b, 'gps_only_unobserved_steps');
      continue;
    }
    const reasons = ['gps_moving', 'phone_low_cadence', 'gps_only'];
    const H = hrScore(a, b, reasons);
    if (H < 0.5) {
      suppress(a, b, 'gps_only_without_hr');
      continue;
    }
    const E = Math.min(0.59, 0.35 * (q / len) + 0.25 * persistence(len, P.gpsCycling.minMin) + 0.2 * H);
    emit({ a, b, family: 'cycle', primary: 'gps', label: 'possible_cycling', alternatives: ['possible_workout'], E, T: 0.45, reasons, moving: idx.filter((i) => m[i]!.gpsMps !== null && m[i]!.gpsMps! >= P.cycling.gpsLo) });
  }

  // 7. HR-led: a bounded rise over the pre-bout baseline with the steps observed low
  {
    let i = 0;
    while (i < n) {
      if (blockedBase(i) || !hrOk(i)) {
        i++;
        continue;
      }
      const base = baseline(i);
      const thr = hrThreshold(base, input.profile);
      const q = (k: number) => thr !== null && hrOk(k) && m[k]!.hr! >= thr && !phoneGait(k) && !(ringCounted(k) && m[k]!.ring! >= P.gaitFloor);
      if (thr === null || !q(i)) {
        i++;
        continue;
      }
      let last = i;
      for (let k = i + 1; k < n; k++) {
        if (blockedBase(k)) break;
        if (q(k)) last = k;
        else if (k - last > P.bridge) break;
      }
      const a = i;
      const b = last;
      i = b + 1;
      const len = b - a + 1;
      if (len < P.hr.minMin) continue;
      const idx = range(a, b);
      if (base === null) {
        suppress(a, b, 'hr_no_baseline');
        continue;
      }
      if (len > P.hr.maxMin || !recovered(b, thr)) {
        suppress(a, b, 'hr_unbounded');
        continue;
      }
      if (supportedShare(a, b) < P.hr.coverage || idx.filter(q).length < P.hr.share * len) {
        suppress(a, b, 'hr_poor_support');
        continue;
      }
      if (idx.filter(observedLow).length < P.hr.observedLow * len) {
        suppress(a, b, 'hr_steps_unknown');
        continue;
      }
      const rest = input.profile?.restingHr;
      const max = input.profile?.maxHr;
      if (typeof rest === 'number' && typeof max === 'number' && max > rest + 20 && base >= rest + 0.4 * (max - rest)) {
        suppress(a, b, 'hr_elevated_baseline');
        continue;
      }
      const reasons = ['hr_raised', 'hr_bounded', 'hr_only', 'steps_low', 'type_unknown'];
      const E = Math.min(0.45, 0.35 * supportedShare(a, b) + 0.25 * persistence(len, P.hr.minMin) + 0.2 * 1);
      emit({ a, b, family: 'other', primary: 'hr', label: 'possible_workout', alternatives: [], E, T: 0.3, reasons, moving: idx.filter(q) });
    }
  }

  // finish: coverage, state, recordings, hash
  const edgeOf = (c: Candidate): number | null => {
    let e = input.edges?.[c.primary] ?? null;
    for (let i = n - 1; i > c.b; i--) {
      const x = m[i]!;
      const seen = c.primary === 'phone' ? phoneObserved(i) : c.primary === 'ring' ? ringCounted(i) : c.primary === 'ar' ? x.ar !== null : c.primary === 'hr' ? x.hrS > 0 : x.gpsMps !== null;
      if (seen) {
        e = Math.max(e ?? -Infinity, at(i + 1));
        break;
      }
    }
    return e;
  };
  const episodes = out.sort((x, y) => x.a - y.a).map((c): DetectedEpisode => {
    const len = c.b - c.a + 1;
    const idx = range(c.a, c.b);
    const startMs = at(c.a);
    const endMs = at(c.b + 1);
    const coverage = {
      phone: r2(idx.filter(phoneObserved).length / len), ring: r2(idx.filter(ringCounted).length / len), hr: r2(supportedShare(c.a, c.b)),
      ar: r2(idx.filter((i) => m[i]!.ar !== null).length / len), gps: r2(idx.filter((i) => m[i]!.gpsMps !== null).length / len),
    };
    const reasons = [...new Set(c.reasons)];
    if (coverage[c.primary === 'gps' ? 'gps' : c.primary] < 0.9) reasons.push('coverage_gaps');
    const recordingRefs = [...new Set((input.recordings ?? []).filter((r) => r.startMs < endMs && r.endMs > startMs).map((r) => r.ref))].sort();
    if (recordingRefs.length) reasons.push('recording_overlap');
    const edge = edgeOf(c);
    const state = (edge !== null && edge - endMs >= P.finalizeAfterMin * MIN) || input.nowMs - endMs >= P.finalizeSafetyMs ? 'final' : 'open';
    const existence = r2(clamp(c.E, 0, 0.95));
    const typeScore = r2(clamp(c.T, 0, 0.95));
    const moving: Array<{ startMs: number; endMs: number }> = [];
    for (const i of [...new Set(c.moving)].sort((x, y) => x - y)) {
      const last = moving.at(-1);
      if (last && last.endMs === at(i)) last.endMs = at(i + 1);
      else moving.push({ startMs: at(i), endMs: at(i + 1) });
    }
    const evidence = idx.map((i) => {
      const x = m[i]!;
      return [x.phoneState, x.phone, x.ringState, x.ring, x.hr, x.hrS, x.sleep, x.ar, x.gpsMps, x.gpsPos ? [r2(x.gpsPos.lat * 1e4), r2(x.gpsPos.lon * 1e4)] : null];
    });
    const evidenceHash = `sha256:${createHash('sha256').update(JSON.stringify([DETECTOR, DETECT_CONFIG, startMs, c.label, evidence, input.profile ?? null])).digest('hex').slice(0, 32)}`;
    return {
      startMs, endMs, moving, state, family: c.family, label: c.label, alternatives: [...new Set(c.alternatives)].filter((x) => x !== c.label), existence, typeScore,
      level: levelOf(Math.min(existence, typeScore)), reasons, coverage, evidenceHash, recordingRefs,
    };
  });
  return { detector: DETECTOR, config: DETECT_CONFIG, episodes, suppressed: suppressed.sort((x, y) => x.startMs - y.startMs) };
}

// ---------------------------------------------------------------------------------------------------------------
// Activity-recognition state per minute (pure)

export interface ArTransition {
  occurredMs: number;
  activity: ArActivity;
  transition: 'ENTER' | 'EXIT';
  bootId: string;
  /** Elapsed realtime since boot (ns), a decimal string. */
  elapsedNs: string;
  epoch: number | null;
}
export interface ArInterval {
  startMs: number;
  endMs: number;
  state: string;
  epoch: number | null;
}

const ns = (v: string) => (/^\d{1,20}$/.test(v) ? BigInt(v) : 0n);
/** Grace before a listening interval in which a registration's first ENTER may lie (its elapsed time precedes `from`). */
const AR_GRACE_MS = 2 * MIN;
/** Listening intervals at most this far apart (same registration) are one stretch: the state carries across. */
const AR_JOIN_MS = MIN;

/**
 * The recognised activity at each minute's midpoint (null = unknown). Order-independent: the same events in any order
 * (or replayed twice) give the same state. Transitions are deduplicated by (boot, elapsed ns, activity, transition) and
 * ordered within one boot by elapsed realtime, never across boots by it: a reboot starts a new state (no carry-over),
 * and a later wall-clock correction cannot move an event into another boot's run. The state holds only inside a
 * `listening` stretch of the same registration epoch (gaps between intervals are unknown); EXIT without a following
 * ENTER is unknown.
 */
export function arStateMinutes(transitions: readonly ArTransition[], intervals: readonly ArInterval[], startMs: number, n: number): Array<ArActivity | null> {
  const out: Array<ArActivity | null> = new Array(n).fill(null);
  const stretches: ArInterval[] = [];
  for (const x of [...intervals].filter((x) => x.state === 'listening' && x.endMs > x.startMs).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)) {
    const last = stretches.at(-1);
    if (last && last.epoch === x.epoch && x.startMs - last.endMs <= AR_JOIN_MS) last.endMs = Math.max(last.endMs, x.endMs);
    else stretches.push({ ...x });
  }
  if (!stretches.length) return out;
  const seen = new Map<string, ArTransition>();
  for (const t of transitions) seen.set(`${t.bootId}|${t.elapsedNs}|${t.activity}|${t.transition}`, t);
  // runs per (epoch, boot), each in elapsed order; a run's wall-clock span is from its first event's occurrence
  const runs = new Map<string, ArTransition[]>();
  for (const t of seen.values()) {
    const k = `${t.epoch ?? ''}|${t.bootId}`;
    const list = runs.get(k) ?? [];
    list.push(t);
    runs.set(k, list);
  }
  const ordered = [...runs.values()].map((list) => list.sort((a, b) => {
    const d = ns(a.elapsedNs) - ns(b.elapsedNs);
    return d < 0n ? -1 : d > 0n ? 1 : a.transition === b.transition ? (a.activity < b.activity ? -1 : a.activity > b.activity ? 1 : 0) : a.transition === 'EXIT' ? -1 : 1;
  })).sort((a, b) => a[0]!.occurredMs - b[0]!.occurredMs || (a[0]!.bootId < b[0]!.bootId ? -1 : 1));
  for (let i = 0; i < n; i++) {
    const t = startMs + i * MIN + MIN / 2;
    const s = stretches.find((x) => x.startMs <= t && t < x.endMs);
    if (!s) continue;
    // the latest run of this registration that began by t (and inside the stretch), then its last event by t
    let state: ArActivity | null = null;
    let found = false;
    for (let r = ordered.length - 1; r >= 0 && !found; r--) {
      const run = ordered[r]!;
      if (run[0]!.epoch !== s.epoch || run[0]!.occurredMs > t) continue;
      let last: ArTransition | null = null;
      for (const e of run) if (e.occurredMs <= t) last = e;
      if (!last || last.occurredMs < s.startMs - AR_GRACE_MS) continue;
      found = true;
      state = last.transition === 'ENTER' ? last.activity : null;
    }
    out[i] = state;
  }
  return out;
}
