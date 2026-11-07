/**
 * User-facing copy shared by Living screens (design/screens/living-mode.md). Plain, specific, second person; no internal
 * references (spec names, section signs, package ids) — `__tests__/copy.test.ts` scans every `copy.ts` under
 * `src/features/living`. Never moralising: a gap is "not logged", never "failed"; no streaks, no exclamation marks.
 */

export const GUARD_COPY = {
  /** Food, Train and Plan details without a plan (Today works in both modes since 0.6.3). */
  noPlan: 'Start a plan to use this screen.',
} as const;

/** Mode strip and return key (COMPONENTS §13.17; IA §3.4). */
export const STRIP_COPY = {
  running: (name: string) => `${name} is running`,
  scheduled: (name: string) => `${name} starts soon`,
  paused: (name: string) => `${name} is paused`,
  dayOf: (day: number, of: number) => `day ${day} of ${of}`,
  safe: 'Changes here don’t touch it until you replace it.',
  back: 'Back to Today',
  returnKey: 'today',
  planningTools: 'planning',
  planningToolsMenu: 'Planning tools',
} as const;

/** The date target (sheets that take a date): what it reads before a date is set. */
export const DATE_COPY = {
  chooseDate: 'Choose a date',
  chooseDateTime: 'Choose a date and time',
} as const;

