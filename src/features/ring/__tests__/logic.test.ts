/** The Ring's pure joins: goals (A.1.4), the indices (V2), the monitor catalogue (A.1.3), the command words (C), zones (V2). */
import './clock';
import { nightView, usualLine, vsUsualClock } from '@/features/living/sleep/model';
import { setSleepEntry, timeOnNight } from '@/features/living/sleep/entry';
import { DEFAULT_STEP_GOAL, goalsFrom, plannedSleepMin } from '../goals';
import { dayArcs, ringScores } from '../indices';
import {
  MONITOR_CATALOGUE,
  MONITOR_DEFAULT,
  availableSources,
  offeredEntries,
  shownIds,
} from '../monitor/catalogue';
import { entryValue, personal } from '../monitor/values';
import { failureWords, measureWords, reelsWords, syncWords, updateWords } from '../commands';
import { makeGaugeFixture } from '../fixtures';
import { calendarDate, mainSession, shiftDate } from '../model';
import { RING_COPY } from '../copy';
import { stepsHeadlineOf } from '../day';
import { lineModel, lineTwin } from '@/components';
import { signalLine } from '../views/detailSeries';
import { basedOnText, parseTarget } from '../views/DayScoreCard';
import { avgReadings } from '@/features/living/sleep/sections';
import {
  currentHrProfile,
  exactSegments,
  frozenBoundariesFor,
  workoutZones,
  zoneBasisText,
  zoneSourceOf,
} from '../zones';
import { freezeZoneBoundaries } from '@/living/sensors';
import type { GaugeCommandView } from '@/state/gaugeCommands';
import { formatNumber } from '@/components';

const today = calendarDate(Date.now());

describe('goals (A.1.4: the plan, then the ring, then the default)', () => {
  it('takes steps from the plan, else the ring’s own goal, else 10 000 as a default', () => {
    expect(goalsFrom({ planSteps: 7500, ringStepGoal: 9000 }).steps).toEqual({ value: 7500, source: 'plan' });
    expect(goalsFrom({ ringStepGoal: 9000 }).steps).toEqual({ value: 9000, source: 'ring' });
    expect(goalsFrom({}).steps).toEqual({ value: DEFAULT_STEP_GOAL, source: 'default' });
  });

  it('takes sleep from the plan’s bed and wake times, clamped 420–720; else 480', () => {
    expect(plannedSleepMin(23, 7)).toBe(480);
    expect(plannedSleepMin(22.5, 6)).toBe(450);
    expect(goalsFrom({ planSleep: { bedH: 23, wakeH: 6 } }).sleepMin).toEqual({ value: 420, source: 'plan' });
    expect(goalsFrom({ planSleep: { bedH: 0, wakeH: 5 } }).sleepMin.value).toBe(420);
    expect(goalsFrom({}).sleepMin).toEqual({ value: 480, source: 'default' });
  });

  it('has no active-energy goal unless the plan or the person sets one (D20), and the Day score target defaults to 70', () => {
    expect(goalsFrom({}).activeKcal).toBeNull();
    expect(goalsFrom({ activeEnergyGoalKcal: 450 }).activeKcal).toEqual({ value: 450, source: 'setting' });
    expect(goalsFrom({ planActiveKcal: 380, activeEnergyGoalKcal: 450 }).activeKcal!.source).toBe('plan');
    expect(goalsFrom({}).dayScore).toBe(70);
    expect(goalsFrom({ dayScoreTarget: 80 }).dayScore).toBe(80);
  });
});

