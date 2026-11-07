/** Settings › Heart rate copy (energy SPEC §V4.7). Sentence case; the help line states a fact the label lacks. */

import { bpmRangeText, pctRangeText } from '@/features/lib/zoneRange';

const bpm = (n: number) => `${Math.round(n)} bpm`;

export const HEART_COPY = {
  title: 'Heart rate',
  groups: { rates: 'Maximum and resting', zones: 'Zones', calories: 'Calories', steps: 'Steps' },

  /* a change that did not go through */
  failed: (reason: string) => `That change wasn’t saved, so the earlier value is still in use. ${reason}`,
  retry: 'Try again',
  dismiss: 'Dismiss',

  /* maximum */
  hrMax: 'Maximum heart rate',
  hrMaxName: 'maximum heart rate',
  fromAge: (sd: number) => `Estimated from your age, ±${sd} bpm`,
  setByYou: 'Set by you',
  fromAgeQuiet: 'Estimated from your age',
  suggestTitleQuiet: 'Your workouts went above your maximum',
  suggestBodyQuiet: 'Several recorded workouts held a heart rate above the maximum in use.',
  raiseQuiet: 'Raise maximum',
  keepQuiet: 'Keep current maximum',
  sleepLowHelpQuiet: 'The ring’s sleeping low sits below a waking resting rate, so zones would sit lower',
  needsAge: 'Add your age in Your body to estimate it',
  useEstimate: 'Use the estimate',
  suggestTitle: (n: number) => `Your workouts reached ${bpm(n)}`,
  suggestBody: (bouts: number, current: number) => `${bouts} workouts in the last 180 days held at least 30 seconds above ${bpm(current)}.`,
  raise: (n: number) => `Raise to ${bpm(n)}`,
  keep: (n: number) => `Keep ${bpm(n)}`,

  /* resting */
  hrRest: 'Resting heart rate',
  hrRestName: 'resting heart rate',
  hrRestHelp: 'Awake, sitting still, soon after waking',
  // (r068 final M20) a hint, not a value in grey: "58 bpm" beside a set maximum read as already set
  hrRestPlaceholder: 'e.g. 58',
  clear: 'Clear',
  sleepLow: 'Use sleeping low as resting',
  sleepLowHelp: (n: number | null, source: 'ring' | 'healthConnect' = 'ring') =>
    n === null
      ? 'Sleeping low heart rate comes from the ring; none yet'
      : source === 'healthConnect'
        ? `Resting ${bpm(n)} from Health Connect stands in until the ring's sleeping low is ready`
        : `Sleeping low ${bpm(n)} sits below a waking resting rate, so zones would sit lower`,
  sleepLowShadowed: 'Your entered resting rate is used instead',

  /* zones */
  basis: 'Zone basis',
  bases: { hrr: 'Heart-rate reserve', pctMax: 'Share of maximum' },
  basisWhy: {
    hrrAvailable: (rest: number, max: number) => `From resting ${bpm(rest)} to maximum ${bpm(max)}`,
    noRestingHr: 'Until you enter a resting heart rate',
    reserveTooSmall: 'Resting to maximum is under 40 bpm, so the share of maximum is used',
    noHrMax: 'Needs a maximum heart rate',
  },
  zonesLabel: 'Heart-rate zones',
  /** Under the zone bar: the unit once, and what each zone is a share of. */
  zoneScale: (basis: 'hrr' | 'pctMax') => `Zones are 10 % bands of ${basis === 'hrr' ? 'the reserve' : 'your maximum'}, from 50 % to 100 %.`,
  zoneShort: (z: number) => `Z${z}`,
  zoneCols: { zone: 'Zone', bpm: 'Heart rate', share: 'Of the basis' },
  zone: (z: number) => `Zone ${z}`,
  /** A zone holds its lower edge and not its upper one (the next zone starts there): "108 to under 126 bpm"; the top zone ends at the maximum. */
  bpmRange: bpmRangeText,
  pctRange: pctRangeText,
  frozen: 'A workout keeps the zones it was approved with. A change here applies to the workouts you approve next.',
  how: 'How zones are made',
  howTextQuiet: [
    'Your maximum is estimated from your age or typed by you. It is a starting value, not a limit.',
    'When several recorded workouts hold a heart rate above it, Vitals offers to raise it. It never lowers it by itself: an easy month is not evidence of a lower maximum.',
    'Resting heart rate is the one you enter, measured awake. The ring’s sleeping low is lower than a waking rate, so it is used only if you turn that on.',
    'With a resting rate the zones use the heart-rate reserve; without one, or when the reserve is too small, they use the share of maximum. A workout keeps the zones it was approved with.',
    'Heart Points follow Google Fit’s own rule so they compare with Fit; they do not use these zones.',
  ],
  howSummary: 'From your age (Tanaka), your resting rate and your workouts',
  howText: [
    'Maximum heart rate starts from your age: 208 − 0.7 × age (Tanaka). A person’s true maximum can sit 10 to 20 bpm either side, so it is a starting value, not a limit.',
    'When at least 3 recorded workouts in 180 days hold a heart rate above it for 30 seconds or more, Vitals offers to raise it. It never lowers it by itself: an easy month is not evidence of a lower maximum.',
    'Resting heart rate is the one you enter, measured awake. The ring’s sleeping low is lower than a waking rate, so it is used only if you turn that on.',
    'With a resting rate the zones use the heart-rate reserve (resting to maximum); without one, or when the two are under 40 bpm apart, they use the share of maximum.',
    'Heart Points follow Google Fit’s own rule (205.8 − 0.685 × age) so they compare with Fit; they do not use these zones.',
  ],

  /* calories */
  keytel: 'Heart-rate calories',
  keytelHelp: 'For steady walking, running and cycling; the activity estimate is shown beside it',

  /* steps (Settings › Steps) */
  stepsFirst: { ring: 'Ring first', phone: 'Phone first' },
  stepsInfo:
    'When the ring and the phone both count steps, the one you pick first is used. A device walking alone wins when that option is on. For the day total, At least adds ring steps the ring did not place in time; Placed in time leaves them out.',
  stepsSource: 'When ring and phone both count',
  stepsSources: { ring: 'Ring', phone: 'Phone' },
  soleGait: 'One device walking alone wins',
  soleGaitHelp: 'Such as the phone on a treadmill while the ring sees no steps',
  headline: 'Day total',
  headlines: { atLeast: 'At least', located: 'Placed in time' },
  headlineHelp: 'At least adds ring steps the ring did not place in time',
} as const;
