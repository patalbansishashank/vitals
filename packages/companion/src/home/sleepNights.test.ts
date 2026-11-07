// @vitest-environment node
/**
 * (r071) A night is one night. The ring ends a sleep record while the person is up and starts a new one once sleep
 * resumes, so a night with a wake break arrived as two sessions: the longer part the primary, the other a nap (2026-10-30:
 * 205 min shown for a night of 393). The rule under test: the parts of one night, a break of up to 3 h inside the night
 * window (21:00 to 12:00, local), are one primary session whose asleep minutes add up; the break counts as awake after sleep
 * onset; a daytime nap, an evening doze and another night stay apart. The owner's own nights (`sleepNightsFixture.ts`)
 * are the fixtures, through `gauge_sleep`, `gauge_daily_summary` and the Health Connect fallback.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NIGHT_BREAK_MAX_MS, nightRuns } from './gaugeDerive.ts';
import { hcRecord, hr, INSTALL, metric, sleepPacket } from './lumenFixtures.ts';
import { openLumenStore } from './lumenStore.ts';
import { lumenToolSet } from './lumenTools.ts';
import { expandStages, OWNER_NIGHTS } from './sleepNightsFixture.ts';

const MIN = 60_000;
const TZ = 'Asia/Kolkata';
const NOW = Date.parse('2026-10-30T09:00:00Z');
const ist = (local: string) => Date.parse(`${local}+05:30`);
/** Every minute stamp of the local range `[from, to)`. */
const range = (from: string, to: string) => {
  const out: number[] = [];
  for (let t = ist(from); t < ist(to); t += MIN) out.push(t);
  return out;
};
const clock = (ms: number) => new Date(ms + 330 * MIN).toISOString().slice(0, 16);

// --- the rule, on minute stamps

describe('nightRuns: the parts of one night', () => {
  it('a night of two parts with a 69 min wake break is one night; the break is listed', () => {
    const r = nightRuns([...range('2026-10-29T22:11', '2026-10-30T02:04'), ...range('2026-10-30T03:13', '2026-10-30T06:30')], TZ);
    expect(r).toHaveLength(1);
    expect([clock(r[0]!.startMs), clock(r[0]!.endMs)]).toEqual(['2026-10-29T22:11', '2026-10-30T06:30']);
    expect(r[0]!.breaks.map((b) => [clock(b.startMs), clock(b.endMs)])).toEqual([['2026-10-30T02:04', '2026-10-30T03:13']]);
  });

  it('three parts are one night with two breaks', () => {
    const r = nightRuns([...range('2026-10-29T22:00', '2026-10-30T00:30'), ...range('2026-10-30T01:45', '2026-10-30T03:00'), ...range('2026-10-30T04:30', '2026-10-30T06:45')], TZ);
    expect(r).toHaveLength(1);
    expect(r[0]!.breaks).toHaveLength(2);
  });

  it('a gap under an hour never split a night: it stays inside the run and is no break', () => {
    const r = nightRuns([...range('2026-10-29T23:00', '2026-10-30T01:00'), ...range('2026-10-30T01:59', '2026-10-30T05:00')], TZ);
    expect(r).toHaveLength(1);
    expect(r[0]!.breaks).toEqual([]);
  });

  it('a break of 3 h joins; a minute more does not', () => {
    expect(NIGHT_BREAK_MAX_MS).toBe(3 * 60 * MIN);
    expect(nightRuns([...range('2026-10-29T23:00', '2026-10-30T01:00'), ...range('2026-10-30T04:00', '2026-10-30T06:00')], TZ)).toHaveLength(1);
    expect(nightRuns([...range('2026-10-29T23:00', '2026-10-30T01:00'), ...range('2026-10-30T04:01', '2026-10-30T06:00')], TZ)).toHaveLength(2);
  });

  it('a daytime nap stays a nap; a lie-in before noon is the night\'s, a sleep that starts after noon is not', () => {
    const night = range('2026-10-29T23:00', '2026-10-30T06:30');
    expect(nightRuns([...night, ...range('2026-10-30T13:00', '2026-10-30T14:00')], TZ)).toHaveLength(2);
    // a lie-in before noon is the night's; one that starts after noon is not, even 2 h 40 min after the wake
    expect(nightRuns([...night, ...range('2026-10-30T08:30', '2026-10-30T09:30')], TZ)).toHaveLength(1);
    expect(nightRuns([...range('2026-10-29T23:00', '2026-10-30T09:30'), ...range('2026-10-30T12:10', '2026-10-30T13:00')], TZ)).toHaveLength(2);
  });

  it('a doze before bed is a nap of the day; the same doze that runs into the night\'s window joins', () => {
    expect(nightRuns([...range('2026-10-29T19:30', '2026-10-29T20:30'), ...range('2026-10-29T23:00', '2026-10-30T06:00')], TZ)).toHaveLength(2);
    expect(nightRuns([...range('2026-10-29T20:00', '2026-10-29T21:30'), ...range('2026-10-29T23:30', '2026-10-30T06:00')], TZ)).toHaveLength(1);
  });

  it('the 19:00 rule still decides the waking day: a run that began before 19:00 is the day before\'s', () => {
    // 17:30 to 21:30 belongs to the day before the night that follows it (its waking date is the 29th, the night\'s the 30th)
    expect(nightRuns([...range('2026-10-29T17:30', '2026-10-29T21:30'), ...range('2026-10-29T22:30', '2026-10-30T06:00')], TZ)).toHaveLength(2);
  });

  it('a night that starts after midnight is one night too', () => {
    const r = nightRuns([...range('2026-10-30T00:30', '2026-10-30T02:00'), ...range('2026-10-30T03:20', '2026-10-30T07:00')], TZ);
    expect(r).toHaveLength(1);
    expect(r[0]!.breaks).toHaveLength(1);
  });

  it('two nights never join: a whole day lies between them', () => {
    expect(nightRuns([...range('2026-10-28T22:00', '2026-10-29T06:00'), ...range('2026-10-29T22:00', '2026-10-30T06:00')], TZ)).toHaveLength(2);
  });
});