describe('the night and the indices over the fixture (the owner’s last night)', () => {
  const api = makeGaugeFixture();

  it('joins last night through V2: 7 h 56 asleep, sleeping low HR 53, HRV 70, usual times with n and spread', async () => {
    const daily = (await api.daily(today))!;
    const b = (await api.baselines!(today))!;
    const s = mainSession(daily.sleep!, today)!;
    const v = nightView({ session: s, baselines: b, plan: null });
    expect(v.tstText).toBe('7 h 56');
    expect(v.metrics!.nightlyLowHrP10).toBe(53);
    expect(v.metrics!.hrvNightlyMs).toBe(70);
    expect(v.joined!.vsGoal).toMatchObject({ goalMin: 480, word: 'short', text: '4 min short' });
    expect(v.stages.map((r) => r.label)).toEqual(['Deep', 'Light', 'REM', 'Awake']);
    // (r068 S08) every stage shares one denominator, the whole recorded night: the shares and the shown whole
    // percentages add up to 100 %
    expect(v.stages.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 5);
    expect(v.stages.reduce((a, r) => a + Number.parseInt(r.shareText!, 10), 0)).toBe(100);
    expect(v.hr.points.length).toBeGreaterThan(50);
    expect(v.hr.low!.v).toBeLessThanOrEqual(53);
    expect(v.learning).toBeNull();
    // (r068 S03) one line, the usual window and n; the spread stays in usualText (the table and the ⓘ)
    expect(usualLine(b)).toMatch(/^Usually \d\d:\d\d–\d\d:\d\d · \d+ nights$/);
    expect(vsUsualClock(3)).toBe('Near usual');
    expect(vsUsualClock(-22)).toBe('22 min earlier than usual');
  });

  it('works out latency and efficiency only with the D11 lights-out time', async () => {
    const s = mainSession((await api.daily(today))!.sleep!, today)!;
    const without = nightView({ session: s, baselines: null, plan: null });
    expect(without.joined!.latency.reason).toBe('needs lights-out time');
    const lo = timeOnNight(today, '22:50')!;
    const ob = timeOnNight(today, '07:40')!;
    expect(new Date(lo).getHours()).toBe(22);
    expect(new Date(lo).getDate()).toBe(new Date(Date.parse(`${shiftDate(today, -1)}T12:00:00`)).getDate());
    const withEntry = nightView({
      session: s,
      baselines: null,
      plan: null,
      entry: { lightsOutAt: lo, outOfBedAt: ob },
    });
    expect(withEntry.joined!.latency.status).toBe('attested');
    expect(withEntry.joined!.latency.latencyMin).toBeGreaterThan(0);
    expect(withEntry.joined!.latency.efficiencyPct).toBeGreaterThan(80);
    setSleepEntry(today, null);
  });

  it('computes V2’s indices and the Day score from S2’s metrics, and falls back to On-device (legacy) on an older server', async () => {
    const daily = (await api.daily(today))!;
    const b = (await api.baselines!(today))!;
    const s = mainSession(daily.sleep!, today)!;
    const r = ringScores({
      night: s,
      baselines: b,
      steps: 9500,
      stepGoal: 9000,
      sleepGoalMin: 480,
      legacy: daily.scores,
    });
    expect(r.source).toBe('vitals');
    expect(r.sleep.value).toBeGreaterThan(80);
    expect(r.recovery.value).not.toBeNull();
    expect(r.activity.value).toBe(100);
    expect(r.day.basedOn).toBe(3);
    expect(r.day.version).toBe('day-index/1');
    expect(dayArcs(r).map((a) => a.id)).toEqual(['recovery', 'activity', 'sleep']);
    const old = makeGaugeFixture({ v2: false });
    const od = (await old.daily(today))!;
    const legacy = ringScores({
      night: mainSession(od.sleep!, today),
      baselines: null,
      steps: 9500,
      stepGoal: 9000,
      sleepGoalMin: 480,
      legacy: od.scores,
    });
    expect(legacy.source).toBe('legacy');
    expect(legacy.sleep.value).toBe(od.scores!.sleep_score!.value);
  });

  it('waits for the baseline: recovery says how many nights it needs while S2 is learning', async () => {
    const young = makeGaugeFixture({ historyDays: 4 });
    const d = (await young.daily(today))!;
    const b = (await young.baselines!(today))!;
    expect(b.learning.learning).toBe(true);
    const r = ringScores({
      night: mainSession(d.sleep!, today),
      baselines: b,
      steps: 9000,
      stepGoal: 9000,
      sleepGoalMin: 480,
    });
    expect(r.learning).toEqual({ nights: b.learning.nights, needed: 7 });
    expect(r.recovery.needs).toMatch(/^needs \d more nights?$/);
  });
});

