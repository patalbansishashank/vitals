/**
 * Progress copy (design/screens/living-mode.md §8). Labels in sentence case, facts under headings, units on numbers;
 * a gap is "not logged", never "failed"; no streaks; no internal references. Scanned by
 * src/features/living/__tests__/copy.test.ts.
 */

const signedDays = (days: number) => `${days > 0 ? '+' : '−'}${Math.abs(days)}`;

export const PROGRESS_COPY = {
  title: 'Progress',
  faces: {
    trend: 'Weight',
    goals: 'Goals',
    adherence: 'Adherence',
    body: 'Body',
    markers: 'Blood markers', // E20: markers
    log: 'Log',
    checkins: 'Check-ins',
  },
  rangeLabel: 'Trend range',
  ranges: { '2wk': '2 wk', '4wk': '4 wk', '12wk': '12 wk', all: 'All' },
  showNumbers: 'Show numbers',
  hideNumbers: 'Hide numbers',

  /* weight */
  sinceStart: (delta: string, date: string) => `${delta} since ${date}`,
  trendForming: (n: number) => `Trend from 7 weigh-ins · ${n} so far`,
  trendGap: (date: string) => `Last weigh-in ${date}`,
  directions: { down: 'Going down', steady: 'Steady', up: 'Going up' },
  noTrend: 'No weigh-ins yet',
  startToGoal: 'Start to goal',
  goalSpoken: (done: string, total: string) => `${done} of ${total} toward the goal`,
  goalReached: 'Goal reached',
  ofTheWay: (pct: number) => `${pct} % of the way`,
  quietWay: (f: number) => (f >= 1 ? 'goal reached' : f >= 0.67 ? 'most of the way' : f >= 0.34 ? 'about half way' : f > 0.05 ? 'some of the way' : 'at the start'),

  /* goals */
  drift: { ahead: 'ahead', onTrack: 'on track', behind: 'behind' },
  goalDate: (range: string) => `goal date ${range}`,
  moved: (days: number, sd: number) => `moved by ${signedDays(days)} days (±${sd})`,
  seeEasier: 'See easier options',
  replanRest: 'Re-plan the rest',
  keepGoing: 'Nothing to change',
  replanning: (days: number) => `Re-planning the remaining ${days} days…`,

  /* adherence: the window is spoken before the value, never printed */
  last7: 'Last 7 days',
  learnedTitle: 'What the plan has learned',

  /* body */
  composition: 'Composition',
  sinceDay1: (v: string) => `${v} since day 1`,
  quietComposition: 'Composition is hidden while quiet mode is on.',
  girths: 'Girths',
  girthCols: { what: 'Girth', value: 'Value', date: 'Date' },
  meanOf: (n: number) => `mean of ${n}`,
  noMeasurements: 'No composition or girths yet',
  addMeasurement: 'Add a measurement',

  /* log */
  prevMonth: 'Previous month',
  nextMonth: 'Next month',
  calendarLabel: (month: string) => `Log, ${month}`,
  /** r068 L27: a day with a weigh-in and nothing else logged. */
  weighInOnly: 'Weigh-in only',
  percent: (n: number) => `${n} %`,
  logged: 'Logged',
  soFar: 'so far',
  assumed: 'As planned',
  paused: 'Paused',
  notLogged: 'Not logged',
  comingUp: 'Coming up',
  openDay: (day: string) => `Open ${day}`,

  /* check-ins */
  nextCheckIn: (date: string) => `Next ${date}`,
  firstCheckIn: (date: string) => `First ${date}`,
  noCheckIns: 'No check-ins yet',
  fewWeighIns: 'too few weigh-ins',

  failed: 'That didn’t work. Try again.',
} as const;