export const TODAY_COPY = {
  title: 'Today',
  /** The header's one fact line: "Saturday, 17 October · day 16 of 90". */
  dayOf: (day: number, of: number) => `day ${day} of ${of}`,
  /** Page items of the header ⋯ (the global items follow). */
  menuItems: {
    away: 'Busy or away',
    fast: 'Log a fast',
    showNumbers: 'Show numbers',
    hideNumbers: 'Hide numbers',
    details: 'Plan details',
  },
  /** The header's status icons (their names and tooltips): the one home of plan events on Today. */
  status: {
    checkIn: 'Weekly check-in ready',
    changes: (n: number) => (n === 1 ? '1 change waiting' : `${n} changes waiting`),
    paused: 'Plan paused',
  },
  planFace: 'Plan',
  markDay: 'Mark all as planned',
  dayMarked: 'Day marked as planned',
  nextUp: 'Next up',
  allDone: 'All done',
  eatWindow: (range: string) => `eat ${range}`,
  // (r068 final M4) the day's question: under a weigh-in, "it" read as the weigh-in
  howHard: 'How hard was today?',
  howHardTitle: 'How hard was today?',
  soFar: 'So far',
  dayTotal: 'Day total',
  eaten: 'Eaten',
  protein: 'Protein',
  weight: 'Weight',
  trendWord: 'trend',
  goalDate: (range: string) => `Goal date ${range}`,
  goalShift: (days: number, sd: number) => `Moved ${Math.abs(days)}\u00a0days ${days > 0 ? 'later' : 'earlier'} (±${sd})`,
  unusualWeighIn: (delta: string) => `Unusual weigh-in (${delta} kg): it counts less in the trend`,
  noTrend: (n: number) => `No trend yet · ${n} weigh-in${n === 1 ? '' : 's'}`,
  drift: { ahead: 'ahead', onTrack: 'on track', behind: 'behind' },
  rowSheet: { asPlanned: 'As planned', partly: 'Partly', skipped: 'Skipped' },
  /** The row sheet's answer bank (Today's rows; the meal sheet on Today and Food). */
  howDidItGo: (label: string) => `How did ${label} go?`,
  rowWord: { done: 'as planned', partial: 'partly', skipped: 'skipped', assumed: 'filled in as planned' },
  /** The meal sheet's fact when food is logged but neither its amount nor an answer is known. */
  mealLogged: 'logged',
  tickName: (label: string) => `Mark ${label} as planned`,
  untickName: (label: string) => `Undo ${label}`,
  changeName: (label: string) => `Change ${label}`,
  ticked: (label: string) => `${label.charAt(0).toUpperCase()}${label.slice(1)} marked as planned`,
  loggedOf: (value: string, planned: string) => `Logged ${value} · planned ${planned}`,
  openTrain: 'Open in Train',
  undo: 'Undo',
  weighKey: 'Log',
  weighTitle: 'Weight',
  weighTitleOn: (day: string) => `Weight · ${day}`,
  weighSaved: (v: string) => `Weight ${v} saved`,
  hoursAsleep: 'Hours asleep',
  steps: 'Steps',
  brokeAt: 'Broke it at',
  logKey: 'Log',
  /** One-time sheet after a lapse. */
  welcome: {
    title: (n: number) => `You missed ${n} day${n === 1 ? '' : 's'}`,
    fill: 'Fill in as planned',
    leave: 'Leave empty',
    filled: (n: number) => `${n} day${n === 1 ? '' : 's'} filled in as planned`,
  },
  paused: {
    title: 'Plan paused',
    since: (date: string) => `Since ${date}`,
    resume: 'Resume plan',
    resumed: 'Plan resumed',
  },
  safety: {
    title: 'Plan paused for safety',
    resume: 'Resume…',
    ackTitle: 'Resume the plan?',
    ackBody: 'Resume only if the reason for the safety pause no longer applies.',
    ackKey: 'Resume plan',
  },
  conflict: {
    title: (n: number) => (n === 1 ? 'An entry was changed on two devices' : `${n} entries were changed on two devices`),
    review: 'Review',
    sheetTitle: 'Changed on two devices',
  },
  changes: {
    sheetTitle: 'Changes waiting',
    applied: 'Plan updated',
    kept: 'Plan kept',
    undone: 'Undone',
    redone: 'Redone',
  },
  checkIn: {
    title: 'Weekly check-in',
    weight: 'Weight',
    week: 'This week',
    change: 'Change',
    noChange: 'No change this week',
    biggestGap: (text: string) => `Biggest gap: ${text}`,
    next: (date: string) => `Next check-in ${date}`,
  },
  scheduled: {
    title: (when: string) => `Starts ${when}`,
    day1: 'Day 1',
    beforeDay1: 'Before day 1',
    groceries: 'Groceries',
    openList: 'Open list',
    firstWeighIn: 'First weigh-in',
    logWeight: 'Log weight',
    discard: 'Discard plan…',
    discardKey: 'Discard plan',
    discardTitle: (name: string) => `Discard ${name}?`,
    discardBody: 'You can make a new plan in the Planner.',
    discarded: (name: string) => `${name} discarded`,
  },
  complete: (name: string) => `${name} is complete`,
  planAgain: 'Plan again',
  nothingPrescribed: 'Nothing planned for this day',
  replanReady: 'A proposal is waiting on Today.',
  awayTitle: 'Busy or away',
  awayKind: 'What’s happening',
  awayKinds: { busy: 'Busy', travel: 'Travelling', illness: 'Unwell', noTraining: 'No training', socialMeal: 'Meal out' },
  awayFrom: 'From',
  awayTo: 'To',
  awayOn: 'On',
  awayNote: 'Note',
  awayPushBack: (days: number) => `Push the plan back ${days} day${days === 1 ? '' : 's'}`,
  awayKey: 'Save',
  awayDidntFinish: 'That didn’t go through. Try again.',
  fastTitle: 'Log a fast',
  fastStart: 'Started',
  fastEnd: 'Ended',
  fastEndBeforeStart: 'The end has to be after the start.',
  fastFuture: 'The end can’t be later than now.',
  fastTooLong: (maxH: number) => `A fast logged here can be up to ${maxH} hours.`,
  fastMissing: 'Enter a date and time.',
  /** The length the two ends make, a value in the sheet's body (the commit is the header's "Log"). */
  fastLength: 'Length',
  fastLogged: (length: string) => `Fast of ${length} logged`,
  failed: 'That didn’t work. Try again.',
  cancel: 'Cancel',
} as const;

export const START_COPY = {
  title: (rung: string) => `Start ${rung}`,
  name: 'Plan name',
  defaultName: (rung: string, month: string) => `${rung} plan · ${month}`,
  startDate: 'Start date',
  startChoices: { today: 'today', tomorrow: 'tomorrow', nextMonday: 'next Monday', pick: 'pick a date' },
  checkInDay: 'Weekly check-in',
  weighInTime: 'Weigh-in time',
  trainingDays: 'Training days',
  ifMissed: 'If I miss a session',
  missedChoices: { nextDay: 'do it the next day', skip: 'skip it', shorter: 'do a shorter one' },
  beforeDay1: 'Before day 1',
  nothingToBuy: 'Nothing to buy.',
  groceries: 'Groceries for the first 3 days are on Food once the plan starts.',
  start: 'Start plan',
  replace: 'Replace active plan…',
  replaceTitle: (name: string) => `Replace ${name}?`,
  replaceBody: 'It ends today and is kept in your history; you can restore it for 7 days.',
  replaceType: 'Type replace to confirm.',
  replaceKey: 'Replace plan',
  startsToast: (name: string, when: string) => `${name} starts ${when}`,
  undo: 'Undo',
  failed: 'The plan couldn’t be started.',
  starting: 'Starting the plan…',
  entry: 'Start this plan',
} as const;

