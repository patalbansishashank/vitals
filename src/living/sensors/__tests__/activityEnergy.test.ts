// @vitest-environment node
/** activityEnergy gating and equations (energy SPEC §V2.4, D2) and projectActivity (§V2.9). */
import { describe, expect, it } from 'vitest';
import { activityEnergy, exerciseRecordOf, intensityClassOf, keytelKcalPerMin, keytelKjPerMin } from '../activityEnergy';
import { projectActivity } from '../projectActivity';
import type { HrSegment } from '../types';

const T0 = Date.UTC(2026, 9, 20, 6, 0, 0);
const MIN = 60_000;
const hr10s = (start: number, n: number, bpm: number): HrSegment[] => Array.from({ length: n }, (_, k) => ({ start: start + k * 10_000, end: start + (k + 1) * 10_000, bpm }));
const BASE = { massKg: 80, ageY: 35, sex: 'male' as const, rmrKcalPerDay: 1800 };
const hrOf = (minutes: number, bpm: number, supportedMin = minutes) => ({ segments: hr10s(T0, supportedMin * 6, bpm), window: { start: T0, end: T0 + minutes * MIN } });

describe('Keytel 2005', () => {
  it('female mass coefficient is negative; kcal = kJ / 4.184', () => {
    // female, HR 140, 60 kg, 30 y: −20.4022 + 62.608 − 7.578 + 2.22 = 36.8478 kJ/min = 8.8068 kcal/min
    expect(keytelKjPerMin('female', 140, 60, 30)).toBeCloseTo(36.8478, 4);
    expect(keytelKcalPerMin('female', 140, 60, 30)).toBeCloseTo(36.8478 / 4.184, 6);
    expect(keytelKjPerMin('female', 140, 70, 30)).toBeLessThan(keytelKjPerMin('female', 140, 60, 30));
    expect(keytelKjPerMin('male', 140, 70, 30)).toBeGreaterThan(keytelKjPerMin('male', 140, 60, 30));
    expect(keytelKcalPerMin('male', 140, 80, 35)).not.toBeCloseTo(keytelKjPerMin('male', 140, 80, 35), 0);
  });
});

