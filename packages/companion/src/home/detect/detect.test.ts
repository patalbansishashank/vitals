// @vitest-environment node
/**
 * `detect/2` against the synthetic acceptance cases of the design (r065 autodetect `gpt-6.1-sol.md` §3 "Synthetic
 * acceptance cases", with `gpt-6-astra.md`'s more conservative variants where they differ), plus the activity-recognition
 * state's order independence. Unless a case says otherwise: counts have minute support, HR has 60 s of support a minute,
 * minutes are awake, the baseline HR is 70, resting HR 60 and maximum HR 180; each bout has 30 quiet minutes before
 * (the baseline) and after (the recovery), the phone listening (observed zero) and the ring at 0 there.
 */
import { describe, expect, it } from 'vitest';
import { arStateMinutes, detect2, robustCv, type ArActivity, type ArTransition, type DetectInput, type MinuteEvidence } from './detect.ts';

const T0 = Date.parse('2026-10-20T04:00:00Z');
const MIN = 60_000;
const PROFILE = { restingHr: 60, maxHr: 180 };
const HOME = { lat: 12.9716, lon: 77.5946 };

const blank = (): MinuteEvidence => ({ phone: null, phoneState: 'unknown', ring: null, ringState: 'unknown', hr: null, hrS: 0, hrSampled: null, sleep: false, ar: null, gpsMps: null, gpsPos: null });
const quiet = (): MinuteEvidence => ({ ...blank(), phone: 0, phoneState: 'zero', ring: 0, ringState: 'counted', hr: 70, hrS: 60 });

type Spec = Partial<MinuteEvidence> & { P?: number | null; R?: number | null; H?: number | null };
/** A minute from short names: P phone count (null: unknown), R ring count, H bpm with 60 s of support. */
function minute(s: Spec): MinuteEvidence {
  const x = { ...blank(), hr: 70, hrS: 60 };
  if (s.P !== undefined) Object.assign(x, s.P === null ? { phone: null, phoneState: 'unknown' } : s.P === 0 ? { phone: 0, phoneState: 'zero' } : { phone: s.P, phoneState: 'counted' });
  if (s.R !== undefined) Object.assign(x, s.R === null ? { ring: null, ringState: 'unknown' } : { ring: s.R, ringState: 'counted' });
  if (s.H !== undefined) Object.assign(x, s.H === null ? { hr: null, hrS: 0 } : { hr: s.H, hrS: 60 });
  const { P: _p, R: _r, H: _h, ...rest } = s;
  return { ...x, ...rest };
}

/** 30 quiet minutes, the bout, 30 quiet minutes; `nowMs` a day later (everything final). */
function run(bout: MinuteEvidence[], o: { pre?: MinuteEvidence[]; post?: MinuteEvidence[]; profile?: DetectInput['profile'] } = {}) {
  const pre = o.pre ?? Array.from({ length: 30 }, quiet);
  const post = o.post ?? Array.from({ length: 30 }, quiet);
  const minutes = [...pre, ...bout, ...post];
  return detect2({ startMs: T0, minutes, nowMs: T0 + 24 * 60 * MIN, profile: o.profile === undefined ? PROFILE : o.profile });
}
const times = (n: number, f: (i: number) => Spec) => Array.from({ length: n }, (_, i) => minute(f(i)));
const wobble = (c: number, d: number) => (i: number) => c + [0, d, -d, d / 2, -d / 2][i % 5]!;
const stationary = { gpsPos: HOME, gpsMps: 0 };

