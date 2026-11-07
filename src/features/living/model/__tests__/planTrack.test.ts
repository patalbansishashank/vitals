import { describe, expect, it } from 'vitest';
import { PLAN_TRACK_WEEKS_MAX, planTrack, planTrackDots, planTrackWords, versionDay } from '../planTrack';

describe('planTrack: the plan as one dotted track', () => {
  it('draws one dot a week and puts the thumb on the plan day', () => {
    const t = planTrack(15, 84);
    expect(t).toMatchObject({ dots: 12, value: 15, to: 84, day: 15, week: 3, weeks: 12, coarse: false });
    expect(planTrackWords(t)).toBe('Day 15 of 84, week 3 of 12');
  });

  it('never draws fewer than two dots, and clamps a day outside the plan to its ends', () => {
    expect(planTrackDots(3)).toBe(2);
    expect(planTrack(0, 84)).toMatchObject({ value: 0, week: 1 });
    expect(planTrack(200, 84)).toMatchObject({ value: 84, week: 12 });
    expect(planTrack(-4, 84).value).toBe(0);
  });

  it('goes to one dot every four weeks once a plan is longer than the weekly cap, so dots never crowd', () => {
    expect(planTrackDots(PLAN_TRACK_WEEKS_MAX * 7)).toBe(PLAN_TRACK_WEEKS_MAX);
    const long = planTrack(100, 365);
    expect(long.weeks).toBe(53);
    expect(long.dots).toBe(14);
    expect(long.coarse).toBe(true);
  });

  it('places a version on the track by days since the start (the start day is day 1)', () => {
    expect(versionDay('2026-10-16', '2026-10-16', 84)).toBe(1);
    expect(versionDay('2026-10-16', '2026-10-20', 84)).toBe(5);
    expect(versionDay('2026-10-16', '2026-10-23', 84)).toBe(8);
    expect(versionDay('2026-10-16', '2027-03-01', 84)).toBe(84);
    expect(versionDay('2026-10-16', '2026-10-01', 84)).toBe(1);
  });
});