describe('gating', () => {
  it('resistance and gripping work never use HR energy', () => {
    for (const id of ['strength_general', 'mudgar_two_hand', 'circuit_kb']) {
      const e = activityEnergy({ exerciseId: id, durationMin: 40, ...BASE, hr: hrOf(40, 150) });
      expect(e.booked.estimator, id).toBe('met');
      expect(e.comparisons.some((c) => c.estimator === 'keytel'), id).toBe(false);
    }
  });

  it('D2 off books MET and keeps Keytel as a comparison', () => {
    const e = activityEnergy({ exerciseId: 'stationary_bike', durationMin: 30, ...BASE, d2Keytel: false, hr: hrOf(30, 140) });
    expect(e.booked.estimator).toBe('met');
    const k = e.comparisons.find((c) => c.estimator === 'keytel')!;
    expect(k.bookable).toBe(false);
    expect(k.domainFlags).toContain('d2Off');
  });

  it('Keytel needs the coefficient set, coverage ≥ 60 % and median ≥ 90 bpm; intervals never qualify', () => {
    const r = (extra: object) => activityEnergy({ exerciseId: 'stationary_bike', durationMin: 30, ...BASE, ...extra });
    expect(r({ sex: null, hr: hrOf(30, 140) }).rejected).toContainEqual({ estimator: 'keytel', reason: 'coefficientSetUnknown' });
    expect(r({ hr: hrOf(30, 140, 15) }).rejected).toContainEqual({ estimator: 'keytel', reason: 'hrCoverageLow' });
    expect(r({ hr: hrOf(30, 85) }).rejected).toContainEqual({ estimator: 'keytel', reason: 'hrMedianLow' });
    expect(r({ steady: false, hr: hrOf(30, 160) }).rejected).toContainEqual({ estimator: 'keytel', reason: 'notSteady' });
    expect(r({ hr: hrOf(30, 140) }).booked.estimator).toBe('keytel');
  });

  it('unsupported moving seconds get the MET estimate and both parts are reported', () => {
    const e = activityEnergy({ exerciseId: 'stationary_bike', durationMin: 30, ...BASE, hr: hrOf(30, 140, 24) });
    const p = e.booked.parts!;
    expect(p.hrSupportedS).toBe(24 * 60);
    expect(p.metS).toBe(6 * 60);
    expect(p.hrKcal).toBeCloseTo(keytelKcalPerMin('male', 140, 80, 35) * 24, 6);
    expect(p.metKcal).toBeCloseTo((exerciseRecordOf('stationary_bike')!.energy.metGross * 3.5 * 5 * 80 * 6) / 1000, 6);
    expect(e.booked.grossKcal).toBeCloseTo(p.hrKcal + p.metKcal, 9);
    expect(e.booked.domainFlags).toContain('mixedWithMet');
  });

  it('outside 18-45 y or 47-120 kg the envelope widens to ±50 %; a manual average HR is ±50 % and flagged', () => {
    const old = activityEnergy({ exerciseId: 'walk', durationMin: 30, ...BASE, ageY: 60, hr: hrOf(30, 120) });
    expect(old.booked.estimator).toBe('keytel');
    expect(old.booked.domainFlags).toContain('outsideKeytelSample');
    expect(old.booked.envelope.hi / old.booked.grossKcal).toBeCloseTo(1.5, 9);
    const ok = activityEnergy({ exerciseId: 'walk', durationMin: 30, ...BASE, hr: hrOf(30, 120) });
    expect(ok.booked.envelope.hi / ok.booked.grossKcal).toBeCloseTo(1.4, 9);
    const man = activityEnergy({ exerciseId: 'walk', durationMin: 30, ...BASE, manualAvgHr: 120 });
    expect(man.booked.domainFlags).toContain('manualAverageHr');
    expect(man.booked.envelope.hi / man.booked.grossKcal).toBeCloseTo(1.5, 9);
    expect(man.hrSummary!.method).toBe('manual');
  });

  it('a reported value wins; power needs verification; outdoor cycling never uses GPS speed', () => {
    const rep = activityEnergy({ exerciseId: 'walk', durationMin: 30, ...BASE, reported: { grossKcal: 210, provenance: 'treadmill console' }, speed: { kmh: 5, source: 'belt' } });
    expect(rep.booked.estimator).toBe('reported');
    expect(rep.cost.method).toBe('reported');
    expect(rep.booked.provenance).toBe('treadmill console');
    const unverified = activityEnergy({ exerciseId: 'stationary_bike', durationMin: 30, ...BASE, power: { avgW: 120, verified: false } });
    expect(unverified.rejected).toContainEqual({ estimator: 'power', reason: 'powerNotVerified' });
    const verified = activityEnergy({ exerciseId: 'stationary_bike', durationMin: 30, ...BASE, power: { avgW: 100, verified: true } });
    // ACSM leg ergometry: VO2 = 7 + 1.8·611.83/80 = 20.766 → 20.766·80·30·5/1000 = 249.2 kcal (100 W is not 100 kcal/min)
    expect(verified.booked.estimator).toBe('power');
    expect(verified.booked.grossKcal).toBeCloseTo(((7 + (1.8 * 6.1183 * 100) / 80) * 80 * 30 * 5) / 1000, 6);
    const eta = activityEnergy({ exerciseId: 'stationary_bike', durationMin: 30, ...BASE, power: { avgW: 100, verified: true, efficiency: 0.22 } });
    expect(eta.booked.version).toBe('power-eff/1');
    expect(eta.booked.grossKcal).toBeCloseTo((1800 / 1440 + 6000 / (4184 * 0.22)) * 30, 6);
    const bike = activityEnergy({ exerciseId: 'cycle_outdoor', durationMin: 30, ...BASE, sex: null, speed: { kmh: 22, source: 'gps' } });
    expect(bike.booked.estimator).toBe('met');
    expect(bike.rejected.some((r) => r.estimator === 'speedGrade')).toBe(false);
  });

  it('MET matching by class: stated, talk test, generic 0-10 rating; CR10 leaves it unknown (±50 %)', () => {
    expect(intensityClassOf({ talkTest: 'fewWords' })).toBe('vigorous');
    expect(intensityClassOf({ rating: 6, ratingScale: 'relativeEffort0To10' })).toBe('moderate');
    expect(intensityClassOf({ rating: 6, ratingScale: 'cr10' })).toBe('unknown');
    const vig = activityEnergy({ exerciseId: 'walk', durationMin: 60, ...BASE, intensity: { class: 'vigorous' } });
    expect(vig.booked.grossKcal).toBeCloseTo((4.8 * 3.5 * 5 * 80 * 60) / 1000, 6);
    expect(vig.booked.envelope.hi / vig.booked.grossKcal).toBeCloseTo(1.3, 9);
    const unk = activityEnergy({ exerciseId: 'walk', durationMin: 60, ...BASE });
    expect(unk.booked.envelope.hi / unk.booked.grossKcal).toBeCloseTo(1.5, 9);
  });

  it('every booked estimate feeds the ledger and the engine dose with the same G', () => {
    const e = activityEnergy({ exerciseId: 'treadmill_run', durationMin: 25, ...BASE, speed: { kmh: 11, gradeFrac: 0.01, source: 'belt' } });
    expect(e.cost.grossKcal).toBe(e.booked.grossKcal);
    expect(e.engineDose!.realisedGrossKcal).toBe(e.booked.grossKcal);
    expect(e.cost.estimatorVersion).toBe('acsm-run/1');
    expect(e.cost.uncertaintyKind).toBe('scenario');
    expect(Number.isFinite(e.cost.incrementalKcal!)).toBe(true);
  });
});

describe('projectActivity', () => {
  it('future dose only: speed/grade energy, class points, no zones, steps only with a calibrated step length', () => {
    const p = projectActivity({ exerciseId: 'treadmill_incline_walk', durationMin: 30, massKg: 80, rmrKcalPerDay: 1800, speedKmh: 6, gradeFrac: 0.05, speedSource: 'belt' });
    expect(p.G).toBeCloseTo(270, 6);
    expect(p.I).toBeCloseTo(225, 6);
    expect(p.zoneDistribution).toBeNull();
    expect(p.stepsIncluded).toBeNull();
    // 22.5 mL/kg/min = 6.43 MET, envelope ±25 % → 4.8-8.0 MET → 1-2 points/min
    expect(p.pointsRange).toEqual({ lo: 30, hi: 60 });
    const q = projectActivity({ exerciseId: 'walk', durationMin: 30, massKg: 80, rmrKcalPerDay: 1800, intensityClass: 'moderate', speedKmh: 5, stepLengthM: 0.7 });
    expect(q.pointsRange).toEqual({ lo: 30, hi: 30 });
    expect(q.stepsIncluded).toBe(Math.round(2500 / 0.7));
    const rt = projectActivity({ exerciseId: 'strength_general', durationMin: 45, massKg: 80, rmrKcalPerDay: 1800 });
    expect(rt.method).toBe('compendiumMet');
    expect(rt.stepsIncluded).toBeNull();
  });
});
