/**
 * Synthetic, deterministic activity data for Progress's tests and screenshot harness (labelled synthetic, PRODUCT.md
 * "Evidence on hand"): ten weeks of Heart Points, sessions with stated intensity, energy out with a ±25 % scenario
 * envelope, logged intake with a few gaps; fused steps, sleep metrics and baselines in the §2.2 shapes.
 */
import type { StimulusVector } from '@/catalogues/types';
import type { LocalDate } from '@/living';
import { addDays, daysBetween, weekdayOf } from '@/living/dates';
import type { GaugeBaselines, GaugeProvenance, GaugeSleep, GaugeSleepMetrics, GaugeSleepSession, GaugeStepDay, GaugeSteps } from '@/net/gauge';
import type { ProgressGauge } from '../data/gauge';
import type { ProgressActualsAdapter, ProgressDayActual } from '../v3Adapter';

/** A small deterministic noise in [−1, 1) from a date and a channel. */
export function noise(date: LocalDate, ch: number): number {
  let h = 2166136261 ^ ch;
  for (const c of date) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 2000) / 1000 - 1;
}

/** A cardio session's stimulus with stated moderate and vigorous minutes (the engine's D3-03 guideline minutes). */
export function cardioStimulus(moderateMin: number, vigorousMin: number, unknownMin = 0): StimulusVector {
  const minutes = moderateMin + vigorousMin + unknownMin;
  return {
    effectiveSetsByRegion: {},
    pattern: 'locomotion',
    loadClass: 'veryLight',
    netKcal: minutes * 6,
    mem: minutes,
    hiMinutes: vigorousMin,
    mobilityMinutes: {},
    minutes,
    healthModerateMin: unknownMin > 0 ? null : moderateMin,
    healthVigorousMin: unknownMin > 0 ? null : vigorousMin,
    ...(unknownMin > 0 ? { healthKnownModerateMin: moderateMin, healthKnownVigorousMin: vigorousMin, healthUnknownMin: unknownMin } : {}),
  } as StimulusVector;
}

export function demoActuals(today: LocalDate, days = 84): ProgressDayActual[] {
  const out: ProgressDayActual[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const wd = weekdayOf(date);
    const k = days - 1 - i; // 0 = oldest
    const ramp = Math.min(1, 0.55 + k / 120); // a slowly rising habit
    const session = wd === 1 || wd === 3 || wd === 5 || (wd === 6 && k % 2 === 0);
    const vig = session ? Math.round(8 + 6 * ramp + 4 * noise(date, 3)) : 0;
    const mod = session ? Math.round(24 + 10 * noise(date, 4)) : 0;
    const walk = Math.max(0, Math.round(10 + 6 * noise(date, 5)));
    const off = noise(date, 9) > 0.86; // ring off: no coverage that day
    const out0 = 2420 + 260 * ramp * (session ? 1 : 0.2) + 90 * noise(date, 6);
    const logged = noise(date, 7) > -0.7 && i > 0;
    out.push({
      date,
      heartPoints: off ? null : Math.max(0, Math.round((2 * vig + mod + walk) * ramp)),
      sessionStimuli: session ? [cardioStimulus(mod, vig)] : [],
      energyOut: i === 0 ? null : { kcal: out0, envelope: { lo: out0 * 0.87, hi: out0 * 1.13 } },
      intakeKcal: logged ? Math.round(1980 + 160 * noise(date, 8)) : null,
    });
  }
  return out;
}

export const demoActualsAdapter = (today: LocalDate): ProgressActualsAdapter => {
  const all = demoActuals(today, 120);
  return { progressActuals: (from, to) => all.filter((a) => a.date >= from && a.date <= to) };
};

const PROV: GaugeProvenance = {
  source: 'lumen_health',
  timeZone: 'Europe/London',
  installations: [{ id: 'gauge-1', deviceName: 'Pixel 8', appVersion: '2.4.0', lastUploadAt: '2026-10-01T07:40:00Z' }],
  freshness: { lastUploadAt: '2026-10-01T07:40:00Z', lastReadingAt: '2026-10-01T07:38:00Z', minutesSinceLastUpload: 12, minutesSinceLastReading: 14 },
};

