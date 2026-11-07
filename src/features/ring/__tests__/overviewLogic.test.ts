/** The pure parts of the Overview's Signals card and the Ring glance (r071): words, bands, the Edit sheet's groups, the hero. */
import { describe, expect, it } from 'vitest';
import { nightView } from '@/features/living/sleep/model';
import { heroParts, pickHero } from '../components/SignalRows';
import { sleepFootWord } from '../views/SleepCard';
import type { GaugeSleepMetrics, GaugeSleepSession } from '../types';
import { glanceIds } from '../RingToday';
import { MONITOR_CATALOGUE, MONITOR_DEFAULT, MONITOR_GROUPS, availableSources, entriesByGroup, groupOf, offeredEntries } from '../monitor/catalogue';
import type { EntryValue } from '../monitor/values';
import { bandRange, bandRows, statusTone, statusWord } from '../signalWords';

const metric = { units: 'metric' } as const;
const value = (text: string | null): EntryValue => ({ reading: text === null ? null : Number(text), text, unit: null, chip: null, calibrating: false, age: null });

describe('the words of a signal (r071)', () => {
  it('a status word carries no figure in quiet mode: the "night 3 of 7" tail goes', () => {
    expect(statusWord({ word: 'Calibrating · night 3 of 7', severity: 'info' }, true)).toBe('Calibrating');
    expect(statusWord({ word: 'Calibrating · night 3 of 7', severity: 'info' }, false)).toBe('Calibrating · night 3 of 7');
    expect(statusWord({ word: 'Near usual', severity: 'ok' }, true)).toBe('Near usual');
  });

  it('caution and danger keep their mark; ok and info are neutral', () => {
    expect(statusTone({ severity: 'ok' })).toBe('neutral');
    expect(statusTone({ severity: 'info' })).toBe('neutral');
    expect(statusTone({ severity: 'caution' })).toBe('caution');
    expect(statusTone({ severity: 'danger' })).toBe('danger');
  });

  it('the fixed bands as words and whole-number ranges (the next band starts one above where one ends)', () => {
    expect(bandRows('hr', metric).map((r) => `${r.word}: ${r.range}`)).toEqual(['Low: under 50 bpm', 'Normal: 50–89 bpm', 'Elevated: 90–119 bpm', 'High: 120 bpm and over']);
    expect(bandRows('spo2', metric).map((r) => r.range)).toEqual(['under 89 %', '89–92 %', '93–94 %', '95 % and over']);
    expect(bandRows('stress', metric).map((r) => r.range)).toEqual(['under 26 ring index', '26–50 ring index', '51–75 ring index', '76 ring index and over']);
    // HRV and skin temperature read against your own usual night: no fixed bands
    expect(bandRows('hrv', metric)).toEqual([]);
    expect(bandRows('temp', metric)).toEqual([]);
  });

  it('the range of the band a reading sits in', () => {
    expect(bandRange('hr', 74, metric)).toBe('50–89 bpm');
    expect(bandRange('hr', 90, metric)).toBe('90–119 bpm');
    expect(bandRange('hr', 49, metric)).toBe('under 50 bpm');
    expect(bandRange('spo2', 97, metric)).toBe('95 % and over');
    expect(bandRange('hrv', 70, metric)).toBeNull();
  });
});

describe('the Edit sheet of the Signals card (r071)', () => {
  it('every one of the 26 signals is in a group, and each group is a domain', () => {
    expect(MONITOR_CATALOGUE).toHaveLength(26);
    for (const e of MONITOR_CATALOGUE) expect(groupOf(e.id), e.id).toBeDefined();
    expect(MONITOR_GROUPS.map((g) => [g.group, g.domain, g.ids.length])).toEqual([
      ['Heart', 'heart', 7],
      ['Recovery', 'recovery', 4],
      ['Sleep', 'sleep', 9],
      ['Move', 'steps', 4],
      ['Energy', 'energy', 2],
    ]);
    // a signal is in exactly one group
    expect(MONITOR_GROUPS.flatMap((g) => g.ids).sort()).toEqual(MONITOR_CATALOGUE.map((e) => e.id).sort());
    expect(groupOf('hr')).toEqual({ group: 'Heart', domain: 'heart' });
    expect(groupOf('dayScore')).toEqual({ group: 'Recovery', domain: 'recovery' });
    expect(groupOf('sleepLowHr')).toEqual({ group: 'Sleep', domain: 'sleep' });
    expect(groupOf('steps')).toEqual({ group: 'Move', domain: 'steps' });
    expect(groupOf('totalEnergy')).toEqual({ group: 'Energy', domain: 'energy' });
    expect(groupOf('nothing')).toBeUndefined();
  });

  it('the Add list is ordered by group, then as the catalogue lists them', () => {
    const offered = offeredEntries(availableSources({ timeline: true, energy: true, load: true }), false);
    const ordered = entriesByGroup(offered).map((e) => e.id);
    expect(ordered.slice(0, 7)).toEqual(['hr', 'spo2', 'peakHr', 'avgWorkoutHr', 'nonExerciseHr', 'zone13', 'zone45']);
    expect(ordered.slice(7, 11)).toEqual(['hrv', 'stress', 'temp', 'dayScore']);
    expect(ordered.slice(-2)).toEqual(['activeEnergy', 'totalEnergy']);
    expect(ordered).toHaveLength(26);
    // quiet mode offers no energy or scores: the groups that are left keep their order
    const quiet = entriesByGroup(offeredEntries(availableSources({ timeline: true, energy: true, load: true }), true)).map((e) => e.id);
    expect(quiet).not.toContain('totalEnergy');
    expect(quiet).not.toContain('dayScore');
    expect(quiet[0]).toBe('hr');
  });

  it('the default set is six readings, all of them in the sheet', () => {
    expect(MONITOR_DEFAULT).toEqual(['hr', 'sleepLowHr', 'hrv', 'spo2', 'stress', 'temp']);
    for (const id of MONITOR_DEFAULT) expect(groupOf(id)).toBeDefined();
  });
});