/**
 * Today's activity, the review strip and sheet, the activity sheet and recording (energy research: §V4.1–§V4.3). Calories
 * are "estimated" with a "scenario range"; Heart Points are a Fit-compatible estimate; quiet mode has no kcal or scores.
 */
export const ACTIVITY_COPY = {
  face: 'Activity',
  energy: 'Energy',
  energyCaption: 'Estimated, with likely ranges',
  soFar: 'So far',
  byBedtime: 'By bedtime',
  plan: 'Plan',
  energyDetails: 'Through the day',
  steps: 'Steps',
  stepsSoFar: (n: string) => `${n} so far`,
  stepsLikely: (n: string) => `about ${n} by bedtime`,
  stepsLikelyNote: 'the rest of the day as planned',
  stepsGoalDefault: 'of 10 000 steps',
  stepsOf: (goal: string) => `of ${goal} steps`,
  stepsSources: 'By source',
  disagree: 'Ring and phone disagree',
  noSteps: 'No steps yet today',
  heartPoints: 'Heart Points',
  heartPointsLabel: 'Heart Points',
  heartPointsWeek: 'of 150 this week',
  /** (r068 V22) the goal beside "No readings" when nothing is known yet */
  heartPointsGoal: (goal: string) => `goal ${goal} this week`,
  /** (r068 V22) the goal beside "No step data yet" */
  stepsGoal: (goal: string) => `goal ${goal}`,
  heartPointsToday: (n: string) => `${n} today`,
  heartPointsPending: (n: string) => `${n} more once counted`,
  activities: 'Today’s activities',
  noActivities: 'Nothing recorded yet today',
  statusWord: { pending: 'not counted yet', possible: 'possible', approved: 'counted', edited: 'counted, edited', rejected: 'not counted', superseded: 'withdrawn' },
  byHand: 'logged by hand',
  // (r070) the activity sheet (nothing is reviewed any more: activities are counted automatically)
  edit: 'Edit',
  reject: 'Reject',
  updated: 'Updated since it was counted',
  /** (r069) what changed, after "Updated since it was counted" */
  updatedWhat: (what: string) => `${what} changed`,
  changeWords: { type: 'type', times: 'times', minutes: 'minutes', energy: 'energy', points: 'Heart Points', estimate: 'estimate' },
  saved: (name: string) => `${name} saved`,
  undo: 'Undo',
  failed: 'That didn’t work. Try again.',
  // activity sheet
  type: 'Type',
  typeSearch: 'Search activities',
  suggested: 'Suggested',
  recent: 'Recent',
  time: 'Time',
  start: 'Start',
  end: 'End',
  startEnd: 'Start and end',
  trimTo: (clock: string) => `Movement stopped at ${clock}`,
  trimKey: 'End there',
  carry: 'Where was the phone?',
  carries: { pocket: 'Pocket', hand: 'Hand', desk: 'Desk' },
  planned: (name: string) => `This was my planned ${name}`,
  intensity: 'How hard',
  intensities: { light: 'Light', moderate: 'Moderate', vigorous: 'Hard' },
  machineKcal: 'Machine calories (optional)',
  machineKcalHelp: 'Counts exactly as shown, 0 included.',
  estimate: 'Estimate',
  /** (0.6.3 S31) the booked figure is the gross energy of the activity (all of it, resting part included). */
  booked: 'Burned',
  bookedNote: 'This is what counts in today’s energy. A preview in Train shows only the part above your resting burn, so it reads smaller.',
  /** (r068 V10) the method and the other estimates, behind one disclosure */
  howWorkedOut: 'How this is worked out',
  comparisons: 'Compared',
  vendor: (source: string) => source,
  method: {
    reported: 'what the machine showed',
    power: 'power',
    speedGrade: 'speed and incline',
    personalHr: 'your heart rate',
    keytel: 'heart rate',
    met: 'activity type and effort',
  } as Record<string, string>,
  heartRate: 'Heart rate',
  zonesBasis: { pctMax: 'Zones from your maximum heart rate (estimated from age)', hrr: 'Zones from your heart-rate reserve' } as Record<string, string>,
  peak: 'Peak',
  mean: 'Average',
  noHr: 'No heart rate in this window',
  /** (Codex #11) Which heart rate the zone time came from. */
  hrSource: { samples: 'Timed from each heart-rate reading', minuteMeans: 'Timed from minute averages: the single readings were not available' } as Record<string, string>,
  /** (r068 V10) the share of the activity with a heart-rate reading */
  hrCovered: 'Heart rate covered',
  unknownHr: (t: string) => `${t} without a reading`,
  points: 'Heart Points',
  // energy chart and steps chart
  chartTitle: 'Energy through the day',
  total: 'Total',
  active: 'Active',
  tef: 'Food digestion',
  restOfDay: 'Ahead, as planned',
  /** (r068 V17) without a plan: what is still ahead is the likely day */
  restOfDayLikely: 'Rest of the day (likely)',
  perQuarter: (unit: string) => `${unit} per 15 min`,
  activeLine: (n: string, unit: string) => `Active: ${n} ${unit}, above your resting burn`,
  toReview: 'not counted yet',
  allocation: 'Timing within each hour is approximate.',
  stepsTitle: 'Steps by source',
  ring: 'Ring',
  phone: 'Phone',
  counted: 'Counted',
  residual: (n: string) => `${n} ring steps have no time of day (not added to the total)`,
  atLeast: 'Includes ring steps not placed in time',
  // recording
  record: 'Record',
  recordTitle: 'Record an activity',
  recordType: 'Activity',
  gps: 'Use GPS',
  gpsHelp: 'For a route and distance outdoors. Uses more battery.',
  startKey: 'Start',
  viaLocal: 'Starts on this phone.',
  viaServer: 'Starts on your phone, through your server.',
  offline: 'The phone hasn’t checked in for a while: it starts when it does, or not at all after a minute.',
  waiting: 'Waiting for the phone…',
  recording: (type: string, elapsed: string) => `Recording ${type} · ${elapsed}`,
  paused: (type: string, elapsed: string) => `Paused ${type} · ${elapsed}`,
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  started: (type: string) => `Recording ${type}`,
  stopped: 'Recording stopped. It shows here once it uploads.',
  // (r063 FX3, S20) Gauge's deliberate no-GPS fallback: the recording runs, without a route
  noGps: 'Recording without GPS',
  noGpsWhy: (warning: string | undefined): string =>
    warning === 'gps_permission_missing'
      ? 'The phone app isn’t allowed to use location, so this recording has no route or distance.'
      : warning === 'gps_precise_permission_missing'
        ? 'The phone app has only approximate location, which can’t draw a route.'
        : warning === 'gps_location_off'
          ? 'Location is off on the phone, so this recording has no route or distance.'
          : 'The phone app couldn’t use GPS, so this recording has no route or distance.',
  gpsAllow: 'Allow location in the ring app',
  gpsTurnOn: 'Turn on location',
  gpsElsewhere: (warning: string | undefined): string =>
    warning === 'gps_location_off' ? 'Turn on location on your phone for the next recording.' : 'On your phone, open the ring app and allow precise location for the next recording.',
  gpsNotOpened: 'Couldn’t open the ring app here. On your phone, open the ring app and allow precise location.',
  // recording: the activity picker and local control (0.6.3 S26, S4)
  recordTypeSearch: 'Search activities',
  localAsk: 'The ring app is on this phone. Let Vitals start and stop its recordings here, without your server.',
  localAllow: 'Allow Vitals to control the ring app on this phone',
  localAllowed: 'Vitals can now control the ring app on this phone.',
  localDeclined: 'Not allowed. You can allow it later in Android settings, under Vitals’ permissions.',
  localNeedsLink: 'Allow Vitals to control the ring app on this phone, or pair your server, to record.',
  // sleep quick actions
  goingToSleep: 'Going to sleep',
  imUp: 'I’m up',
  lightsOutAt: (clock: string) => `lights out ${clock}`,
  upAt: (clock: string) => `up ${clock}`,
  lightsOutSaved: (clock: string) => `Lights out at ${clock}`,
  upSaved: (clock: string) => `Up at ${clock}`,
  // day groups
  now: 'Now',
  dayStrip: 'The day',
  anyTime: 'Any time today',
} as const;