export function demoStepDays(today: LocalDate, days = 28): GaugeStepDay[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, -(days - 1 - i));
    const wd = weekdayOf(date);
    const base = wd >= 5 ? 10_800 : 8_200;
    const located = Math.max(0, Math.round(base + 2400 * noise(date, 11)));
    const residual = noise(date, 12) > 0.55 ? Math.round(600 + 500 * noise(date, 13)) : 0;
    const off = i === days - 9; // no coverage
    return {
      date,
      located: off ? 0 : located,
      ringDailyTotal: off ? null : located + residual,
      ringResidual: residual,
      phoneDailyTotal: off ? null : Math.round(located * 0.8),
      headline: off ? 0 : located + residual,
      headlinePolicy: 'atLeast',
      coverage: off ? { ringMin: 0, phoneMin: 0, eitherMin: 0, unknownMin: 1440 } : { ringMin: 1300, phoneMin: 900, eitherMin: 1380, unknownMin: 60 },
    };
  });
}

function metrics(date: LocalDate, k: number): GaugeSleepMetrics {
  const low = Math.round(52 + 2.4 * noise(date, 21) + (k > 20 ? -1 : 0));
  const hrv = Math.round(46 + 7 * noise(date, 22) + (k > 18 ? 3 : 0));
  return {
    version: 'sleep-metrics/1',
    K: 430,
    A: 30,
    U: 0,
    G: 0,
    tstLowerMin: 430,
    tstUpperMin: 430,
    onset: `${addDays(date, -1)}T23:20:00+01:00`,
    finalWake: `${date}T06:50:00+01:00`,
    midpoint: `${date}T03:05:00+01:00`,
    windowContinuityPct: 93,
    wasoMin: 22,
    awakeningRuns: 3,
    restorativeEstimatedMin: 160,
    avgSleepHr: null,
    sampledMeanSleepHr: { bpm: low + 6, n: 60 },
    nightlyLowHrP10: low,
    timeToLowMin: null,
    timeToLowReason: 'cadenceUnknown',
    trace5min: [],
    hrvNightlyMs: noise(date, 23) > 0.85 ? null : hrv,
    skinTempNightC: 34.1,
    respRate: null,
    tossesTurns: null,
    sleepLatency: null,
    nativeEpochS: 60,
    coveragePct: 100,
  };
}

export function demoSleep(from: LocalDate, to: LocalDate): GaugeSleep {
  const n = daysBetween(from, to) + 1;
  const sessions: GaugeSleepSession[] = [];
  for (let k = 0; k < n; k++) {
    const date = addDays(from, k);
    if (noise(date, 20) > 0.9) continue; // ring off that night
    sessions.push({
      wakingDate: date,
      start: `${addDays(date, -1)}T23:05:00+01:00`,
      end: `${date}T07:00:00+01:00`,
      inBedMinutes: 475,
      asleepMinutes: 430,
      minutes: { deep: 80, light: 260, rem: 90, awake: 30, unknown: 0 },
      efficiencyPercent: 91,
      blocks: [],
      metrics: metrics(date, k),
    });
  }
  return { ...PROV, from, to, units: { hr: 'bpm', hrv: 'ms' }, sessions };
}

export function demoBaselines(date: LocalDate, over: Partial<GaugeBaselines> = {}): GaugeBaselines {
  return {
    ...PROV,
    date,
    usualOnset: null,
    usualWake: null,
    usualMidpoint: null,
    sleepLowHr: { median: 53, s: 3, n: 14, spanDays: 15 },
    hrvBaseline: { median: Math.log(46), s: 0.18, medianMs: 46, n: 26, spanDays: 28 },
    tempBaseline: null,
    sampledIdleHr: null,
    learning: { nights: 26, needed: 7, learning: false },
    ...over,
  };
}

export function demoGauge(over: { baselines?: Partial<GaugeBaselines> } = {}): ProgressGauge {
  return {
    steps: async (from, to): Promise<GaugeSteps> => ({ ...PROV, fusionVersion: 'steps-fuse/1', intervals: [], days: demoStepDays(to, daysBetween(from, to) + 1) }),
    sleep: async (from, to) => demoSleep(from, to),
    baselines: async (date) => demoBaselines(date, over.baselines),
  };
}
