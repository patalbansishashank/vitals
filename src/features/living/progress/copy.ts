/**
 * Progress and score copy (design/screens/living-mode.md §8, design/screens/scores.md). Plain, specific, second
 * person; a gap is "not logged", never "failed"; no streaks; no internal references. Scanned by
 * src/features/living/__tests__/copy.test.ts.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const signedDays = (days: number) => `${days > 0 ? '+' : '−'}${Math.abs(days)}`;

/** Score tiles, the baseline gauge and the body-signals strip (shared with Today). */
export const SCORE_COPY = {
  signals: 'Body signals',
  indexChip: 'index · not a measurement',
  estimateChip: 'estimate',
  trendOnly: 'trend only',
  changeOnly: 'shown as change from your normal',
  tier: (t: string) => `tier ${t}`,
  likely: (range: string) => `likely ${range}`,
  needs: (n: number, have: number, unit: string) => `needs ${n} ${unit} · ${have} so far`,
  countLabel: (have: number, n: number, unit: string) => `${have} of ${n} ${unit}`,
  forming: (have: number, n: number) => `normal range forming · ${have} of ${n} nights`,
  sevenDay: (v: string) => `7-day ${v}`,
  normal: (range: string) => `normal ${range}`,
  vendor: (name: string, says: string) => `${name} says “${says}”`,
  vendorLabel: 'vendor opinion',
  undo: 'Undo',
  undoName: (text: string) => `Undo: ${text}`,
  versionName: (v: string) => `Version ${String(v).replace(/^v/, '')}: what changed`,
  versionSpoken: (v: string, grade: string) => `Version ${String(v).replace(/^v/, '')}, evidence grade ${grade}`,
  nights: (n: number) => plural(n, 'night'),
  noSignals: 'No body signals yet.',
  noSignalsBody: 'Add a ring, watch or scale, or import a file.',
  addDevice: 'Add a device',
  gaugeNormal: 'your normal',
  gaugeMean: '7-day mean',
  gaugeLast: 'last night',
  gaugeBorderline: 'the 7-day mean straddles the edge of your normal',
} as const;