/** "Add a measurement" panel. */
export const MEASURE_COPY = {
  title: 'Add a measurement',
  metric: 'Measurement',
  metrics: {
    weight: 'Weight',
    waist: 'Waist',
    hip: 'Hip',
    neck: 'Neck',
    chest: 'Chest',
    arm: 'Arm',
    thigh: 'Thigh',
    bodyFat: 'Body fat reading',
    bloodPressure: 'Blood pressure',
    ketones: 'Ketones',
    glucose: 'Glucose',
  },
  repeat: (n: number) => `Reading ${n}`,
  addRepeat: 'Add a reading',
  systolic: 'Systolic',
  diastolic: 'Diastolic',
  method: 'Method',
  methods: { tape: 'Tape', scale: 'Scale', dxa: 'DXA', bia: 'BIA', skinfold: 'Skinfold', meter: 'Meter', lab: 'Lab' },
  /** D2-08: the ketone sample (optional; unanswered = unknown; urine or breath is never blood BHB). */
  specimen: 'Sample',
  specimens: { capillaryBlood: 'Blood', urine: 'Urine', breath: 'Breath' },
  /** D4-05: where a blood-pressure sitting was taken (optional). */
  setting: 'Where',
  settings: { home: 'Home', clinic: 'Clinic', pharmacy: 'Pharmacy' },
  save: 'Save',
  cancel: 'Cancel',
  needValue: 'Enter a value first.',
  logged: (what: string, value: string) => `${what} logged · ${value}`,
  undo: 'Undo',
} as const;

/** Progress › activity cards (energy SPEC §V4.6). The calorie wording is "estimated"; Heart Points carry their label. */
export const ACTIVITY_COPY = {
  faces: { points: 'Heart Points', energy: 'Energy out and intake', steps: 'Steps', overnight: 'Overnight' },
  table: 'Table',

  /* Heart Points */
  pointsCaption: 'Fit-compatible estimate',
  pointsName: 'Heart Points (Fit-compatible estimate)',
  thisWeek: 'This week',
  lastWeek: 'Last week',
  soFar: (day: number) => `day ${day} of 7`,
  goalRef: '150',
  upperRef: '300',
  standing: { under: 'under 150', partial: 'under 150 · some days have no data', goal: '150 reached', upper: '300 reached', unknown: 'no data' },
  moderateEq: 'Moderate min',
  who: { met: 'WHO 150 reached', notMet: 'under WHO 150', unknown: 'some minutes unclassified', notApplicable: 'adults only' },
  noSessions: 'no sessions logged',
  whoRange: (lo: string, hi: string) => `${lo}–${hi}`,
  pointsCols: { week: 'Week of', points: 'Heart Points', days: 'Days with data', who: 'Moderate-equivalent min' },
  pointsSummary: (weeks: number, last: string, goal: string) => `Heart Points by week, last ${weeks} weeks: ${last}. Lines at 150 and 300 a week. ${goal}`,
  noPoints: 'no data',

  /* energy */
  out: 'Energy out (estimated)',
  intake: 'Intake (logged)',
  difference: 'Intake minus out',
  signedRange: (lo: string, hi: string) => `${lo} to ${hi}`,
  perDay: (unit: string) => `${unit} a day`,
  meanOfDays: (n: number) => `Means of ${n} days with both`,
  /** r068 PR3: a short status, not an explainer (the means need 3 days with both numbers). */
  fewDays: 'Not enough fully logged days yet',
  energyHidden: 'Energy is hidden while quiet mode is on.',
  energyCols: { date: 'Date', out: 'Energy out (estimated)', range: 'Scenario range', intake: 'Intake (logged)' },
  energySummary: (days: number, both: number) => `Energy out and intake by day, ${days} days; ${both} days have both.`,

  /* steps */
  last7: 'Last 7 days',
  fourWeeks: '4-week mean',
  aDay: 'a day',
  mean7: '7-day mean',
  stepsBars: 'Steps',
  atLeastKey: 'includes ring steps not placed in time',
  goal: (n: string) => `Goal ${n}`,
  defaultGoal: (n: string) => `Default goal ${n}`,
  stepsCols: { date: 'Date', steps: 'Steps', mean: '7-day mean', note: 'Note' },
  atLeastNote: 'at least',
  stepsSummary: (days: number, mean: string, goal: string) => `Steps by day, last ${days} days. Last 7 days ${mean} a day. ${goal}`,

  /* overnight */
  lowHr: 'Sleeping low HR',
  hrv: 'HRV',
  last7Nights: 'Last 7 nights',
  usual: 'usual',
  usualLabel: 'Usual',
  calibrating: (n: number, of: number) => `Calibrating · night ${n} of ${of}`,
  nightCols: { date: 'Night to', lowHr: 'Sleeping low HR', hrv: 'HRV' },
  nightSummary: (what: string, nights: number, median: string, usual: string) => `${what} by night, last ${nights} nights: median of the last 7 nights ${median}. ${usual}`,
} as const;