describe('the monitor catalogue (A.1.3 #46)', () => {
  it('has 26 entries in the default order, the six readings on by default (r068 O06), no breathing rate or tosses and turns', () => {
    expect(MONITOR_CATALOGUE).toHaveLength(26);
    expect(MONITOR_DEFAULT).toEqual(['hr', 'sleepLowHr', 'hrv', 'spo2', 'stress', 'temp']);
    expect(MONITOR_CATALOGUE.map((e) => e.label).join(' ')).not.toMatch(/breath|toss|resp/i);
  });

  it('never lists what this build cannot supply; quiet mode offers no energy or scores', () => {
    const all = offeredEntries(availableSources({ timeline: true }), false).map((e) => e.id);
    expect(all).not.toContain('activeEnergy');
    expect(all).not.toContain('trainingLoad');
    expect(all).toContain('zone45');
    expect(all).toContain('dayScore');
    expect(offeredEntries(availableSources({ timeline: false }), false).map((e) => e.id)).not.toContain(
      'zone13',
    );
    expect(offeredEntries(availableSources({ timeline: true }), true).map((e) => e.id)).not.toContain(
      'dayScore',
    );
  });

  it('shows the stored order, else the default set (absent or empty), dropping unknown ids', () => {
    const offered = offeredEntries(availableSources({ timeline: true }), false);
    expect(shownIds(null, offered)).toEqual(MONITOR_DEFAULT);
    expect(shownIds([], offered)).toEqual(MONITOR_DEFAULT);
    expect(shownIds(['steps', 'nope', 'hr'], offered)).toEqual(['steps', 'hr']);
  });

  it('gives each entry its value, Calibrating while the baseline forms', async () => {
    const api = makeGaugeFixture();
    const daily = (await api.daily(today))!;
    const b = (await api.baselines!(today))!;
    const night = nightView({ session: mainSession(daily.sleep!, today)!, baselines: b, plan: null });
    const ctx = {
      daily,
      baselines: b,
      night,
      scores: null,
      steps: { value: 9100, lineage: 'fused' as const },
      zones: { z13S: 1500, z45S: 600 },
      prefs: { units: 'metric' as const },
      now: Date.now(),
    };
    expect(entryValue('sleepDuration', ctx)).toMatchObject({ text: '7 h 56', chip: { word: '4 min short' } });
    expect(entryValue('sleepLowHr', ctx)).toMatchObject({
      text: '53',
      unit: 'bpm',
      chip: { word: 'Near usual' },
    });
    expect(entryValue('hrv', ctx)).toMatchObject({ reading: 70, text: '70', calibrating: false });
    expect(entryValue('steps', ctx).text).toBe(formatNumber(9100, 0));
    expect(entryValue('zone45', ctx)).toMatchObject({ text: '10', unit: 'min' });
    expect(entryValue('hr', ctx).age?.text).toMatch(/min ago|just now/);
    expect(
      entryValue('temp', { ...ctx, baselines: { ...b, learning: { nights: 2, needed: 7, learning: true } } })
        .calibrating,
    ).toBe(true);
    expect(personal(null)).toBeNull();
  });

  it('HRV and skin temperature overnight never fall back to a daytime reading (Codex UI #11)', async () => {
    const api = makeGaugeFixture();
    const daily = (await api.daily(today))!;
    const b = (await api.baselines!(today))!;
    const session = mainSession(daily.sleep!, today)!;
    // too few overnight readings: no nightly aggregate, although the day has HRV and temperature readings
    const thin = { ...session, metrics: { ...session.metrics!, hrvNightlyMs: null, skinTempNightC: null } };
    const night = nightView({ session: thin, baselines: b, plan: null });
    const ctx = {
      daily,
      baselines: b,
      night,
      scores: null,
      steps: null,
      zones: null,
      prefs: { units: 'metric' as const },
      now: Date.now(),
    };
    expect(daily.metrics?.hrv?.latest).toBeTruthy();
    expect(entryValue('hrv', ctx)).toMatchObject({ reading: null, text: null });
    expect(entryValue('temp', ctx)).toMatchObject({ reading: null, text: null });
    // a temperature baseline S2 does not call ready yet is still calibrating, after sleep learning ended
    const notReady = { ...b, tempBaseline: b.tempBaseline ? { ...b.tempBaseline, ready: false } : null };
    expect(
      entryValue('temp', {
        ...ctx,
        night: nightView({ session, baselines: notReady, plan: null }),
        baselines: notReady,
      }).calibrating,
    ).toBe(true);
  });
});