describe('detect/2 synthetic acceptance cases (sol §3)', () => {
  it('25 min P=96±4, R=2, AR walking, stationary location, HR 95: one possible treadmill walk; HR elevation unnecessary', () => {
    const r = run(times(25, (i) => ({ P: wobble(96, 4)(i), R: 2, ar: 'WALKING', H: 95, ...stationary })));
    expect(r.episodes).toHaveLength(1);
    const e = r.episodes[0]!;
    expect([e.label, e.state, e.startMs, e.endMs]).toEqual(['treadmill_walk', 'final', T0 + 30 * MIN, T0 + 55 * MIN]);
    expect(e.reasons).toEqual(expect.arrayContaining(['phone_cadence', 'steady_cadence', 'ring_low', 'stationary_location', 'ar_walking']));
    expect(e.reasons).not.toContain('hr_raised');
    expect(e.typeScore).toBe(0.7);
    expect(e.existence).toBeGreaterThanOrEqual(0.6);
  });

  it('20 min P=70, R=0, AR walking, GPS absent, the fused selection still the ring\'s zero: gait from the phone lineage, "walk, possibly treadmill"', () => {
    const r = run(times(20, () => ({ P: 70, R: 0, ar: 'WALKING', fused: 0, fusedLineage: 'ring' })));
    expect(r.episodes.map((e) => e.label)).toEqual(['walk_possibly_treadmill']);
    const e = r.episodes[0]!;
    expect(e.alternatives).toEqual(expect.arrayContaining(['walk', 'treadmill_walk']));
    expect(e.reasons).toEqual(expect.arrayContaining(['ring_low', 'location_unknown']));
    expect(e.typeScore).toBeLessThanOrEqual(0.45);
  });

  it('the owner\'s keyboard treadmill without recognition or GPS (P≈85, ring ≈3): walk_possibly_treadmill, never a run or a workout', () => {
    const r = run(times(35, (i) => ({ P: wobble(85, 4)(i), R: i % 3 })));
    expect(r.episodes.map((e) => e.label)).toEqual(['walk_possibly_treadmill']);
    expect(r.episodes[0]!.coverage).toEqual({ phone: 1, ring: 1, hr: 1, ar: 0, gps: 0 });
  });

  it('20 min P=45±2, R=0, stationary location: a slow-walking proposal with no moderate-intensity claim (12 min: none)', () => {
    const r = run(times(20, (i) => ({ P: wobble(45, 2)(i), R: 0, ...stationary })));
    expect(r.episodes).toHaveLength(1);
    expect(r.episodes[0]!.label).toBe('treadmill_walk');
    expect(r.episodes[0]!.reasons).toEqual(expect.arrayContaining(['slow_cadence', 'no_intensity_claim']));
    expect(r.episodes[0]!.reasons).not.toContain('brisk_cadence');
    expect(run(times(12, (i) => ({ P: wobble(45, 2)(i), R: 0, ...stationary }))).episodes).toEqual([]);
  });

  it('8 min P=158, AR running, stationary location: possible treadmill run', () => {
    const r = run(times(8, () => ({ P: 158, ar: 'RUNNING', ...stationary })));
    expect(r.episodes.map((e) => e.label)).toEqual(['treadmill_run']);
  });

  it('15 min P=110, AR walking, GPS 1.4 m/s: outdoor walk', () => {
    const r = run(times(15, (i) => ({ P: 110, ar: 'WALKING', gpsMps: 1.4, gpsPos: { lat: HOME.lat + i * 0.0008, lon: HOME.lon } })));
    expect(r.episodes.map((e) => e.label)).toEqual(['walk']);
    expect(r.episodes[0]!.reasons).toEqual(expect.arrayContaining(['gps_moving', 'brisk_cadence']));
    expect(r.episodes[0]!.typeScore).toBe(0.8);
  });

  it('15 min P=132, AR walking, GPS 1.9 m/s: walking, never running because cadence exceeds 130', () => {
    const r = run(times(15, () => ({ P: 132, ar: 'WALKING', gpsMps: 1.9 })));
    expect(r.episodes.map((e) => e.label)).toEqual(['walk']);
    expect(r.episodes[0]!.alternatives).not.toContain('run');
  });

  it('never a run from cadence alone: 20 min P=150 without recognition or GPS is a walk with run as an alternative', () => {
    const r = run(times(20, () => ({ P: 150 })));
    expect(r.episodes.map((e) => e.label)).toEqual(['walk']);
    expect(r.episodes[0]!.alternatives).toContain('run');
    expect(r.episodes[0]!.reasons).toContain('high_cadence_unresolved');
    expect(r.episodes[0]!.typeScore).toBeLessThanOrEqual(0.45);
  });

  it('6 min P=162, AR running, GPS 2.8 m/s: running proposal', () => {
    const r = run(times(6, () => ({ P: 162, ar: 'RUNNING', gpsMps: 2.8 })));
    expect(r.episodes.map((e) => e.label)).toEqual(['run']);
    expect(r.episodes[0]!.typeScore).toBe(0.85);
  });

  it('12 min P=3, AR bicycle, GPS 5 m/s: cycling proposal', () => {
    const r = run(times(12, () => ({ P: 3, ar: 'ON_BICYCLE', gpsMps: 5 })));
    expect(r.episodes.map((e) => e.label)).toEqual(['cycling']);
    expect(r.episodes[0]!.typeScore).toBe(0.95);
  });

  it('20 min P=0, AR unknown, GPS 6 m/s, no useful HR: at most a low-confidence possible cycling, no assertive suggestion', () => {
    const r = run(times(20, () => ({ P: 0, H: null, gpsMps: 6 })));
    for (const e of r.episodes) {
      expect(e.label).toBe('possible_cycling');
      expect(e.level).toBe('low');
    }
    expect(r.episodes.filter((e) => e.level !== 'low')).toEqual([]);
  });

  it('30 min P=4, AR vehicle, GPS 7 m/s, HR 130: no passive workout proposal', () => {
    expect(run(times(30, () => ({ P: 4, ar: 'IN_VEHICLE', gpsMps: 7, H: 130 }))).episodes).toEqual([]);
  });

  it('20 min P=0, R=0, AR still, a bounded HR rise to 135 and recovery: a low-confidence possible workout, no equipment label', () => {
    const rise = [80, 95, 110, 125, 135];
    const r = run(times(20, (i) => ({ P: 0, R: 0, ar: 'STILL', H: i < 5 ? rise[i]! : i >= 17 ? 120 : 135 })));
    expect(r.episodes).toHaveLength(1);
    const e = r.episodes[0]!;
    expect([e.label, e.level]).toEqual(['possible_workout', 'low']);
    expect(e.alternatives).toEqual([]);
    expect(e.existence).toBeLessThanOrEqual(0.49);
    expect(e.reasons).toEqual(expect.arrayContaining(['hr_only', 'hr_bounded', 'type_unknown']));
  });

  it('20 min P=0, R=[80,80,0,0] repeated, AR still, supported raised HR: possible workout with a strength alternative, not a walk', () => {
    const r = run(times(20, (i) => ({ P: 0, R: [80, 80, 0, 0][i % 4]!, ar: 'STILL', H: 125 })));
    expect(r.episodes).toHaveLength(1);
    const e = r.episodes[0]!;
    expect(e.label).toBe('possible_workout');
    expect(e.alternatives).toContain('possible_strength');
    expect(e.alternatives).not.toContain('walk');
    expect(e.reasons).toContain('ring_bursts');
    // the same ring pattern without an HR response asserts nothing (astra)
    expect(run(times(20, (i) => ({ P: 0, R: [80, 80, 0, 0][i % 4]!, ar: 'STILL', H: 72 }))).episodes).toEqual([]);
  });

  it('20 min with the phone on the desk (P=0), steady R=100, AR still: ambiguous movement; phone zero never establishes strength', () => {
    const r = run(times(20, () => ({ P: 0, R: 100, ar: 'STILL' })));
    expect(r.episodes).toHaveLength(1);
    const e = r.episodes[0]!;
    expect(e.label).toBe('possible_workout');
    expect(e.alternatives).toEqual(['walk']);
    expect(e.reasons).toEqual(expect.arrayContaining(['ring_only_movement', 'phone_zero']));
    expect(e.existence).toBeLessThanOrEqual(0.59);
  });

  it('a four-minute stair climb with high cadence and HR: no standalone proposal', () => {
    expect(run(times(4, () => ({ P: 120, R: 110, H: 140 }))).episodes).toEqual([]);
  });

  it('twenty minutes of fragmented household counts, no sustained gait or HR response: no proposal', () => {
    const p = [30, 0, 55, 10, 70, 0, 20, 45, 5, 62, 0, 15, 38, 0, 66, 12, 0, 41, 8, 25];
    const r = [12, 44, 3, 60, 0, 22, 51, 9, 0, 33, 47, 2, 0, 58, 6, 19, 40, 0, 27, 11];
    expect(run(times(20, (i) => ({ P: p[i]!, R: r[i]! }))).episodes).toEqual([]);
  });

  it('two hours of raised HR with an elevated baseline before and after and no movement: no HR-only proposal', () => {
    const high = () => minute({ P: 0, R: 0, H: 128 });
    const r = run(times(120, () => ({ P: 0, R: 0, H: 130 })), { pre: Array.from({ length: 30 }, high), post: Array.from({ length: 30 }, high) });
    expect(r.episodes).toEqual([]);
  });

  it('high HR with only one supported second per minute: no HR-led proposal', () => {
    expect(run(times(20, () => ({ P: 0, R: 0, hr: 150, hrS: 1 }))).episodes).toEqual([]);
  });

  it('only coarse ten-minute step totals: no invented minute cadence', () => {
    const coarse = times(40, () => ({ phone: null, phoneState: 'coarse', ring: null, ringState: 'coarse' }));
    const ringCoarse = [0, 1, 2, 3].map((k) => ({ startMs: T0 + (30 + k * 10) * MIN, endMs: T0 + (40 + k * 10) * MIN, steps: 1000 }));
    const minutes = [...Array.from({ length: 30 }, quiet), ...coarse, ...Array.from({ length: 30 }, quiet)];
    expect(detect2({ startMs: T0, minutes, ringCoarse, nowMs: T0 + 86_400_000, profile: PROFILE }).episodes).toEqual([]);
  });

  it('a 25-minute walk with a two-minute interruption: one episode', () => {
    const r = run(times(25, (i) => ({ P: i === 12 || i === 13 ? 0 : 100 })));
    expect(r.episodes).toHaveLength(1);
    expect([r.episodes[0]!.startMs, r.episodes[0]!.endMs]).toEqual([T0 + 30 * MIN, T0 + 55 * MIN]);
    expect(r.episodes[0]!.moving).toEqual([{ startMs: T0 + 30 * MIN, endMs: T0 + 42 * MIN }, { startMs: T0 + 44 * MIN, endMs: T0 + 55 * MIN }]);
  });

  it('eleven gait minutes, three missing minutes, eleven gait minutes: two bouts', () => {
    const r = run(times(25, (i) => ({ P: i >= 11 && i < 14 ? null : 100 })));
    expect(r.episodes.map((e) => [(e.startMs - T0) / MIN, (e.endMs - T0) / MIN])).toEqual([[30, 41], [44, 55]]);
  });

  it('qualifying counts during known sleep: no passive proposal, the conflict kept as a diagnostic', () => {
    const r = run(times(30, () => ({ P: 100, R: 100, sleep: true })));
    expect(r.episodes).toEqual([]);
    expect(r.suppressed.map((s) => s.reason)).toEqual(['sleep']);
  });

  it('unknown is never zero: an HR rise with both step lineages unknown gives no HR-led proposal', () => {
    const r = run(times(20, (i) => ({ P: null, R: null, H: i < 2 ? 100 : 135 })));
    expect(r.episodes).toEqual([]);
    expect(r.suppressed.map((s) => s.reason)).toContain('hr_steps_unknown');
  });

  it('an episode is open while fewer than 5 minutes of its lineage follow it, final after; the result is deterministic', () => {
    const bout = times(20, () => ({ P: 100 }));
    const pre = Array.from({ length: 30 }, quiet);
    const open = detect2({ startMs: T0, minutes: [...pre, ...bout, quiet(), quiet()], nowMs: T0 + 53 * MIN, profile: PROFILE });
    expect(open.episodes.map((e) => e.state)).toEqual(['open']);
    const final = detect2({ startMs: T0, minutes: [...pre, ...bout, ...Array.from({ length: 6 }, quiet)], nowMs: T0 + 57 * MIN, profile: PROFILE });
    expect(final.episodes.map((e) => e.state)).toEqual(['final']);
    expect(final.episodes[0]!.evidenceHash).toBe(open.episodes[0]!.evidenceHash);
    // no profile on the server: the baseline rule still works
    expect(detect2({ startMs: T0, minutes: [...pre, ...bout], nowMs: T0 + 3 * 3_600_000 }).episodes.map((e) => e.state)).toEqual(['final']);
  });

  it('works with today\'s data: no recognition at all is just unknown', () => {
    const r = run(times(20, () => ({ P: 100, R: 95 })));
    expect(r.episodes.map((e) => [e.label, e.coverage.ar])).toEqual([['walk', 0]]);
    expect(r.episodes[0]!.reasons).toContain('ring_agrees');
  });

  it('cadence stability is 1.4826 × MAD / median', () => {
    expect(robustCv([100, 100, 100])).toBe(0);
    expect(robustCv([90, 100, 110])).toBeCloseTo(0.14826, 4);
  });
});

