/** Words of the sleep sections (Ring › Sleep and `/sleep`). Sentence case; facts, not captions. */
export const SLEEP_COPY = {
  title: 'Sleep',
  lastNight: 'Last night',
  /** (r068 S07) a past night by the evening it began (the day strip names the waking day). */
  nightOf: (day: string) => `Night of ${day}`,
  asleep: 'Asleep',
  stages: 'Stages',
  ofTheNight: 'of the night',
  /** (r069) a staged night with no REM minute: the ring named none, which is not a measured zero */
  noRem: 'The ring marked no REM this night.',
  noRemOther: 'No REM in this night’s stages.',
  noRemRow: 'None marked',
  restorative: 'Deep and REM (estimated)',
  additional: 'Additional sleep',
  /** (0.6.3 FX5) A night the ring missed, taken from Health Connect (one app). */
  fromHealthConnect: 'From Health Connect: the ring recorded no sleep this night',
  noSleep: 'No sleep recorded for this night.',

  timing: 'Timing',
  fellAsleep: 'Fell asleep',
  woke: 'Woke',
  midpoint: 'Sleep midpoint',
  settle: 'Settle time',
  settleInfo: 'From the ring’s first recorded minute to falling asleep. It is not the time it took you to fall asleep: that needs a lights-out time.',
  continuity: 'Window continuity',
  continuityInfo: 'Asleep share of the time between falling asleep and waking, as the ring recorded it. Sleep efficiency needs a lights-out and an out-of-bed time.',
  /** (r069) an incomplete night: the share with its unrecorded minutes counted awake, then asleep */
  continuityRange: 'Between: unrecorded minutes counted awake, then asleep',
  wakeUps: 'Wake-ups',
  wakeUpsQualifier: (min: number) => `${min} min awake`,
  latency: 'Time to fall asleep',
  efficiency: 'Sleep efficiency',
  addLightsOut: 'Add lights-out time',
  changeTimes: 'Change times',
  entryTitle: 'Lights out and up',
  lightsOut: 'Lights out',
  outOfBed: 'Out of bed',
  entryNote: 'Your own times. With them, Vitals works out the time to fall asleep and sleep efficiency.',
  fromYourTimes: 'From your times',

  sleepHr: 'Sleep heart rate',
  lowHr: 'Sleeping low HR',
  lowHrInfo: 'The 10th percentile of your heart rate while asleep. It is not a waking resting heart rate. The trace below marks the lowest five-minute stretch, so it can sit a little under this.',
  avgHr: 'Average sleep HR',
  sampledHr: 'Sampled sleep HR',
  /** (Claude UI P3-11) the lowest five-minute stretch, as the trace marks it: not the sleeping low HR above it. */
  timeToLow: 'Time to lowest',
  afterOnset: 'After falling asleep',
  tooFew: 'Too few readings overnight',
  readings: (n: number) => (n === 1 ? '1 reading' : `${n} readings`),
  readingsUnknown: 'Reading count not reported',
  /** (Codex UI #18) a lights-out save that did not go through. */
  saveFailed: 'That didn’t save. Try again.',
  ringSaw: (onset: string, wake: string) => `For reference, the ring saw you fall asleep at ${onset} and wake at ${wake}.`,

  overnight: 'Overnight',
  hrv: 'HRV',
  temp: 'Skin temperature',
  /** (r068) short enough for a 360 px phone's fact slot */
  tempVsUsual: 'Skin temp vs usual',
  spo2: 'Blood oxygen',
  lowest: (v: string) => `Lowest ${v} %`,

  indices: 'Indices',
  sleepIndex: 'Sleep index',
  recoveryIndex: 'Recovery index',
  experimental: 'Experimental wellness index',
  legacy: 'On-device (legacy)',

  history: 'Sleep · last four weeks',
  /** (r071) The history's hero, foot and empty line. */
  noNights: 'No nights recorded in these days.',
  goalMet: (n: number, of: number) => `Goal met ${n} of ${of} nights`,
  goalWord: (text: string) => `Goal ${text}`,
  usualWord: (text: string) => `Usual ${text}`,
  avgNights: (n: number, of: number) => (n === of ? `Avg · ${of} nights` : `Avg · ${n} of ${of} nights`),
  /** (r071) The night card's link to the Sleep index (it lives on Scores) and the Overnight rows' labels. */
  sleepIndexLink: (value: number | null, band: string, legacy: boolean) => `Sleep index${value === null ? '' : ` ${value}`} · ${band}${legacy ? ' · On-device (legacy)' : ''}`,
  /** Shown only when nights are missing (r068 S07). */
  nights: (n: number, of: number) => `${n} of ${of} nights`,
} as const;