describe('steps headline: unknown is never an observed zero (Codex UI #6)', () => {
  const cov = (eitherMin: number) => ({
    coverage: { ringMin: eitherMin, phoneMin: 0, eitherMin, unknownMin: 1440 - eitherMin },
    ringDailyTotal: null,
  });
  it('a fused 0 with no source covering the day, and no ring count, is no reading', () => {
    expect(stepsHeadlineOf({ fused: 0, ringSteps: null, stepsDay: cov(0) })).toBeNull();
    expect(stepsHeadlineOf({ fused: 0, ringSteps: null, stepsDay: cov(30) })).toEqual({
      value: 0,
      lineage: 'fused',
    });
    expect(stepsHeadlineOf({ fused: null, ringSteps: null })).toBeNull();
    expect(stepsHeadlineOf({ fused: 4200, ringSteps: 4000, stepsDay: cov(600) })).toEqual({
      value: 4200,
      lineage: 'fused',
    });
    expect(stepsHeadlineOf({ fused: null, ringSteps: 3100 })).toEqual({ value: 3100, lineage: 'ring' });
  });
});

describe('Ring signal gaps and raw twins (Codex UI #13, #14)', () => {
  const stream = (fromMin: number, toMin: number, stepMin: number) =>
    Array.from({ length: Math.floor((toMin - fromMin) / stepMin) + 1 }, (_, i) => ({
      t: (fromMin + i * stepMin) * 60_000,
      v: 60,
    }));
  it('breaks a five-minute stream at a half-hour hole, while three steps remain connected', () => {
    const series = signalLine([...stream(480, 540, 5), ...stream(570, 600, 5)]);
    expect(lineModel({ series, height: 160 }, 600).runs).toHaveLength(2);
    const shortGap = signalLine([...stream(480, 540, 5), ...stream(555, 600, 5)]);
    expect(shortGap.some((p) => p.v === null)).toBe(false);
  });
  it('the twin lists every raw reading, with a missing row at a real break', () => {
    const raw = [
      { t: 8 * 3_600_000, v: 60 },
      { t: 8.25 * 3_600_000, v: 62 },
      { t: 8.5 * 3_600_000, v: 61 },
      { t: 10 * 3_600_000, v: 70 },
    ];
    const rows = lineTwin({ label: 'Heart rate', series: signalLine(raw), tz: 'UTC' }).rows;
    expect(rows).toEqual([
      ['08:00', '60'],
      ['08:15', '62'],
      ['08:30', '61'],
      ['08:45', '—'],
      ['10:00', '70'],
    ]);
  });
});

describe('Day score card helpers (Codex UI #9, #26)', () => {
  it('the completeness line has a words-only quiet form', () => {
    expect(basedOnText(3, false)).toBe('based on 3 of 3');
    expect(basedOnText(3, true)).toBe('based on all three parts');
    expect(basedOnText(2, true)).not.toMatch(/\d/);
  });
  it('the target takes a whole number from 0 to 100 only', () => {
    expect(parseTarget('75')).toBe(75);
    expect(parseTarget(' 0 ')).toBe(0);
    expect(parseTarget('100')).toBe(100);
    expect(parseTarget('101')).toBeNull();
    expect(parseTarget('7.5')).toBeNull();
    expect(parseTarget('')).toBeNull();
  });
});