// --- through the server: the owner's nights

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- answers are read field by field
type Json = Record<string, any>;

function setup() {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'sleep-nights-'));
  const store = openLumenStore(join(dir, 'lumen.db'));
  dirs.push(dir);
  const tools = lumenToolSet(() => store, TZ, () => NOW);
  const ingest = (events: unknown[]) => {
    const r = store.ingest(INSTALL, events, NOW);
    expect(r.rejected).toEqual([]);
  };
  const run = async (name: string, args: Record<string, unknown>) => {
    const env = await tools.call(name, args);
    expect(env.ok, JSON.stringify(env.error ?? null)).toBe(true);
    return env.data as Json;
  };
  return { store, ingest, run, close: () => store.close() };
}

/** The owner's ring records of one night, as the server stored them. */
const ownerNight = (date: string) => OWNER_NIGHTS[date]!.map((p) => sleepPacket(p.at, expandStages(p.stages), { receivedAt: p.received }));
const blocksOf = (s: Json, stage: string) => s.blocks.filter((b: Json) => b.stage === stage);

describe('gauge_sleep on the owner\'s nights', () => {
  it('2026-10-30: 22:11 to 06:30 is one primary session of 393 min asleep, the 69 min break listed and no nap (was 205 min and a nap)', async () => {
    const t = setup();
    t.ingest(ownerNight('2026-10-30'));
    const r = await t.run('gauge_sleep', { from: '2026-10-30', to: '2026-10-30' });
    t.close();
    expect(r.sessions).toHaveLength(1);
    const n = r.sessions[0];
    expect(n).toMatchObject({
      wakingDate: '2026-10-30', kind: 'primary', source: 'ring', start: '2026-10-29T22:11:00+05:30', end: '2026-10-30T06:30:00+05:30',
      recordedWindowMinutes: 499, asleepMinutes: 393, minutes: { deep: 97, light: 199, rem: 97, awake: 21, unknown: 0 }, noDataMinutes: 85,
      awakeBreaks: [{ start: '2026-10-30T02:04:00+05:30', end: '2026-10-30T03:13:00+05:30', minutes: 69 }],
    });
    // the break is one no_data block between the two parts, with both parts' blocks around it
    expect(blocksOf(n, 'no_data').map((b: Json) => [b.start, b.end, b.minutes])).toEqual([
      ['2026-10-30T01:28:00+05:30', '2026-10-30T01:38:00+05:30', 10],
      ['2026-10-30T02:04:00+05:30', '2026-10-30T03:13:00+05:30', 69],
      ['2026-10-30T04:42:00+05:30', '2026-10-30T04:48:00+05:30', 6],
    ]);
    expect(n.blocks[0]).toMatchObject({ start: '2026-10-29T22:11:00+05:30', stage: 'awake' });
    expect(n.blocks.at(-1)).toMatchObject({ end: '2026-10-30T06:30:00+05:30', stage: 'light' });
    // the metrics: sleep is the sum of the parts; onset and the final wake bound the whole night; the break is wake after onset
    expect(n.metrics).toMatchObject({
      K: 393, tstLowerMin: 393, tstUpperMin: 393, onset: '2026-10-29T22:27:00+05:30', finalWake: '2026-10-30T06:30:00+05:30', leadingWakeMin: 16,
      wasoMin: 74, awakeningRuns: 5, wakeUps: 1, namedCoveragePct: 96.7, incomplete: false, windowContinuityPct: 84.2,
      stageMinutes: { awake: 74, gap: 16 }, G: 85, coveragePct: 83,
    });
  });

  it('2026-10-19, 10-11 and 10-02: a break of 63, 67 and 104 min (the second part into the morning) is no longer a nap', async () => {
    const t = setup();
    const cases: Array<[string, string, string, number, number, string, string]> = [
      ['2026-10-19', '2026-10-18T22:02:00+05:30', '2026-10-19T06:54:00+05:30', 360, 63, '2026-10-19T03:04:00+05:30', '2026-10-19T04:07:00+05:30'],
      ['2026-10-11', '2026-10-10T21:53:00+05:30', '2026-10-11T07:51:00+05:30', 442, 67, '2026-10-11T03:03:00+05:30', '2026-10-11T04:10:00+05:30'],
      ['2026-10-02', '2026-10-02T00:35:00+05:30', '2026-10-02T10:24:00+05:30', 333, 104, '2026-10-02T05:36:00+05:30', '2026-10-02T07:20:00+05:30'],
    ];
    for (const [date] of cases) t.ingest(ownerNight(date));
    for (const [date, start, end, asleep, brk, from, to] of cases) {
      const r = await t.run('gauge_sleep', { from: date, to: date });
      expect(r.sessions, date).toHaveLength(1);
      expect(r.sessions[0], date).toMatchObject({ kind: 'primary', start, end, asleepMinutes: asleep, awakeBreaks: [{ start: from, end: to, minutes: brk }] });
      expect(r.sessions[0].metrics, date).toMatchObject({ K: asleep, tstLowerMin: asleep });
      expect(r.sessions[0].metrics.wasoMin, date).toBeGreaterThanOrEqual(brk);
    }
    t.close();
  });

  it('2026-10-24: a 41 min hole between records was one night all along: no break is listed, the hole stays no data', async () => {
    const t = setup();
    t.ingest(ownerNight('2026-10-24'));
    const r = await t.run('gauge_sleep', { from: '2026-10-24', to: '2026-10-24' });
    t.close();
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]).toMatchObject({ kind: 'primary', start: '2026-10-23T22:53:00+05:30', end: '2026-10-24T06:51:00+05:30', asleepMinutes: 357 });
    expect(r.sessions[0].awakeBreaks).toBeUndefined();
    expect(blocksOf(r.sessions[0], 'no_data').map((b: Json) => b.minutes)).toContain(41);
    // a gap under the hour stays unnamed, not wake: the night is incomplete, its continuity a range (the app's rule), as before
    expect(r.sessions[0].metrics).toMatchObject({ wasoMin: 33, incomplete: true, windowContinuityPct: null });
  });

  it('2026-10-03: the night and the afternoon nap stay two sessions', async () => {
    const t = setup();
    t.ingest(ownerNight('2026-10-03'));
    const r = await t.run('gauge_sleep', { from: '2026-10-03', to: '2026-10-03' });
    t.close();
    expect(r.sessions.map((s: Json) => [s.kind, s.start, s.end, s.asleepMinutes])).toEqual([
      ['primary', '2026-10-02T23:58:00+05:30', '2026-10-03T06:31:00+05:30', 388],
      ['nap', '2026-10-03T12:18:00+05:30', '2026-10-03T14:23:00+05:30', 115],
    ]);
    expect(r.sessions[0].awakeBreaks).toBeUndefined();
  });

  it('gauge_daily_summary carries the same one night, and the nap of the next day is its own', async () => {
    const t = setup();
    t.ingest(ownerNight('2026-10-30'));
    const d = await t.run('gauge_daily_summary', { date: '2026-10-30' });
    t.close();
    expect(d.sleep).toHaveLength(1);
    expect(d.sleep[0]).toMatchObject({ kind: 'primary', asleepMinutes: 393, awakeBreaks: [{ minutes: 69 }] });
  });

  it('a night with a break and a real nap in the afternoon: the night is one session, the nap another', async () => {
    const t = setup();
    t.ingest([...ownerNight('2026-10-30'), sleepPacket('2026-10-30T08:30:00Z', expandStages('W2 L38'))]);
    const r = await t.run('gauge_sleep', { from: '2026-10-30', to: '2026-10-30' });
    t.close();
    expect(r.sessions.map((s: Json) => [s.kind, s.start, s.asleepMinutes])).toEqual([
      ['primary', '2026-10-29T22:11:00+05:30', 393],
      ['nap', '2026-10-30T14:00:00+05:30', 38],
    ]);
  });
});