describe('the hero reading and the glance (r071)', () => {
  it('a duration is the hero in hours and minutes, each with its small unit; a count or a clock time is drawn as it is', () => {
    expect(heroParts('7 h 56')).toEqual([{ value: 7, unit: 'h' }, { value: 56, unit: 'm' }]);
    expect(heroParts('8 h 05')).toEqual([{ value: 8, unit: 'h' }, { value: '05', unit: 'm' }]);
    expect(heroParts('8 h')).toEqual([{ value: 8, unit: 'h' }]);
    expect(heroParts('45 min')).toEqual([{ value: 45, unit: 'min' }]);
    expect(heroParts('23:14')).toBeNull();
    expect(heroParts('8 487')).toBeNull();
    expect(heroParts(null)).toBeNull();
  });

  const f = (id: string, text: string | null, word: string | null) => ({ id, v: value(text), word });

  it('the hero is the first signal in the list with something to show', () => {
    expect(pickHero([f('steps', null, null), f('hr', '72', 'Normal'), f('hrv', '70', 'Near usual')], false)?.id).toBe('hr');
    expect(pickHero([f('a', null, null)], false)).toBeUndefined();
  });

  it('in quiet mode the hero needs a word (the number is hidden, so a word stands where it was)', () => {
    expect(pickHero([f('steps', '8487', null), f('hr', '72', 'Normal')], true)?.id).toBe('hr');
    expect(pickHero([f('steps', '8487', null)], true)).toBeUndefined();
  });

  it('the glance names heart rate, HRV, blood oxygen and stress first, in the person\'s order, and leaves out what Today shows', () => {
    expect(glanceIds(['steps', 'stress', 'hr', 'dayScore', 'spo2', 'peakHr', 'hrv'])).toEqual(['stress', 'hr', 'spo2', 'hrv', 'peakHr']);
    expect(glanceIds(['sleepDuration', 'zone13', 'activeEnergy'])).toEqual([]);
  });
});

describe('the Sleep card\'s foot (r071)', () => {
  const night = (tst: number, over: Partial<GaugeSleepMetrics> = {}) => {
    const metrics = {
      version: 'sleep-metrics/1', K: tst, A: 0, U: 0, G: 0, tstLowerMin: tst, tstUpperMin: tst, incomplete: false, namedCoveragePct: 100, windowContinuityPct: 95,
      wasoMin: 20, wakeUps: 2, awakeningRuns: 2, leadingWakeMin: 10, onset: '2026-10-29T23:14:00+05:30', finalWake: '2026-10-30T07:37:00+05:30',
      stageMinutes: { deep: 100, light: 280, rem: 90, asleepUnspecified: 0, awake: 20, unknown: 0, gap: 0 }, trace5min: [], ...over,
    } as unknown as GaugeSleepMetrics;
    return nightView({ session: { wakingDate: '2026-10-30', start: '2026-10-29T23:10:00+05:30', end: '2026-10-30T07:40:00+05:30', asleepMinutes: tst, minutes: { deep: 100, light: 280, rem: 90, awake: 20, unknown: 0 }, blocks: [], metrics } as unknown as GaugeSleepSession, baselines: null, plan: null });
  };

  it('the goal in words: met, short by how much, over by how much; a word with no figure in quiet mode', () => {
    expect(sleepFootWord(night(476), 480, false)).toBe('4 min short');
    expect(sleepFootWord(night(480), 480, false)).toBe('Goal met');
    expect(sleepFootWord(night(520), 480, false)).toBe('Goal met, 40 min over');
    expect(sleepFootWord(night(476), 480, true)).toBe('Just short of the goal');
    expect(sleepFootWord(night(400), 480, true)).toBe('Short of the goal');
    expect(sleepFootWord(night(380), 480, true)).toBe('Well short of the goal');
    expect(sleepFootWord(night(480), 480, true)).toBe('Goal met');
  });

  it('an incomplete night reads the bounds: "at least" short, or a goal that cannot be told', () => {
    expect(sleepFootWord(night(400, { tstUpperMin: 430, incomplete: true }), 480, false)).toBe('At least 50 min short');
    expect(sleepFootWord(night(440, { tstUpperMin: 500, incomplete: true }), 480, false)).toBe('Goal unclear');
  });
});