describe('average sleep HR carries its reading count (Codex UI #28)', () => {
  it('S2’s hrReadings, else the same night’s sampled n', () => {
    expect(avgReadings({ hrReadings: 412, sampledMeanSleepHr: { bpm: 58, n: 96 } })).toBe(412);
    expect(avgReadings({ sampledMeanSleepHr: { bpm: 58, n: 96 } })).toBe(96);
    expect(avgReadings({ hrReadings: null, sampledMeanSleepHr: null })).toBeNull();
  });
});

describe('command words (package C through the Ring)', () => {
  const v = (over: Partial<GaugeCommandView>): GaugeCommandView => ({
    id: 'x',
    type: 'hr.measure',
    state: 'queued',
    via: 'server',
    ...over,
  });
  it('Measure: waiting, measuring, the reading, or why not', () => {
    expect(measureWords(null)).toBeNull();
    expect(measureWords(v({ state: 'queued', online: true }))).toBe('Sent to your phone…');
    expect(measureWords(v({ state: 'delivered', online: true }))).toBe('The phone has it…');
    expect(
      measureWords(
        v({ state: 'delivered', online: false, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }),
      ),
    ).toMatch(/^Your phone hasn’t checked in · expires \d\d:\d\d$/);
    expect(measureWords(v({ state: 'running' }))).toBe('Measuring on the ring…');
    // (r068 B2) the phone never took it: a reason, not "didn’t pick it up"
    expect(measureWords(v({ state: 'expired' }))).toBe(
      'Your phone didn’t answer: open the ring app on the phone, then try again',
    );
    expect(measureWords(v({ state: 'done', result: { bpm: 58 } }))).toBe('Measured 58 bpm');
    expect(measureWords(v({ state: 'failed', code: 'ring_disconnected' }))).toBe(
      'The ring isn’t connected to the phone',
    );
    expect(measureWords(v({ state: 'rejected', code: 'workout_active' }))).toBe('A workout is recording');
    expect(measureWords(v({ state: 'failed', code: 'server_unreachable' }))).toBe(
      'Your server can’t be reached',
    );
  });
  it('Check for updates: the outcome words; installing needs a tap on the phone', () => {
    expect(
      updateWords(
        v({ type: 'update.check', state: 'done', result: { outcome: 'UP_TO_DATE', versionName: '2.8.0' } }),
      ),
    ).toBe('The ring app is up to date (2.8.0)');
    expect(
      updateWords(
        v({ type: 'update.check', state: 'done', result: { outcome: 'READY', versionName: '2.9.0' } }),
      ),
    ).toBe('The ring app 2.9.0 is ready on the phone: tap Install there');
    expect(updateWords(v({ type: 'update.check', state: 'failed', code: 'check_failed' }))).toBe(
      'The update check failed',
    );
    expect(updateWords(v({ type: 'update.check', state: 'expired' }))).toBe(
      'Your phone didn’t answer: open the ring app on the phone, then try again',
    );
  });
  it('a lost watch is never "Measuring": it says why and asks to try again (Codex UI #17)', () => {
    const lost = v({ type: 'hr.measure', state: 'running', code: 'server_unreachable', lost: true });
    expect(measureWords(lost)).toBe('Your server can’t be reached: no answer from the phone yet. Try again');
    expect(
      updateWords(v({ type: 'update.check', state: 'delivered', code: 'server_unreachable', lost: true })),
    ).toMatch(/Try again$/);
    expect(reelsWords(v({ type: 'reels.set', state: 'queued', code: 'timeout', lost: true }))).toBe(
      'The phone didn’t finish in time: no answer from the phone yet. Try again',
    );
  });
  it('a non-terminal view past its deadline or with a code is not "Waiting" (Claude UI P1-8); workout codes have words (P2-3)', () => {
    expect(measureWords(v({ state: 'queued', expiresAt: '2020-01-01T00:00:00Z' }))).toBe(
      'Your phone didn’t answer: open the ring app on the phone, then try again',
    );
    expect(measureWords(v({ state: 'delivered', code: 'server_unreachable' }))).toBe(
      'Your server can’t be reached',
    );
    expect(
      failureWords(v({ type: 'workout.start', state: 'failed', code: 'needs_activity_recognition' })),
    ).toBe('The phone app needs the Physical activity permission on the phone');
    expect(failureWords(v({ type: 'workout.stop', state: 'rejected', code: 'no_active_workout' }))).toBe(
      'No workout is recording',
    );
    expect(failureWords(v({ type: 'workout.pause', state: 'expired' }))).toBe(
      'Your phone didn’t answer: open the ring app on the phone, then try again',
    );
    expect(failureWords(v({ type: 'workout.pause', state: 'done' }))).toBeNull();
  });
  it('Refresh: sent, syncing, synced, or why not (r068 B2)', () => {
    const sv = (over: Partial<GaugeCommandView>) => v({ type: 'ring.sync', ...over });
    expect(syncWords(null)).toBeNull();
    expect(syncWords(sv({ state: 'queued', online: true }))).toBe('Sent to your phone…');
    expect(
      syncWords(
        sv({ state: 'queued', online: false, expiresAt: new Date(Date.now() + 120_000).toISOString() }),
      ),
    ).toMatch(/^Your phone hasn’t checked in · expires/);
    expect(syncWords(sv({ state: 'running' }))).toBe('Syncing the ring…');
    expect(syncWords(sv({ state: 'done', result: { complete: true, uploaded: true } }))).toBe(
      'Synced from the ring',
    );
    expect(syncWords(sv({ state: 'done', result: { complete: false, uploaded: true } }))).toBe(
      'Synced what the ring sent',
    );
    expect(syncWords(sv({ state: 'done', result: { complete: true, uploaded: false } }))).toBe(
      'Synced on the phone; the upload is still on its way',
    );
    expect(syncWords(sv({ state: 'failed', code: 'ring_disconnected' }))).toBe(
      'The ring isn’t connected to the phone',
    );
    expect(syncWords(sv({ state: 'rejected', code: 'unknown_type' }))).toBe(
      'Update the phone app to do this',
    );
    expect(syncWords(sv({ state: 'failed', code: 'timeout' }))).toBe('The phone didn’t finish in time');
    expect(syncWords(sv({ state: 'expired' }))).toBe(
      'Your phone didn’t answer: open the ring app on the phone, then try again',
    );
  });
  it('the short-video limit: saved on the phone', () => {
    expect(reelsWords(v({ type: 'reels.set', state: 'done' }))).toBe('Saved on the phone');
    expect(reelsWords(v({ type: 'reels.set', state: 'superseded' }))).toBeNull();
  });
});