describe('the length of the break', () => {
  // two parts of 150 min asleep, 23:00 to 01:30 and then `gap` minutes later
  const twoParts = async (gap: number) => {
    const t = setup();
    const second = ist('2026-10-30T01:30') + gap * MIN;
    t.ingest([sleepPacket(new Date(ist('2026-10-29T23:00')).toISOString(), expandStages('L150')), sleepPacket(new Date(second).toISOString(), expandStages('L150'))]);
    const r = await t.run('gauge_sleep', { from: '2026-10-30', to: '2026-10-30' });
    t.close();
    return r.sessions as Json[];
  };

  it.each([40, 59, 60, 61, 90, 120, 179, 180])('a %i min break: one primary session of both parts, 300 min asleep', async (gap) => {
    const s = await twoParts(gap);
    expect(s).toHaveLength(1);
    const n = s[0]!;
    expect(n).toMatchObject({ kind: 'primary', asleepMinutes: 300, recordedWindowMinutes: 300 + gap, noDataMinutes: gap, start: '2026-10-29T23:00:00+05:30' });
    // a break the ring held apart as two records (an hour or more) is listed and counted awake; a shorter one never split the night
    if (gap >= 60) {
      expect(n.awakeBreaks).toEqual([{ start: '2026-10-30T01:30:00+05:30', end: `${clock(ist('2026-10-30T01:30') + gap * MIN)}:00+05:30`, minutes: gap }]);
      expect(n.metrics).toMatchObject({ K: 300, wasoMin: gap, wakeUps: 1, incomplete: false });
    } else {
      expect(n.awakeBreaks).toBeUndefined();
      expect(n.metrics).toMatchObject({ K: 300, wasoMin: 0, G: gap });
    }
  });

  it('a break of 3 h and a minute is two sessions again: the longer part the primary, the other a nap', async () => {
    const s = await twoParts(181);
    expect(s.map((x) => [x.kind, x.asleepMinutes])).toEqual([['primary', 150], ['nap', 150]]);
  });
});

