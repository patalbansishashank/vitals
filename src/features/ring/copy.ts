/** Words on the Ring screens (sentence case, facts not captions; DESIGN.md "The Fact Line Rule"). */
export const RING_COPY = {
  title: 'Ring',
  tabsLabel: 'Ring section',
  tabs: { overview: 'Overview', sleep: 'Sleep', scores: 'Scores' },
  /** (r087 IA) The Activity hub: Train, the day's movement and Energy under one name in both modes. */
  activityHub: { title: 'Activity', tabsLabel: 'Activity section', train: 'Train', movement: 'Movement', energy: 'Energy' },
  /**
   * (r087 IA) One set of source words: the ring's measured readings, the phone's on-device scores and the Vitals model's
   * output (an estimate, never a reading).
   */
  sources: { ring: 'Ring', phone: 'Phone', estimate: 'Vitals estimate' },
  /** (r069 U2) The date control's calendar. */
  choose: 'Choose dates',
  /** (r069 U2) A longer period: the cards' words. */
  periodSleep: 'Time asleep',
  periodAverage: 'Average',
  periodDailyAverage: 'Daily average',
  periodTotal: 'Total',
  periodNights: 'Nights recorded',
  periodGoalMet: 'Goal met',
  periodAtGoal: 'At goal',
  ofGoalSleep: (goal: string) => `of ${goal} asleep`,
  periodNoNights: 'No nights recorded in these days.',
  periodNoActivities: 'No counted activities in these days.',
  /** (r087 IA) The one-day activity list's empty line. */
  dayNoActivities: 'No counted activities this day.',

  notPaired: {
    title: 'Connect to your server',
    body: 'Your ring’s readings reach Vitals through your server. Connect this device to it first.',
    action: 'Open Settings',
  },
  noGauge: {
    title: 'No ring data yet',
    body: 'Connect your phone to your server in Settings › Sync. Ring readings show here a few minutes after the phone sends them.',
  },
  /** Why the server gave no ring data (the client's `status().problem`). */
  problem: {
    offline: { title: 'Your server can’t be reached', body: 'Ring data shows again when this device reaches your server.' },
    unauthorized: { title: 'This device can’t read ring data', body: 'Connect it to your server again in Settings › Sync.' },
    not_supported: { title: 'Your server doesn’t serve ring data yet', body: 'Update the Vitals server, then open this page again.' },
    server_error: { title: 'Your server couldn’t read the ring data', body: 'Try again in a moment.' },
  } as Partial<Record<string, { title: string; body: string }>>,
  loading: 'Reading your ring data…',
  /** (0.6.3 A30) offline, with the answers this device kept */
  offlineKept: 'offline, showing the readings kept on this device',
  /** (r069 sync) Quiet mode's words for readings Gauge still holds on the phone. */
  waitingQuiet: 'some readings still on the phone',

  activity: 'Activity',
  movement: 'Movement',
  steps: 'Steps',
  distance: 'Distance',
  /** The ring's `caloriesKcal` (basis unstated): never "Active energy", never against a goal (A.2 #2, D20). */
  ringEnergy: 'Ring energy',
  ringEstimate: 'Ring estimate',
  /** The ring's elapsed exercise seconds ÷ 60, never an intensity (A.1.3 #31, #32). */
  activeTime: 'Active time',
  throughTheDay: 'Through the day',
  stepsHistory: 'Steps',
  noActivity: 'No steps recorded this day.',
  workouts: 'Activities',
  noWorkouts: 'No activities in the last 30 days.',
  /** (0.6.3 S25) the activity history from the canonical collection */
  noActivities: 'No counted activities in these 30 days.',
  /** (0.6.3 INT) quiet: no count of days */
  noActivitiesQuiet: 'No counted activities in this stretch.',
  countedCount: (n: number) => (n === 1 ? '1 counted' : `${n} counted`),
  earlier: 'Earlier',
  workoutsPages: 'More activities',
  later: 'Later',
  latestShown: 'These are the latest',
  vitalsHistory: 'Vitals indices',
  vitalsHistoryCaption: 'Last 14 days',
  /** (r068 SC2) Gauge's own scores and indices, one card. */
  gaugeScores: 'Phone scores',
  lowConfidence: 'low confidence',
  /** (r068 G12) plain label; what it is sits behind ⓘ */
  bookedEnergy: 'Energy',
  bookedEnergyInfo: 'The energy Vitals counts for this activity in your day: gross, so it includes what you would have burned at rest.',
  gaugeEnergy: 'Phone estimate',
  gaugeEnergyComparison: 'Phone estimate',
  counted: 'Counted',
  countedEdited: 'Counted with your times',
  pendingWorkout: 'Not counted yet',
  notCountedWorkout: 'Not counted',
  showAll: (n: number) => `Show all ${n}`,
  estimatedWord: 'estimated',
  notCounted: 'not counted yet',
  activityWord: 'Activity',
  bookedGross: 'booked (gross)',
  estimatedGross: 'estimated (gross)',
  ofGoal: (goal: string) => `of ${goal}`,
  defaultGoal: 'Default goal',
  planGoal: 'Your plan’s goal',
  ringGoal: 'The ring’s goal',
  ringGoalWord: 'Ring goal',
  planGoalWord: 'Plan goal',
  stepsFrom: 'Steps from',
  stepsFused: 'Ring and phone, one source per period',
  stepsRing: 'Ring',
  /** (r069 sync) Today's steps from Gauge's newer ring count, before the server has it. */
  stepsOnPhone: 'Ring, on this phone',
  /** The person's own steps entry for today (typed, or logged by the Coach) decides the count. */
  stepsYourEntry: 'Your entry',
  /** (Codex UI #6) nothing observed the day's steps: unknown, never "0". */
  noStepReading: 'No reading',
  stepsDisagree: 'Ring and phone disagree',
  stepsSources: 'Steps by source',
  /** The Day-score target editor (A.1.2 #42, D17: user-editable, no adaptive rule). */
  /** A command whose watch broke (Codex UI #17): send it again with the same id. */
  retry: 'Try again',
  editTarget: 'Edit target',
  targetTitle: 'Day score target',
  targetLabel: 'Target',
  targetInvalid: 'Enter a whole number from 0 to 100.',
  targetFailed: 'The target didn’t save. Try again.',

  sleep: 'Sleep',
  lastNight: 'Last night',
  night: 'Night',
  noSleep: 'No sleep recorded for this night.',
  stages: 'Stages',
  asleep: 'Asleep',
  sleepIndex: 'Sleep index',
  additionalSleep: 'Additional sleep',

  signals: 'Signals',
  editSignals: 'Edit',
  addSignals: 'Edit',
  signalsEmpty: 'No readings this day.',
  latest: 'Latest',
  overnight: 'Overnight',
  usualNight: 'Your usual night',
  readings: (n: number) => (n === 1 ? '1 reading' : `${n} readings`),
  average: 'Average',
  lowest: 'Lowest',
  highest: 'Highest',
  reference: 'What the words mean',
  bandsLabel: 'What the words mean',
  noReadings: 'No readings in this period.',
  stressNote: 'Stress is the ring’s own index, not a clinical measure.',
  stressDay: 'Stress through the day',
  body: 'How your body responded',

  scores: 'Scores',
  dayScore: 'Day score',
  indices: 'Indices',
  gaugeIndices: 'Phone indices',
  loadUnits: 'The phone’s training-load scale uses arbitrary units: compare it with your other activities, not with other apps.',
  noScores: 'No phone score for this period yet.',
  method: (v: string) => `Method ${v}`,
  legacy: 'Phone',
  contributors: 'What went into it',
  experimental: 'Experimental wellness indices',

  status: 'Ring',
  battery: 'Battery',
  connection: 'Connection',
  firmware: 'Firmware',
  phone: 'Phone',
  gaugeApp: 'Ring app',
  checkUpdates: 'Check for updates',
  noDevice: 'The phone has not reported the ring yet.',

  last7: 'Last 7 days',
  apps: 'Apps',
  save: 'Save',

  /**
   * (social-time) Social time: the whole-app foreground time across the social apps, against the person's daily target
   * band. Quiet, non-judging voice; the apps and the band sit behind (i). Never shame.
   */
  social: {
    title: 'Social time',
    /** The hero's spoken/plain label: "28 min in social apps today". */
    minutesIn: (n: string) => `${n} in social apps today`,
    unit: 'min',
    targetWord: 'Daily target',
    /** The band's words (calm at or below the low edge, warming toward the high edge, over past it). */
    within: 'Within your budget',
    nearing: 'Near your budget',
    over: 'Over your budget',
    /** When the app has sent nothing for the day. */
    notSent: (isToday: boolean) => (isToday ? 'No social time sent for today yet.' : 'No social time sent for this day.'),
    noneWeek: 'No social time sent this week.',
    /** The per-app split, named in the (i) panel. */
    byApp: 'By app',
    noApp: 'No time in these apps today.',
    /** Usage access prompt (Android, when the grant is off). */
    turnOnUsage: 'Turn on Usage access',
    /** On web/desktop, where there is no phone. */
    needsPhone: 'Social time is measured on your Android phone.',
    /** Settings. */
    enabledApps: 'Apps counted',
    target: 'Daily target',
    targetFrom: 'From',
    targetTo: 'To',
    on: 'Social time',
  },

  heartRate: 'Heart rate',
  measure: 'Measure now',
  zones: 'Heart-rate zones',
  zonesOverTime: 'Zones over time',
  duringWorkout: 'During the activity',
  gaugeZones: 'Phone zones',
  /** (Codex #11) Which heart rate the zone time came from. */
  zonesFromSamples: 'timed from each heart-rate reading',
  zonesFromMinutes: 'timed from minute averages (the single readings were not available)',
  route: 'Route',
  duration: 'Duration',
  pace: 'Pace',
  avgHr: 'Average',
  maxHr: 'Peak reading',
  singleReading: 'one reading',
  workoutMissing: 'This activity is no longer on your server.',
  open: 'Open',
} as const;