describe('workout zones from V2 (A.2 #9)', () => {
  it('reconciles zone time to the workout over S2’s minute HR, with boundaries from the age (Tanaka)', async () => {
    const api = makeGaugeFixture();
    const from = shiftDate(today, -6);
    const run = (await api.workouts(from, today))!.sessions.find((w) => w.type === 'run')!;
    const t = (await api.timeline!(run.date))!;
    const z = workoutZones(
      run,
      [t],
      freezeZoneBoundaries(currentHrProfile({ ageY: 36, hp: null, sleepingLowHr: null })),
    )!;
    expect(z.boundaries.hrMax).toBeCloseTo(208 - 0.7 * 36, 5);
    const sum =
      z.time.below50S +
      z.time.zonesS.reduce((a, b) => a + b, 0) +
      z.time.aboveEstimateS +
      z.time.unknownS +
      z.time.pausedS;
    expect(sum).toBeCloseTo(z.time.elapsedS, 3);
    expect(z.time.zonesS[2] + z.time.zonesS[3]).toBeGreaterThan(0);
    expect(z.spans.length).toBeGreaterThan(0);
    expect(workoutZones(run, [t], null)).toBeNull();
    expect(z.source).toBe('minuteMeans');
  });

  it('Codex #11: the raw readings give exact zone time and say so; a truncated or partial answer falls back to the minute means', () => {
    const s = Date.parse('2026-10-20T07:00:00Z');
    const w = {
      id: 'w',
      date: '2026-10-20',
      start: new Date(s).toISOString(),
      end: new Date(s + 60_000).toISOString(),
      pauses: [],
    } as never;
    const b = freezeZoneBoundaries(
      currentHrProfile({
        ageY: 40,
        hp: { hrMaxOverride: 200, hrRestOverride: null, useSleepLowAsRest: false },
        sleepingLowHr: null,
      }),
    );
    const r = (k: number, bpm: number) => ({
      t: s + k * 10_000 + 5_000,
      bpm,
      cadenceS: 10,
      nextT: null,
      start: s + k * 10_000,
      end: s + (k + 1) * 10_000,
    });
    const answer = {
      from: new Date(s).toISOString(),
      to: new Date(s + 60_000).toISOString(),
      intervals: [0, 1, 2].map((k) => r(k, 110)).concat([3, 4, 5].map((k) => r(k, 170))),
      count: 6,
      supportedS: 60,
      truncated: false,
    } as never;
    const win = { start: s, end: s + 60_000 };
    const exact = exactSegments(answer, win)!;
    const z = workoutZones(w, [], b, exact)!;
    expect(z.source).toBe('samples');
    expect(z.time.zonesS).toEqual([30, 0, 0, 30, 0]);
    expect(z.time.hrSource).toBe('samples');
    expect(exactSegments({ ...(answer as object), truncated: true } as never, win)).toBeNull();
    expect(exactSegments(answer, { start: s - 1000, end: s + 60_000 })).toBeNull();
    expect(exactSegments(null, win)).toBeNull();
  });
});