describe('a night that starts after midnight, and one that is still going on', () => {
  it('00:30 to 02:10, up for 80 min, 03:30 to 07:00: one session of the day it ends on', async () => {
    const t = setup();
    t.ingest([sleepPacket('2026-10-29T19:00:00Z', expandStages('W5 L60 D35')), sleepPacket('2026-10-29T22:00:00Z', expandStages('W3 L100 D40 R67'))]);
    const r = await t.run('gauge_sleep', { from: '2026-10-30', to: '2026-10-30' });
    t.close();
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]).toMatchObject({ wakingDate: '2026-10-30', start: '2026-10-30T00:30:00+05:30', end: '2026-10-30T07:00:00+05:30', asleepMinutes: 302, awakeBreaks: [{ start: '2026-10-30T02:10:00+05:30', end: '2026-10-30T03:30:00+05:30', minutes: 80 }] });
  });

  it('the first part alone (the second not uploaded yet) is the night so far; the whole night replaces it when it arrives', async () => {
    const t = setup();
    const first = sleepPacket('2026-10-29T16:41:00Z', expandStages('W16 L200 D17'));
    t.ingest([first]);
    const early = await t.run('gauge_sleep', { from: '2026-10-30', to: '2026-10-30' });
    expect(early.sessions).toHaveLength(1);
    expect(early.sessions[0]).toMatchObject({ asleepMinutes: 217 });
    expect(early.sessions[0].awakeBreaks).toBeUndefined();
    t.ingest([sleepPacket('2026-10-29T21:43:00Z', expandStages('W1 L100 D88'), { receivedAt: '2026-10-30T01:05:41Z' })]);
    const whole = await t.run('gauge_sleep', { from: '2026-10-30', to: '2026-10-30' });
    t.close();
    expect(whole.sessions).toHaveLength(1);
    expect(whole.sessions[0]).toMatchObject({ kind: 'primary', asleepMinutes: 405, awakeBreaks: [{ minutes: 69 }] });
  });
});

