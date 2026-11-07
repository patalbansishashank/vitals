/**
 * The E2E fixture day of energy SPEC §S2 (tests and `fixtures/gauge-v2/*.json`): Monday 2026-10-20 in Kolkata, after
 * eight nights of history.
 *
 * - 07:00–07:30 a treadmill walk with the hands on the rails: the ring reads 0–3 steps a minute, the phone 100.
 * - 08:00–08:20 an air bike with heart rate only: no step detail, the ring's sport telemetry every 10 s.
 * - 12:00–12:15 a stroll with the phone only (no ring detail then).
 * - 17:00–17:40 a GPS walk: ring 110 and phone 105 a minute; Google Fit's copy of the phone's steps in Health Connect.
 * - The ring's daily total climbs to 9,000; its detail is complete up to the 19th only (GA.8 coverage).
 * - Heart rate every 15 min (one 190 bpm spike), stress every 30 min, the ring's step goal 8,000.
 */
import { activityDaily, gpsChunk, hcRecord, hr, lumenEvent, metric, phoneAcquisition, phoneSteps, ringSteps, sleepPacket, sportTelemetry, workout, type LumenTestEvent } from './lumenFixtures.ts';

export const FIXTURE_TZ = 'Asia/Kolkata';
export const FIXTURE_DATE = '2026-10-20';
/** When the fixture was uploaded (and the tools' clock): 23:30 on the fixture day. */
export const FIXTURE_NOW = Date.parse('2026-10-20T18:00:00Z');

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
/** A Kolkata wall time on the fixture day (`HH:MM`) as an instant. */
export const ist = (hhmm: string, date = FIXTURE_DATE) => Date.parse(`${date}T${hhmm}:00+05:30`);
const minutes = (from: number, to: number) => Array.from({ length: Math.round((to - from) / MIN) }, (_, i) => from + i * MIN);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The parity night's stages (323 min asleep): 23:00 → 04:49. */
const NIGHT: string[] = [
  ['awake', 12], ['light', 60], ['deep', 45], ['light', 40], ['awake', 6], ['rem', 30], ['light', 50], ['deep', 20], ['awake', 3], ['light', 38], ['rem', 40], ['awake', 5],
].flatMap(([s, n]) => Array.from({ length: n as number }, () => s as string));

function nightEvents(wakingDate: string, i: number): LumenTestEvent[] {
  const start = ist('23:00', addDays(wakingDate, -1)) + (i % 3) * 10 * MIN;
  const out: LumenTestEvent[] = [sleepPacket(iso(start), NIGHT, { complete: true })];
  for (let k = 12; k < 344; k += 5) out.push(hr(iso(start + k * MIN), 54 + (i % 4) - (k > 120 && k < 200 ? 4 : 0)));
  for (let k = 0; k < 6; k++) out.push(metric('hrv', 'ms', iso(start + (30 + k * 50) * MIN), 40 + i + k));
  for (let k = 0; k < 6; k++) out.push(metric('temp', '°C', iso(start + (40 + k * 50) * MIN), 35.6 + (i % 2) * 0.2));
  for (let k = 0; k < 3; k++) out.push(metric('spo2', '%', iso(start + (60 + k * 90) * MIN), 95 + k));
  return out;
}