describe('zone boundaries: the heart settings, and frozen at approval (Codex UI #2)', () => {
  it('uses the person’s heart settings: a waking resting HR switches to heart-rate reserve, an HRmax override wins over Tanaka', () => {
    const age = zoneSourceOf(null, currentHrProfile({ ageY: 36, hp: null, sleepingLowHr: null }));
    expect(age.boundaries!.basis).toBe('pctMax');
    expect(zoneBasisText(age)).toContain('from your age');
    const set = zoneSourceOf(
      null,
      currentHrProfile({
        ageY: 36,
        hp: { hrMaxOverride: 190, hrRestOverride: 50, useSleepLowAsRest: false },
        sleepingLowHr: null,
      }),
    );
    expect(set.boundaries!.basis).toBe('hrr');
    expect(set.boundaries!.hrMax).toBe(190);
    expect(set.boundaries!.hrRest).toBe(50);
    expect(set.boundaries!.edgesBpm[0]).toBeCloseTo(50 + 0.5 * 140, 6);
    expect(zoneBasisText(set)).toContain('heart-rate reserve');
    // D6: the sleeping low is the rest proxy only when opted in
    expect(
      zoneSourceOf(
        null,
        currentHrProfile({
          ageY: 36,
          hp: { hrMaxOverride: null, hrRestOverride: null, useSleepLowAsRest: false },
          sleepingLowHr: 48,
        }),
      ).boundaries!.basis,
    ).toBe('pctMax');
    expect(
      zoneSourceOf(
        null,
        currentHrProfile({
          ageY: 36,
          hp: { hrMaxOverride: null, hrRestOverride: null, useSleepLowAsRest: true },
          sleepingLowHr: 48,
        }),
      ).boundaries!.basis,
    ).toBe('hrr');
  });

  it('a recorded session keeps the boundaries frozen into its approved entry, whatever the profile says now', () => {
    const frozen = freezeZoneBoundaries(
      currentHrProfile({
        ageY: 30,
        hp: { hrMaxOverride: 200, hrRestOverride: null, useSleepLowAsRest: false },
        sleepingLowHr: null,
      }),
    )!;
    const entries: Record<string, typeof frozen> = { e1: frozen };
    const candidates = [
      { refs: ['gauge:other'], status: 'approved', entryId: 'e0' },
      { refs: ['gauge:run-1'], status: 'pending', entryId: null },
      { refs: ['hc:x', 'gauge:run-1'], status: 'edited', entryId: 'e1' },
    ];
    const got = frozenBoundariesFor('run-1', candidates, (id) => entries[id] ?? null);
    expect(got).toBe(frozen);
    const now = currentHrProfile({ ageY: 60, hp: null, sleepingLowHr: null });
    const s = zoneSourceOf(got, now);
    expect(s.frozen).toBe(true);
    expect(s.boundaries!.hrMax).toBe(200);
    expect(zoneBasisText(s)).toContain('set when you approved it');
    // undecided or rejected: the profile now
    expect(
      frozenBoundariesFor(
        'run-1',
        [{ refs: ['gauge:run-1'], status: 'rejected', entryId: 'e1' }],
        (id) => entries[id] ?? null,
      ),
    ).toBeNull();
    expect(zoneSourceOf(null, now).boundaries!.hrMax).toBeCloseTo(208 - 0.7 * 60, 6);
  });
});

