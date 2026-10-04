import { describe, expect, it } from 'vitest';
import type { ResolvedDay, SleepRecord } from '@/biometrics/core/types';
import { addDays, daysBetween } from '@/living/dates';
import { zoneModel, zoneOf } from '../charts/zones';
import { createFixtureSignalsSource, FIXTURE_TODAY, SIGNALS_SCENARIOS } from '../fixtures';

const TZ = 7200; // fixed so absolute times do not depend on the machine
const opts = { tzOffsetS: TZ };
const LONG = Date.parse('2100-01-01T00:00:00Z');
const FIRST_TO_TODAY = (src: ReturnType<typeof createFixtureSignalsSource>) => src.days(src.firstDate() ?? FIXTURE_TODAY, FIXTURE_TODAY);
/** UTC ms of local midnight of a date at the fixed offset. */
const midnight = (d: string) => Date.parse(`${d}T00:00:00Z`) - TZ * 1000;
const hourAt = (d: string, h: number) => midnight(d) + h * 3_600_000;

const full = createFixtureSignalsSource('full', opts);
const allDays = FIRST_TO_TODAY(full);
const byDate = new Map<string, ResolvedDay>(allDays.map((d) => [d.localDate, d]));
const nights = (days: readonly ResolvedDay[]): SleepRecord[] => days.flatMap((d) => (d.mainSleep ? [d.mainSleep] : []));
const stageSeconds = (n: SleepRecord, ...st: string[]) =>
  Math.round((n.stages ?? []).filter((s) => st.includes(s.stage)).reduce((a, s) => a + (Date.parse(s.end) - Date.parse(s.start)), 0) / 1000);

