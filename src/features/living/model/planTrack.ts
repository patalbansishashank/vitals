/**
 * The plan as a dotted track (r071 AUDIT §1.2 Plan details 1 and 3, Coach 4): one dot a week, a thumb at day N of M. The
 * Plan details card, its version timeline, the Start sheet's preview and the Coach's "What the Coach knows" panel draw the
 * same track from this one model, so the dots, the week and the words can never disagree between them.
 *
 * `dots` is one a week (`ceil(of / 7)`) up to `PLAN_TRACK_WEEKS_MAX`; past that one every four weeks, so a long plan's dots
 * never crowd (the same tiers as the retired tick strip). Pure: no React, no store reads.
 */

/** The most weekly dots a track draws before it goes to one dot every four weeks. */
export const PLAN_TRACK_WEEKS_MAX = 30;

export interface PlanTrack {
  /** Dots across the track (`DottedTrack dots`). */
  dots: number;
  /** The thumb: today as a plan day, 0 to `to` (`DottedTrack value`). */
  value: number;
  from: 0;
  /** The plan's length in days (`DottedTrack to` and `goal`). */
  to: number;
  /** Day N of M, as the person reads it (1-based; 0 before the start). */
  day: number;
  /** Week N of W, W = `ceil(M / 7)`. */
  week: number;
  weeks: number;
  /** The track says weeks, not days: one dot is more than one week. */
  coarse: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The dots for a plan of `of` days. */
export function planTrackDots(of: number): number {
  const weeks = Math.max(1, Math.ceil(Math.max(1, Math.round(of)) / 7));
  return Math.max(2, weeks <= PLAN_TRACK_WEEKS_MAX ? weeks : Math.ceil(weeks / 4));
}

/** Where a day sits on the track. `day` is 1-based (day 1 is the start); out of range clamps to the ends. */
export function planTrack(day: number, of: number): PlanTrack {
  const to = Math.max(1, Math.round(of));
  const d = clamp(Math.round(day), 0, to);
  const weeks = Math.max(1, Math.ceil(to / 7));
  return { dots: planTrackDots(to), value: d, from: 0, to, day: d, week: clamp(Math.ceil(d / 7), 1, weeks), weeks, coarse: Math.ceil(to / 7) > PLAN_TRACK_WEEKS_MAX };
}

/** "Day 15 of 84, week 3 of 12": the track's sentence. */
export function planTrackWords(t: Pick<PlanTrack, 'day' | 'to' | 'week' | 'weeks'>): string {
  return `Day ${t.day} of ${t.to}, week ${t.week} of ${t.weeks}`;
}

/** A plan version's place on the track: days after the plan's start (a version made on the start day is day 1). */
export function versionDay(startDate: string, versionDate: string, of: number): number {
  const ms = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return clamp(Math.round((ms(versionDate) - ms(startDate)) / 86_400_000) + 1, 1, Math.max(1, Math.round(of)));
}