describe('the wake break in the metrics: awake after sleep onset, never sleep physiology', () => {
  it('heart rate, HRV, skin temperature and SpO2 of the break stay out of the night; its heart rate is a hole in the trace', async () => {
    const t = setup();
    const events = [...ownerNight('2026-10-30')];
    // 60 bpm asleep, 90 bpm in the break (02:04 to 03:13 local), a reading every 5 min
    for (let m = ist('2026-10-29T22:30'); m < ist('2026-10-30T06:25'); m += 5 * MIN) events.push(hr(new Date(m).toISOString(), m >= ist('2026-10-30T02:04') && m < ist('2026-10-30T03:13') ? 90 : 60));
    // HRV 50 ms asleep, 20 ms in the break; the same for temperature (36.0 and 37.5) and SpO2 (97 and 92)
    for (const [local, brk] of [['2026-10-29T23:00', false], ['2026-10-30T00:00', false], ['2026-10-30T01:00', false], ['2026-10-30T02:30', true], ['2026-10-30T03:00', true], ['2026-10-30T04:00', false], ['2026-10-30T05:00', false], ['2026-10-30T06:00', false]] as const) {
      const at = new Date(ist(local)).toISOString();
      events.push(metric('hrv', 'ms', at, brk ? 20 : 50), metric('temp', 'C', at, brk ? 37.5 : 36), metric('spo2', '%', at, brk ? 92 : 97));
    }
    t.ingest(events);
    const r = await t.run('gauge_sleep', { from: '2026-10-30', to: '2026-10-30' });
    t.close();
    const m = r.sessions[0].metrics;
    expect(m.sampledMeanSleepHr).toMatchObject({ bpm: 60 });
    expect(m.hrvNightlyMs).toMatchObject({ ms: 50, n: 6 });
    expect(m.skinTempNightC).toMatchObject({ c: 36, n: 6 });
    expect(m.spo2Night).toMatchObject({ meanPct: 97, minPct: 97, count: 6 });
    // the 5-min bins that lie wholly inside the break (02:04 to 03:13) have no reading
    const hole = m.trace5min.filter((b: Json) => Date.parse(b.start) >= ist('2026-10-30T02:04') && Date.parse(b.start) + 5 * MIN <= ist('2026-10-30T03:13'));
    expect(hole.length).toBeGreaterThan(10);
    expect(hole.every((b: Json) => b.bpm === null && b.n === 0)).toBe(true);
  });
});

describe('the awake readings of a break stay awake readings', () => {
  it('the day\'s non-exercise heart rate counts the break\'s readings (the person was up), not the parts slept in', async () => {
    const t = setup();
    const events = [...ownerNight('2026-10-30')];
    // 60 bpm asleep, 90 bpm in the break (02:04 to 03:13), a reading every 5 min from 00:00 to the final wake at 06:30
    for (let m = ist('2026-10-30T00:00'); m < ist('2026-10-30T06:30'); m += 5 * MIN) events.push(hr(new Date(m).toISOString(), m >= ist('2026-10-30T02:04') && m < ist('2026-10-30T03:13') ? 90 : 60));
    t.ingest(events);
    const d = await t.run('gauge_daily_summary', { date: '2026-10-30' });
    t.close();
    // 02:05 to 03:10, every 5 min: 14 readings, all awake (a break inside the night's window would have hidden them)
    expect(d.derived.nonExerciseHr).toMatchObject({ median: 90, n: 14 });
  });
});

describe('Health Connect: a night in two SleepSession records is one night too', () => {
  const rec = (id: string, start: string, end: string, stages: Array<[string, string, string]>, origin = 'com.example.watch') =>
    hcRecord('SleepSession', id, new Date(ist(start)).toISOString(), new Date(ist(end)).toISOString(), { stages: stages.map(([s, e, stage]) => ({ start: new Date(ist(s)).toISOString(), end: new Date(ist(e)).toISOString(), stage })) }, { origin, native: false });

  it('two records with a 100 min break: one session from Health Connect, its asleep minutes added, the break listed', async () => {
    const t = setup();
    t.ingest([
      rec('a', '2026-10-21T23:00', '2026-10-22T02:00', [['2026-10-21T23:00', '2026-10-22T02:00', 'light']]),
      rec('b', '2026-10-22T03:40', '2026-10-22T06:40', [['2026-10-22T03:40', '2026-10-22T06:00', 'deep'], ['2026-10-22T06:00', '2026-10-22T06:40', 'awake']]),
    ]);
    const r = await t.run('gauge_sleep', { from: '2026-10-22', to: '2026-10-22' });
    t.close();
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]).toMatchObject({
      source: 'healthConnect', kind: 'primary', start: '2026-10-21T23:00:00+05:30', end: '2026-10-22T06:40:00+05:30', asleepMinutes: 320,
      awakeBreaks: [{ start: '2026-10-22T02:00:00+05:30', end: '2026-10-22T03:40:00+05:30', minutes: 100 }],
    });
  });
});