describe('activity-recognition state', () => {
  const tr = (min: number, activity: ArActivity, transition: 'ENTER' | 'EXIT', boot = 'boot-a', epoch = 1): ArTransition => ({
    occurredMs: T0 + min * MIN + 1000, activity, transition, bootId: boot, elapsedNs: String(BigInt(min * MIN + 1000) * 1_000_000n + (boot === 'boot-a' ? 5_000_000_000n : 0n)), epoch,
  });
  const listening = [{ startMs: T0, endMs: T0 + 60 * MIN, state: 'listening', epoch: 1 }, { startMs: T0 + 60 * MIN, endMs: T0 + 120 * MIN, state: 'listening', epoch: 1 }];
  const events = [tr(0, 'STILL', 'ENTER'), tr(10, 'STILL', 'EXIT'), tr(10, 'WALKING', 'ENTER'), tr(40, 'WALKING', 'EXIT'), tr(40, 'IN_VEHICLE', 'ENTER'), tr(70, 'IN_VEHICLE', 'EXIT')];

  it('carries the state forward within listening intervals and is unknown outside them', () => {
    const s = arStateMinutes(events, listening, T0 - 10 * MIN, 140);
    expect(s[5]).toBeNull();
    expect(s[15]).toBe('STILL');
    expect(s[25]).toBe('WALKING');
    expect(s[45]).toBe('WALKING');
    expect(s[60]).toBe('IN_VEHICLE');
    // the hourly roll-over carries the state on; EXIT without ENTER is unknown
    expect(s[75]).toBe('IN_VEHICLE');
    expect(s[85]).toBeNull();
    expect(s[135]).toBeNull();
    // a gap between intervals is unknown
    const gap = arStateMinutes(events, [listening[0]!, { ...listening[1]!, startMs: T0 + 65 * MIN }], T0, 70);
    expect(gap[62]).toBeNull();
  });

  it('replayed and out-of-order batches give the identical state', () => {
    const a = arStateMinutes(events, listening, T0, 120);
    const shuffled = [events[3]!, events[0]!, events[5]!, events[1]!, events[4]!, events[2]!, events[3]!, events[0]!];
    expect(arStateMinutes(shuffled, [...listening].reverse(), T0, 120)).toEqual(a);
  });

  it('a reboot starts a new run: its events never extend the other boot\'s state, whatever the wall clock says', () => {
    // the second boot's first event carries a wall time inside the first boot's run (a clock correction)
    const rebooted = [...events.slice(0, 3), tr(20, 'STILL', 'ENTER', 'boot-b')];
    const s = arStateMinutes(rebooted, listening, T0, 60);
    expect(s[15]).toBe('WALKING');
    expect(s[25]).toBe('STILL');
    // ordered by elapsed time within a boot: an EXIT/ENTER pair at one instant applies EXIT first
    expect(arStateMinutes([tr(10, 'WALKING', 'ENTER'), tr(10, 'STILL', 'EXIT'), tr(0, 'STILL', 'ENTER')], listening, T0, 20)[15]).toBe('WALKING');
  });
});