// 0.6.3: quiet mode's words on the Ring's cards
describe('quiet words (no digits)', () => {
  it('times of day, asleep against the goal, ages and syncs', async () => {
    const { partOfDay, sleepGoalWord, quietAge, quietSynced, wordsOnly, quietNightFact } =
      await import('../quiet');
    const at = (h: number) => new Date(2026, 9, 27, h, 15).getTime();
    expect([2, 6, 9, 14, 19, 23].map((h) => partOfDay(at(h)))).toEqual([
      'in the night',
      'early in the morning',
      'in the morning',
      'in the afternoon',
      'in the evening',
      'late in the evening',
    ]);
    expect(quietNightFact(new Date(at(23)).toISOString(), new Date(at(7)).toISOString(), '', '')).toBe(
      'Fell asleep late in the evening · Woke early in the morning',
    );
    expect([480, 476, 420, 300].map((m) => sleepGoalWord(m, 480))).toEqual([
      'Goal met',
      'Just short of the goal',
      'Short of the goal',
      'Well short of the goal',
    ]);
    expect([0, 10, 120, 2000].map(quietAge)).toEqual([
      'just now',
      'recently',
      'earlier today',
      'a while ago',
    ]);
    const now = Date.now();
    expect(quietSynced(new Date(now - 4 * 60_000).toISOString(), now)).toBe('Synced recently');
    expect(quietSynced(null, now)).toBe('Not synced yet');
    expect(wordsOnly('Near usual')).toBe('Near usual');
    expect(wordsOnly('4 min short')).toBeNull();
    for (const w of [
      partOfDay(at(3)),
      sleepGoalWord(100, 480),
      quietAge(5),
      quietSynced(new Date(now).toISOString(), now),
    ])
      expect(w).not.toMatch(/\d/);
  });
});

describe('(r069) a short-video day The phone has not sent', () => {
  it('today is "not sent yet", an earlier day "no count sent", never "nothing counted"', () => {
    expect(RING_COPY.shortVideoNotSent(true)).toBe('The phone hasn’t sent today’s count yet.');
    expect(RING_COPY.shortVideoNotSent(false)).toBe('The phone sent no count for this day.');
    expect([RING_COPY.noShortVideos, RING_COPY.shortVideoNoneSent].join(' ')).not.toMatch(/counted/i);
  });
});
