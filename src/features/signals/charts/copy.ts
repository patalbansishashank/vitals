/** Copy for the ring views on Progress and the score details. Plain words, lowercase engraved labels. */
import type { NightStage } from './ringData';

export const RING_COPY = {
  stage: { deep: 'deep', light: 'light', rem: 'REM', awake: 'awake', unknown: 'unknown' } satisfies Record<NightStage, string>,
  stageHelp: { unknown: 'the ring could not tell the stage' },
  night: 'Last night',
  nightOf: (day: string) => `Night to ${day}`,
  bedWake: (bed: string, wake: string) => `in bed ${bed} · up ${wake}`,
  asleep: (h: string) => `asleep ${h}`,
  uncovered: (m: number) => `${m} min with no stage recorded`,
  provisional: 'stages may still change: the ring had not finished this night',
  noNight: 'No night with stages recorded yet. Import your ring history or sync the ring.',
  stagesCaption: 'stages',
  minutesCol: 'minutes',
  stageCol: 'stage',
  earlier: '‹ earlier',
  later: 'later ›',
  nightNav: 'Choose a night',
  hrDay: 'Heart rate through the day',
  hrDayEmpty: 'No heart-rate readings for this day.',
  resting: (bpm: number) => `resting ${bpm} bpm`,
  nightVitals: 'Overnight readings',
  spo2: 'blood oxygen',
  skinTemp: 'skin temperature',
  spo2Empty: 'No blood-oxygen readings for this night.',
  tempEmpty: 'No skin-temperature readings for this night.',
  loading: 'loading readings…',
  failed: 'Readings could not be read just now.',
  readings: (n: number) => `${n} reading${n === 1 ? '' : 's'}`,
  gapNote: 'breaks in the line are times with no readings',
} as const;

/** Workout type words (the Activity tab's list and sheet; its other copy is in ./copyActivity). */
const TYPE_WORDS: Record<string, string> = {
  walking: 'walk', running: 'run', biking: 'cycle', strength_training: 'gym', hiking: 'hike', yoga: 'yoga', dancing: 'dance',
  squash: 'squash', other: 'other',
};
export const workoutTypeWord = (t: string): string => TYPE_WORDS[t] ?? t.replace(/_/g, ' ');