describe('fixture signals source', () => {
  it('is deterministic: the same options give the same days and samples, and a different day gives a different night', async () => {
    const a = createFixtureSignalsSource('full', opts);
    const b = createFixtureSignalsSource('full', opts);
    expect(JSON.stringify(a.days('2026-08-01', FIXTURE_TODAY))).toBe(JSON.stringify(b.days('2026-08-01', FIXTURE_TODAY)));
    const dates = ['2026-10-03', '2026-10-04'];
    expect(JSON.stringify(await a.series('hr', 0, LONG, dates))).toBe(JSON.stringify(await b.series('hr', 0, LONG, dates)));
    expect(JSON.stringify(await a.baselines())).toBe(JSON.stringify(await b.baselines()));
    expect(byDate.get('2026-09-29')!.mainSleep!.stages).not.toEqual(byDate.get('2026-09-30')!.mainSleep!.stages);
  });

  it('about 400 days ending today, with every kind of record', () => {
    expect(full.firstDate()).toBe(addDays(FIXTURE_TODAY, -399));
    expect(daysBetween(full.firstDate()!, FIXTURE_TODAY)).toBeGreaterThanOrEqual(399);
    expect(full.datesWithData().length).toBeGreaterThan(300);
    expect(full.datesWithData()[full.datesWithData().length - 1]).toBe(FIXTURE_TODAY);
    expect(allDays.some((d) => d.workouts.length)).toBe(true);
    expect(allDays.some((d) => d.spots.length)).toBe(true);
    expect(full.sourceInfo('2026-09-28', FIXTURE_TODAY).labels).toEqual(['J-Style 2301']);
    expect(full.sourceInfo('2026-09-28', FIXTURE_TODAY).lastReadAt).toBe(midnight(FIXTURE_TODAY) + (14 * 60 + 24) * 60_000);
  });

  it('nights carry stages; some have unknown time and some a stretch no stage covers', () => {
    const staged = nights(allDays).filter((n) => (n.stages?.length ?? 0) > 1);
    expect(staged.length).toBeGreaterThan(200);
    const withUnknown = staged.filter((n) => stageSeconds(n, 'unknown') > 0);
    expect(withUnknown.length).toBeGreaterThan(20);
    expect(withUnknown.length).toBeLessThan(staged.length / 2);
    for (const n of withUnknown) expect(n.unknown_s).toBe(stageSeconds(n, 'unknown'));
    const gappy = staged.filter((n) => {
      const covered = (n.stages ?? []).reduce((a, s) => a + (Date.parse(s.end) - Date.parse(s.start)), 0) / 1000;
      return n.in_bed_s! - covered > 600;
    });
    expect(gappy.length).toBeGreaterThan(10);
  });

  it('stages are ordered, inside the night, and add up to the record', () => {
    for (const n of nights(allDays)) {
      const st = n.stages ?? [];
      let at = Date.parse(n.time.start!);
      for (const s of st) {
        expect(Date.parse(s.start)).toBeGreaterThanOrEqual(at);
        expect(Date.parse(s.end)).toBeGreaterThan(Date.parse(s.start));
        at = Date.parse(s.end);
      }
      expect(at).toBeLessThanOrEqual(Date.parse(n.time.end!));
      expect(n.asleep_s).toBe(stageSeconds(n, 'deep', 'light', 'rem', 'unknown'));
      expect(n.in_bed_s).toBe(Math.round((Date.parse(n.time.end!) - Date.parse(n.time.start!)) / 1000));
    }
  });

  it('one night has only unknown stages and says nothing about the others', () => {
    const only = nights(allDays).filter((n) => (n.stages?.length ?? 0) > 0 && n.stages!.every((s) => s.stage === 'unknown'));
    expect(only.map((n) => n.time.local_date)).toEqual(['2026-09-28']);
    const n = only[0]!;
    expect(n.unknown_s).toBe(n.asleep_s);
    expect(n.deep_s).toBeUndefined();
    expect(n.light_s).toBeUndefined();
    expect(n.rem_s).toBeUndefined();
    expect(n.awake_s).toBeUndefined();
  });

  it('last night is provisional, no other night is', () => {
    const prov = nights(allDays).filter((n) => n.quality.flags.includes('provisional_stages'));
    expect(prov.map((n) => n.time.local_date)).toEqual([FIXTURE_TODAY]);
    expect(Date.parse(prov[0]!.time.end!)).toBeLessThan(hourAt(FIXTURE_TODAY, 14));
  });

  it('there is a nap one afternoon, kept apart from the main night', () => {
    const naps = allDays.flatMap((d) => d.sleeps.filter((s) => !s.is_main));
    expect(naps).toHaveLength(1);
    const day = byDate.get('2026-10-03')!;
    expect(day.sleeps).toHaveLength(2);
    expect(day.mainSleep!.is_main).toBe(true);
    const nap = naps[0]!;
    expect(nap.asleep_s).toBeLessThan(3 * 3600);
    expect(Date.parse(nap.time.start!)).toBeGreaterThanOrEqual(hourAt('2026-10-03', 12));
    expect(Date.parse(nap.time.end!)).toBeLessThan(hourAt('2026-10-03', 17));
  });

  it('the current week and month have missing nights and days, and so do older months', () => {
    const week = full.days('2026-09-28', FIXTURE_TODAY);
    // Thu 1 Oct: nothing at all; Fri 2 Oct: a day but no night
    expect(byDate.has('2026-10-01')).toBe(false);
    expect(byDate.get('2026-10-02')!.daily).toBeTruthy();
    expect(byDate.get('2026-10-02')!.mainSleep).toBeUndefined();
    expect(nights(week)).toHaveLength(5);
    expect(week.filter((d) => d.daily)).toHaveLength(6);
    // the month so far: Oct 1 has no day
    const month = full.days('2026-10-01', FIXTURE_TODAY);
    expect(month.map((d) => d.localDate)).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
    // some months: one is empty, others miss days
    const perMonth = new Map<string, number>();
    for (const d of allDays) perMonth.set(d.localDate.slice(0, 7), (perMonth.get(d.localDate.slice(0, 7)) ?? 0) + 1);
    expect(perMonth.has('2026-06')).toBe(false);
    expect(perMonth.get('2026-09')).toBeLessThan(30);
    expect(perMonth.get('2026-09')).toBeGreaterThan(20);
    expect(perMonth.get('2026-03')).toBeLessThan(31);
  });

  it('missing is missing: a missing day has no samples either', async () => {
    for (const metric of ['hr', 'steps', 'battery'] as const) expect(await full.series(metric, 0, LONG, ['2026-10-01'])).toEqual([]);
    expect(await full.series('spo2', hourAt('2026-10-01', 0), hourAt('2026-10-02', 12), ['2026-10-01', '2026-10-02'])).toEqual([]);
  });

  it('heart rate is sampled every 5 minutes while worn, with gaps where the ring was off', async () => {
    const hr = await full.series('hr', 0, LONG, ['2026-10-03']);
    expect(hr.length).toBeGreaterThan(250);
    const steps = hr.slice(1).map((p, i) => p.t - hr[i]!.t);
    expect(steps.filter((s) => s === 300_000).length / steps.length).toBeGreaterThan(0.95);
    // the ring charges 19:00-20:00 on Fri 2 Oct (every sixth day): no samples, no steps record in that hour
    const fri = await full.series('hr', 0, LONG, ['2026-10-02']);
    expect(fri.some((p) => p.t >= hourAt('2026-10-02', 19) && p.t < hourAt('2026-10-02', 20))).toBe(false);
    expect(fri.some((p) => p.t >= hourAt('2026-10-02', 18) && p.t < hourAt('2026-10-02', 19))).toBe(true);
    const fsteps = await full.series('steps', 0, LONG, ['2026-10-02']);
    expect(fsteps.some((p) => p.t === hourAt('2026-10-02', 19))).toBe(false);
    expect(fsteps.some((p) => p.t === hourAt('2026-10-02', 18))).toBe(true);
    for (const p of hr) expect(Number.isInteger(p.v)).toBe(true);
  });

  it('today stops at 14:30; nothing is in the future', async () => {
    const hr = await full.series('hr', 0, LONG, [FIXTURE_TODAY]);
    expect(Math.max(...hr.map((p) => p.t))).toBeLessThanOrEqual(hourAt(FIXTURE_TODAY, 14) + 30 * 60_000);
    expect(Math.max(...hr.map((p) => p.t))).toBeGreaterThan(hourAt(FIXTURE_TODAY, 14));
    const steps = await full.series('steps', 0, LONG, [FIXTURE_TODAY]);
    expect(Math.max(...steps.map((p) => p.t))).toBe(hourAt(FIXTURE_TODAY, 14));
    expect(await full.series('hr', 0, LONG, [addDays(FIXTURE_TODAY, 1)])).toEqual([]);
  });

  it('steps per hour include a worn hour with 0 steps (a record that says 0), not just a missing hour', async () => {
    for (const day of [FIXTURE_TODAY, '2026-10-03', '2026-09-30']) {
      const steps = await full.series('steps', 0, LONG, [day]);
      const daytimeZero = steps.filter((p) => p.v === 0 && p.t >= hourAt(day, 9) && p.t <= hourAt(day, 17));
      expect(daytimeZero.length, day).toBeGreaterThanOrEqual(1);
      // and the night's worn hours say 0 too
      expect(steps.filter((p) => p.v === 0 && p.t < hourAt(day, 5)).length, day).toBeGreaterThan(2);
      expect(steps.some((p) => p.v > 0)).toBe(true);
    }
    const today = byDate.get(FIXTURE_TODAY)!.daily!;
    const hours = await full.series('steps', 0, LONG, [FIXTURE_TODAY]);
    expect(today.steps).toBe(hours.reduce((a, p) => a + p.v, 0));
  });

  it('workouts reach zones 3 and 4; one was logged by hand', () => {
    const z = zoneModel({ ageYears: 41 })!;
    const run = byDate.get(FIXTURE_TODAY)!.workouts[0]!;
    expect(run.exercise_type).toBe('running');
    expect(zoneOf(run.hr_max_bpm!, z)).toBe(4);
    expect(run.hr_zones_s![2]).toBeGreaterThan(0);
    expect(run.hr_zones_s![3]).toBeGreaterThan(0);
    expect(run.hr_zones_s!.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(run.active_duration_s + 300);
    const hand = allDays.filter((d) => d.workouts.some((w) => w.provenance.channel === 'manual'));
    expect(hand.map((d) => d.localDate)).toEqual(['2026-09-26']);
    const w = hand[0]!.workouts[0]!;
    expect(w.provenance.recording_method).toBe('manual');
    expect(w.hr_avg_bpm).toBeUndefined();
    expect(hand[0]!.basisByMetric.workouts).toBe('manual');
    const types = new Set(allDays.flatMap((d) => d.workouts.map((x) => x.exercise_type)));
    expect([...types].sort()).toEqual(['biking', 'running', 'strength_training', 'walking']);
  });

  it('spot checks sit on the day they were taken', () => {
    const today = byDate.get(FIXTURE_TODAY)!;
    expect(today.spots.map((s) => s.metric).sort()).toEqual(['hr_bpm', 'hrv_ms', 'spo2_pct']);
    for (const s of today.spots) expect(Date.parse(s.time.at!)).toBeLessThan(hourAt(FIXTURE_TODAY, 14));
  });

  it('daily numbers agree with the samples', async () => {
    for (const day of [FIXTURE_TODAY, '2026-10-03', '2026-09-30']) {
      const d = byDate.get(day)!;
      const hr = await full.series('hr', 0, LONG, [day]);
      expect(d.daily!.hr_max_bpm).toBe(Math.max(...hr.map((p) => p.v)));
      expect(d.daily!.hr_min_bpm).toBe(Math.min(...hr.map((p) => p.v)));
      expect(d.daily!.resting_hr_bpm).toBeGreaterThanOrEqual(d.daily!.hr_min_bpm!);
    }
    const d = byDate.get('2026-09-30')!;
    const spo2 = await full.series('spo2', Date.parse(d.mainSleep!.time.start!), Date.parse(d.mainSleep!.time.end!), ['2026-09-29', '2026-09-30']);
    expect(d.daily!.spo2_min_pct).toBe(Math.min(...spo2.map((p) => p.v)));
    expect(d.daily!.spo2_min_pct).toBeLessThanOrEqual(92); // the night with a dip
    const bed = Date.parse(d.mainSleep!.time.start!);
    const wake = Date.parse(d.mainSleep!.time.end!);
    const temp = await full.series('skin_temp', bed, wake, ['2026-09-29', '2026-09-30']);
    const abs = d.daily!.skin_temp_c!;
    expect(abs).toBeCloseTo(temp.reduce((a, p) => a + p.v, 0) / temp.length, 1);
    expect(d.daily!.skin_temp_delta_c).toBeCloseTo(abs - 33.5, 1);
    expect(d.daily!.hrv!.metric).toBe('rmssd');
  });

  it('overnight series follow the night and are split by the local date they fall on', async () => {
    // a night that starts before midnight
    const n = nights(full.days('2026-09-14', '2026-09-30')).find((x) => Date.parse(x.time.start!) < midnight(x.time.local_date) - 3_600_000)!;
    const wakeDate = n.time.local_date;
    const evening = addDays(wakeDate, -1);
    const bed = Date.parse(n.time.start!);
    const wake = Date.parse(n.time.end!);
    const both = await full.series('hrv', bed, wake, [evening, wakeDate]);
    expect(both.length).toBeGreaterThan(8);
    expect(both.some((p) => p.t < midnight(wakeDate))).toBe(true);
    expect(both.some((p) => p.t >= midnight(wakeDate))).toBe(true);
    // asking for the wake date alone gives only the part after midnight
    const morning = await full.series('hrv', bed, wake, [wakeDate]);
    expect(morning.length).toBeLessThan(both.length);
    expect(morning.every((p) => p.t >= midnight(wakeDate))).toBe(true);
  });

  it('series respects the range asked for', async () => {
    const from = hourAt('2026-10-03', 8);
    const to = hourAt('2026-10-03', 10);
    const hr = await full.series('hr', from, to, ['2026-10-03']);
    expect(hr.length).toBe(25);
    expect(hr[0]!.t).toBe(from);
    expect(hr[hr.length - 1]!.t).toBe(to);
    const battery = await full.series('battery', 0, LONG, ['2026-10-03']);
    expect(battery.length).toBe(8);
    expect(battery.every((p) => p.v >= 8 && p.v <= 100)).toBe(true);
  });

  it('person, goals and baselines', async () => {
    expect(full.person()).toEqual({ ageYears: 41, goals: { steps: 8000, activeMin: 30, sleepH: 8 }, vendorScores: false, tempUnit: 'C' });
    const b = await full.baselines();
    expect(b.map((x) => x.metric).sort()).toEqual(['hrv_rmssd_ms', 'resting_hr_bpm', 'skin_temp_delta_c', 'sleep_h', 'spo2_avg_pct']);
    for (const x of b) {
      expect(x.nights).toBeGreaterThanOrEqual(14);
      expect(x.forming).toBe(false);
      expect(x.lo).toBeLessThan(x.mean);
      expect(x.hi).toBeGreaterThan(x.mean);
    }
  });

  it('days is a cheap, stable read', () => {
    expect(full.days('2026-09-28', FIXTURE_TODAY)).toBe(full.days('2026-09-28', FIXTURE_TODAY));
    expect(full.days(addDays(FIXTURE_TODAY, 1), addDays(FIXTURE_TODAY, 9))).toEqual([]);
    expect(full.revision()).toBe(1);
  });

  it('moves with "today" and with the zone', () => {
    const later = createFixtureSignalsSource('full', { today: '2026-11-15', tzOffsetS: () => 3600 });
    expect(later.datesWithData().pop()).toBe('2026-11-15');
    expect(later.days('2026-11-15', '2026-11-15')[0]!.daily!.time.tz_offset_s).toBe(3600);
  });
});

describe('scenarios', () => {
  it('lists them all', () => {
    expect([...SIGNALS_SCENARIOS]).toEqual(['full', 'noAge', 'empty', 'sparse', 'vendor']);
  });

  it('noAge is full without an age and without zones', () => {
    const s = createFixtureSignalsSource('noAge', opts);
    expect(s.person().ageYears).toBeUndefined();
    expect(s.person().goals.steps).toBe(8000);
    const days = FIRST_TO_TODAY(s);
    expect(days.length).toBe(allDays.length);
    expect(days.flatMap((d) => d.workouts).some((w) => w.hr_zones_s)).toBe(false);
    expect(days.flatMap((d) => d.workouts).filter((w) => w.provenance.channel !== 'manual').every((w) => w.hr_max_bpm)).toBe(true);
  });

  it('empty has nothing ever', async () => {
    const s = createFixtureSignalsSource('empty', opts);
    expect(s.firstDate()).toBeNull();
    expect(s.datesWithData()).toEqual([]);
    expect(s.days('2025-01-01', FIXTURE_TODAY)).toEqual([]);
    expect(await s.series('hr', 0, LONG, [FIXTURE_TODAY])).toEqual([]);
    expect(await s.baselines()).toEqual([]);
    expect(s.sourceInfo('2026-01-01', FIXTURE_TODAY)).toEqual({ labels: [], lastReadAt: null });
    expect(s.person().ageYears).toBe(41);
  });

  it('sparse has three days of last week and nothing in the current period', async () => {
    const s = createFixtureSignalsSource('sparse', opts);
    expect(s.datesWithData()).toEqual(['2026-09-22', '2026-09-24', '2026-09-26']);
    expect(s.firstDate()).toBe('2026-09-22');
    expect(s.days('2026-09-28', FIXTURE_TODAY)).toEqual([]);
    expect(s.days('2026-09-21', '2026-09-27').map((d) => d.localDate)).toEqual(['2026-09-22', '2026-09-24', '2026-09-26']);
    expect(await s.series('hr', 0, LONG, ['2026-10-03', FIXTURE_TODAY])).toEqual([]);
    expect((await s.series('hr', 0, LONG, ['2026-09-24'])).length).toBeGreaterThan(100);
    // the ring was last read on the last day with data, before the current week
    const info = s.sourceInfo('2026-09-28', FIXTURE_TODAY);
    expect(info.labels).toEqual([]);
    expect(info.lastReadAt).toBeLessThan(midnight('2026-09-28'));
    expect(s.sourceInfo('2026-09-21', '2026-09-27').labels).toEqual(['J-Style 2301']);
    // three nights: a normal that is still forming
    const b = await s.baselines();
    expect(b.length).toBeGreaterThan(0);
    expect(b.every((x) => x.forming && x.nights === 3)).toBe(true);
  });

  it('vendor is full with the ring maker scores on', () => {
    const s = createFixtureSignalsSource('vendor', opts);
    expect(s.person().vendorScores).toBe(true);
    const d = s.days(FIXTURE_TODAY, FIXTURE_TODAY)[0]!;
    expect(d.daily!.vendor!.sleep).toBeGreaterThan(0);
    expect(d.daily!.vendor!.stress!.value).toBeGreaterThanOrEqual(0);
    expect(byDate.get(FIXTURE_TODAY)!.daily!.vendor).toBeUndefined();
  });

  it('carries no ring brand, raw ids on view, or personal data in what the pages can print', () => {
    const labels = [full.sourceInfo('2025-01-01', FIXTURE_TODAY).labels.join(' ')];
    expect(labels.join(' ')).toBe('J-Style 2301');
    const d = byDate.get(FIXTURE_TODAY)!;
    expect(d.mainSleep!.provenance.device).toMatchObject({ manufacturer: 'J-Style', model: '2301' });
  });
});