export const PROGRESS_COPY = {
  title: 'Progress',
  sectionsNav: 'Progress sections',
  sectionsHeading: 'sections',
  sections: {
    trend: 'trend',
    goals: 'goals',
    adherence: 'adherence',
    body: 'body',
    signals: 'body signals',
    activity: 'from your ring', // plan 04: the link card to Body signals
    markers: 'blood markers', // E20: markers
    log: 'log',
    checkins: 'check-ins',
    plan: 'plan',
  },
  faces: {
    trend: 'Trend',
    goals: 'Goals',
    adherence: 'Adherence',
    body: 'Body',
    signals: 'Body signals',
    activity: 'From your ring', // plan 04: the link card to Body signals
    markers: 'Blood markers', // E20: markers
    log: 'Log',
    checkins: 'Check-ins',
    plan: 'Plan',
  },
  rangeLabel: 'Trend range',
  ranges: { '2wk': '2 wk', '4wk': '4 wk', '12wk': '12 wk', all: 'all' },
  showNumbers: 'show numbers',
  hideNumbers: 'hide numbers',

  /* trend */
  trendTitle: 'weight trend',
  trendReadout: (kg: string, sd: string) => `trend ${kg} kg (±${sd})`,
  sinceStart: (delta: string, near: string, far: string) => `since day 1 ${delta} kg (likely ${near} to ${far})`,
  trendForming: (n: number) => `Your trend starts after about a week of weigh-ins (${n} so far).`,
  trendGap: 'No weigh-ins for 2 weeks — the trend restarts from your next one.',
  quietTrend: (dir: string) => `trend ${dir}`,
  directions: { down: 'going down', steady: 'steady', up: 'going up' },
  noTrend: 'Your trend shows once the plan has weigh-ins.',

  /* goals */
  drift: { ahead: 'ahead', onTrack: 'on track', behind: 'behind' },
  goalDate: (range: string) => `goal date likely ${range}`,
  moved: (days: number, sd: number) => `moved by ${signedDays(days)} days (±${sd})`,
  seeEasier: 'See easier options',
  replanRest: 'Re-plan the rest',
  keepGoing: 'Keep going — nothing to change.',
  noGoals: 'Your goals show here after about a week of weigh-ins.',
  replanning: (days: number) => `Re-planning the remaining ${days} days…`,

  /* adherence */
  last7: 'last 7 days',
  last28: 'last 28 days',
  arrows: { up: '↑ rising', down: '↓ falling', steady: 'steady' },
  scored: (n: number) => `scored ${n} of 28 days`,
  logged7: (n: number) => `${n} of the last 7 days logged`,
  prevMonth: 'Previous month',
  nextMonth: 'Next month',
  blocksCaption: 'this week, by part of the plan',
  learnedTitle: 'what the plan has learned',
  calendarTitle: 'adherence by day',

  /* body */
  composition: 'composition',
  compositionAsOf: (date: string) => `from your check-in on ${date}`,
  sinceDay1: (v: string) => `since day 1 ${v}`,
  quietComposition: 'Composition is hidden while quiet mode is on.',
  noComposition: 'Your composition estimate shows after the first check-in.',
  girths: 'girths',
  girthCols: { what: 'girth', value: 'value', method: 'method', date: 'date' },
  meanOf: (n: number) => (n > 1 ? `mean of ${n}` : 'one reading'),
  noGirths: 'No girths yet. A tape measure helps the plan tell fat from muscle after a few weeks.',
  setup: 'your setup',
  setupLine: 'Your normal day, training and equipment, food and kitchen, and devices shape what the plan asks of you.',
  updateAnswers: 'Update your answers',
  addMeasurement: 'Add a measurement',

  /* signals */
  scopeLabel: 'Body signals period',
  scopes: { lastNight: 'last night', '7d': '7 days', '28d': '28 days' },
  more: 'more:',
  notBroughtIn: 'not brought in · change',

  /* log */
  logCalendar: 'Logged days',
  logList: 'Days',
  logged: 'logged',
  scoredWord: 'scored',
  soFar: 'so far',
  assumed: 'assumed',
  paused: 'paused',
  notLogged: 'not logged',
  openDay: (day: string) => `Open ${day}`,
  emptyMonth: 'Nothing logged this month.',
  noPlanLog: 'Your log fills in once a plan is running. Measurements you add show under Body.',
  keepPhone: 'Keep phone’s',
  keepLaptop: 'Keep laptop’s',
  keptVersion: (which: string) => `Kept the ${which} version.`,
  monthLabel: 'Month',

  /* check-ins */
  checkInTitle: (date: string) => `Check-in · ${date}`,
  checkInAdherence: (word: string) => `adherence this week ${word}`,
  nextCheckIn: (date: string) => `next check-in ${date}`,
  whatChanged: (v: number, summary: string) => `what changed: v${v} · ${summary}`,
  firstCheckIn: (date: string) => `Your first weekly check-in is on ${date}.`,

  /* plan */
  versionRow: (v: number, reason: string, date: string, summary: string) => `v${v} · ${reason} · ${date} — ${summary}`,
  planDetails: 'Plan details',
  planNote: 'Pause and end are in the Today menu and in Plan details.',

  /* score detail */
  back: 'Progress',
  notFound: 'Nothing to show for this.',
  notFoundBody: 'This isn’t a score Vitals keeps for you.',
  backLink: 'Back to Progress',
  gradeCaption: (v: string, grade: string) => `${v} · grade ${grade}`,
  confidence: (text: string) => `confidence: ${text}`,
  history: 'History',
  historyRanges: { '4wk': '4 wk', '12wk': '12 wk', all: 'all' },
  historyLabel: 'History range',
  changes: 'What it changes in your plan',
  recentDecisions: 'recent decisions',
  noDecisions: 'No decisions yet.',
  noHistory: 'No history yet.',
  notRunning: (text: string) => `When a plan is running, this score can change it. ${text}`,
  worked: 'How it’s worked out',
  inputs: 'inputs',
  evidence: (text: string, grade: string) => `evidence: ${text} (grade ${grade})`,
  device: 'About this device',
  vendor: 'Vendor opinion',
  vendorText: (name: string, says: string) => `${name} says “${says}” (its own method, not published). Vitals doesn’t use it for anything.`,
  versions: 'Versions',
  current: 'current',
  parts: 'parts',
  partCols: { part: 'part', today: 'today', score: 'its score', weight: 'weight set → used', available: 'available' },
  yes: 'yes',
  no: 'no',
  undone: 'Undone.',
  failed: 'That didn’t work. Try again.',
} as const;

/** "Add a measurement" panel. */
export const MEASURE_COPY = {
  title: 'Add a measurement',
  metric: 'measurement',
  metrics: {
    weight: 'weight',
    waist: 'waist',
    hip: 'hip',
    neck: 'neck',
    chest: 'chest',
    arm: 'arm',
    thigh: 'thigh',
    bodyFat: 'body fat reading',
    bloodPressure: 'blood pressure',
    ketones: 'ketones',
    glucose: 'glucose',
    labs: 'labs — coming later',
  },
  value: 'value',
  repeat: (n: number) => `repeat ${n}`,
  repeatsHelp: 'repeat 2–3 times; we use the average',
  systolic: 'systolic',
  diastolic: 'diastolic',
  method: 'method',
  methods: { tape: 'tape', scale: 'scale', dxa: 'DXA', bia: 'BIA', skinfold: 'skinfold', meter: 'meter', lab: 'lab' },
  roughNote: 'kept as a rough reading (±2 points)',
  dxaNote: 'This resets your composition estimate.',
  forDate: (date: string) => `for ${date}`,
  save: 'Save',
  cancel: 'Cancel',
  needValue: 'Enter a value first.',
  needTwo: 'Enter at least 2 repeats.',
  meanOf: (n: number) => `mean of ${n} repeats`,
  logged: (what: string, value: string) => `${what} logged · ${value}`,
  undo: 'Undo',
} as const;