export function fixtureDay(): LumenTestEvent[] {
  const ev: LumenTestEvent[] = [];
  // eight prior nights and the night that ends on the fixture day
  for (let i = 8; i >= 0; i--) ev.push(...nightEvents(addDays(FIXTURE_DATE, -i), i));
  // the ring's own step goal and its detail coverage (complete through the 19th)
  ev.push(lumenEvent('vendor/step_goal', 'vendor.step_goal', 'health.vendor_metric.observed', '2026-10-18T03:00:00Z', { metric: 'step_goal', value: 8000, unit: 'steps', provenance: 'device_history_estimate', quality: 'unverified', replayed: true }));
  ev.push(lumenEvent('state/sync', 'coverage.activity_detail', 'health.sync.coverage', '2026-10-20T00:30:00Z', {
    stream: 'activity_detail', from: '2026-10-11T18:30:00Z', to: '2026-10-20T00:30:00Z', fromDay: '2026-10-12', toDay: '2026-10-19', complete: true, reason: 'drained',
  }));
  // daily totals through the day (the latest is the day's)
  ev.push(activityDaily('2026-10-20T06:00:00Z', 3000), activityDaily('2026-10-20T14:00:00Z', 9000));
  // ring minute detail 06:45–09:00 and 16:30–18:30 (zeros included)
  for (const m of [...minutes(ist('06:45'), ist('09:00')), ...minutes(ist('16:30'), ist('18:30'))]) {
    let steps = 0;
    if (m >= ist('07:00') && m < ist('07:30')) steps = [0, 2, 3, 1, 0][(m / MIN) % 5]!;
    if (m >= ist('08:00') && m < ist('08:20')) continue; // the air bike: no detail
    if (m >= ist('17:00') && m < ist('17:40')) steps = 110;
    ev.push(ringSteps(iso(m), steps));
  }
  // the phone listens all day with its step detector
  ev.push(phoneAcquisition(iso(ist('06:30')), iso(ist('19:00')), 'listening'));
  for (const m of minutes(ist('07:00'), ist('07:30'))) ev.push(phoneSteps(iso(m), iso(m + MIN), 100));
  for (const m of minutes(ist('12:00'), ist('12:15'))) ev.push(phoneSteps(iso(m), iso(m + MIN), 90));
  for (const m of minutes(ist('17:00'), ist('17:40'))) ev.push(phoneSteps(iso(m), iso(m + MIN), 105));
  // Google Fit's copy of the phone's walk (the phone lineage) and its exercise session
  const fit = { origin: 'com.google.android.apps.fitness', native: false, device: { type: 2, manufacturer: 'Google', model: 'Pixel 8' } };
  ev.push(hcRecord('Steps', 'fit-walk-steps', iso(ist('17:00')), iso(ist('17:40')), { count: 4150 }, fit));
  ev.push(hcRecord('ExerciseSession', 'fit-walk', iso(ist('17:00')), iso(ist('17:40')), { exercise_type: 79, title: 'Evening walk', segments: [], laps: [], route_state: 'consentRequired' }, fit));
  // three recorded workouts
  ev.push(workout('w-treadmill', iso(ist('07:30')), { start: iso(ist('07:00')), end: iso(ist('07:30')), type: 'treadmill', source: 'gauge', durationS: 1800, distanceM: 2100, kcal: 160, avgHr: 112, maxHr: 124, zones: null, steps: 3000, route: null, moving_s: 1800, kcal_method: 'met', kcal_version: 'gauge-met/1', energy_basis: 'gross' }));
  ev.push(workout('w-airbike', iso(ist('08:20')), { start: iso(ist('08:00')), end: iso(ist('08:20')), type: 'air_bike', source: 'gauge', durationS: 1140, distanceM: null, kcal: 210, avgHr: 151, maxHr: 176, zones: { fat_burn: 200, cardio: 700, peak: 240 }, steps: null, route: null,
    moving_s: 1140, pauses: [{ start: iso(ist('08:10')), end: iso(ist('08:11')) }], kcal_method: 'hr', kcal_version: 'gauge-hr/1', energy_basis: 'gross', zones_version: 'gauge-220-age-5min' }));
  ev.push(workout('w-walk', iso(ist('17:40')), { start: iso(ist('17:00')), end: iso(ist('17:40')), type: 'walk', source: 'gauge_gps', durationS: 2400, distanceM: 3300, kcal: 180, avgHr: 104, maxHr: 118, zones: null, steps: 4400, moving_s: 2400, kcal_method: 'met', kcal_version: 'gauge-met/1', energy_basis: 'gross' }));
  ev.push(gpsChunk('w-walk', 0, Array.from({ length: 5 }, (_, k) => ({ t: iso(ist('17:00') + k * 10 * MIN), lat: 18.52 + k * 0.002, lon: 73.85 + k * 0.001 }))));
  // the air bike's sport telemetry: 10-s heart rate climbing to 172 (one 181 alone is not held)
  for (let k = 0; k < 120; k++) {
    const t = ist('08:00') + k * 10_000;
    const bpm = k === 90 ? 181 : Math.min(172, 120 + k);
    ev.push(sportTelemetry(iso(t), k * 3, k * 1.5, bpm));
  }
  // heart rate every 15 min while awake (sampled; no declared cadence), with one spike
  for (const m of minutes(ist('06:30'), ist('22:30')).filter((t) => ((t - ist('06:30')) / MIN) % 15 === 0)) {
    ev.push(hr(iso(m), m === ist('15:00') ? 190 : 68 + ((m / MIN) % 7)));
  }
  // stress every 30 min
  for (const m of minutes(ist('06:00'), ist('22:00')).filter((t) => ((t - ist('06:00')) / MIN) % 30 === 0)) {
    ev.push(metric('stress', '', iso(m), 20 + (((m - ist('06:00')) / MIN / 30) * 7) % 70));
  }
  return ev;
}
