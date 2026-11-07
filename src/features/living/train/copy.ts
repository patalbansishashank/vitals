/**
 * Train screen copy (design/screens/living-mode.md, Train). Labels only; a line under a heading is a fact (a number, a
 * date, a state); buttons are verb + object; sentence case; a gap is "not logged", never a failure; no streaks, no
 * exclamation marks; no internal references (scanned by the living copy test).
 */

import type { InfoEntry } from '../components/info';

const cap = (s: string): string => (s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s);

export const TRAIN_COPY = {
  title: 'Train',

  /** Header status icon's name on a paused day (it opens Plan details). */
  paused: 'Plan paused',
  outsidePlan: 'Outside the plan',
  noPlan: 'No plan running',
  makePlan: 'Make a plan',
  /** (0.6.3 S24/A7) Tracking without a plan: log, record and review stay here. */
  hub: {
    title: 'Activities',
    record: 'Record',
    /** r068 L17: the hub's list of what was done lately. */
    recent: 'Recent',
    none: 'Nothing logged this past week.',
  },
  /** (0.6.3 A33) The person's training setup is read before anything is composed or estimated. */
  setupLoading: 'Reading your training setup…',
  setupError: 'Your training setup could not be read. Try again in a moment.',
  showNumbers: 'Show numbers',
  hideNumbers: 'Hide numbers',

  restTitle: 'Rest day',
  restSteps: (steps: string) => `Target ${steps} steps`,
  /** A rest day with no step count (r068 T10): one line, no empty dots. */
  noSteps: 'No steps recorded',
  /** Rest day: steps so far against the day's target (a dotted fill). */
  steps: 'Steps',
  stepsOf: (target: string) => `of ${target} steps`,
  stepsOver: (n: string) => `+${n} over`,
  /** Header ⋯ and the rest day's key: an activity outside the plan (§V4.4). */
  logActivity: 'Log an activity',
  /** (0.6.3 INT, S2) a session composed on the typical placeholder body: no energy figure */
  typicalBody: 'Composed for a typical body: add your weight in Your body to see its energy',

  /** Session nouns: "lift", "walk", … */
  noun: { resistance: 'lift', walk: 'walk', run: 'run', cycle: 'ride', swim: 'swim', row: 'row', hiit: 'intervals', other: 'cardio' } as Readonly<Record<string, string>>,
  /** "Lift · 33 min · home"; a one-exercise session is named by its exercise ("Folk dance · 46 min · home"). */
  sessionTitle: (what: string, minutes: number, place: string | null) => `${cap(what)} · ${minutes} min${place ? ` · ${place}` : ''}`,
  place: { home: 'home', gym: 'gym', park: 'park', other: 'out' } as Readonly<Record<string, string>>,
  target: (dayWord: string, what: string) => `${dayWord} ${what}`,
  todayWord: 'today’s',
  dayWord: (weekday: string) => `${weekday}’s`,

  start: 'Start timer',
  stop: 'Stop timer',
  elapsedShort: (clock: string) => `${clock} elapsed`,
  stopShort: 'Stop',

  logStyle: 'Log by',
  logStyles: { quick: 'Sets', detailed: 'Reps', duration: 'Minutes' },

  exercises: 'Exercises',
  rx: {
    sets: (n: number, reps: number) => `${n} × ${reps}`,
    holds: (n: number, sec: number) => `${n} × ${sec} s hold`,
    work: (n: number, sec: number) => `${n} × ${sec} s`,
    rounds: (n: number) => `${n} rounds`,
    load: (kg: number) => `at ${kg} kg`,
    rest: (sec: number) => `rest ${sec} s`,
    tank: (n: number) => `leave ${n} rep${n === 1 ? '' : 's'} in the tank`,
    /** A row that differs from the session's stated cue (r068 L21): short, so its energy stays on the line. */
    tankShort: (n: number) => `${n} in the tank`,
    minutes: (m: number) => `${m} min`,
    speed: (kmh: number) => `at ${kmh} km/h`,
    kcal: (kcal: string) => `≈ ${kcal} kcal`,
  },
  tickName: (name: string) => `Mark ${name} as done as planned`,
  done: 'Done',
  undo: 'Undo',
  undoName: (name: string) => `Undo ${name} done`,
  unskipName: (name: string) => `Undo skipping ${name}`,
  /** Header ⋯ item (one-exercise session) and what tapping an exercise's name opens. */
  swapItem: 'Swap for another exercise…',
  /** Read with an exercise's name, which opens its swap sheet (the sheet also skips it). */
  rowHint: 'Swap or skip',
  skipName: (name: string) => `Skip ${name}`,
  instead: (name: string) => `instead of ${name}`,
  undoSwap: 'Undo swap',
  undoSwapName: (name: string) => `Undo the swap for ${name}`,
  everyWeekday: (weekday: string) => `Use this swap on every ${weekday}`,
  state: { done: 'done', partial: 'partly done', skipped: 'skipped', open: 'to do' },

  chips: (name: string) => `Sets of ${name}`,
  chip: (k: number, amount: string) => `set ${k}, ${amount}`,
  chipReps: (reps: number) => `${reps} reps`,
  chipSec: (sec: number) => `${sec} s`,
  setLabel: (k: number) => `set ${k}`,
  setWord: 'set',
  /** The small index on a set key (r068 T1): "Set 1" over "6 reps". */
  setKey: (k: number) => `Set ${k}`,
  kg: 'kg',
  reps: 'reps',
  repsLeft: 'reps left',
  /** A derived dose (credit) that the logged inputs can't establish (D3-01). */
  doseUnknown: 'Unknown',
  /** D4-02: an unresolved concerning exertional symptom holds exercise progression for review. */
  exerciseReview: 'Exercise · Review',
  minutes: 'minutes',
  speed: 'speed',
  incline: 'incline',
  /** Visible labels over the minutes, speed and incline fields (each field's spoken name adds the exercise). */
  fields: { minutes: 'Minutes', speed: 'Speed', incline: 'Incline' },
  addSet: 'Add a set',
  removeSet: 'Remove the last set',

  sessionDone: 'Session done',
  somethingElse: 'I did something else',
  skippedItem: (what: string) => `Skipped the ${what}`,
  review: (done: number, total: number, counted: string) => `${done} of ${total} exercise${total === 1 ? '' : 's'} · counted ${counted}`,
  reviewNote: 'Untouched exercises count as planned',
  save: 'Save',
  back: 'Back',

  saved: {
    full: (target: string, pct: number) => `Counts as ${target} · ${pct} %`,
    partial: (fix: string) => `Partly · ${fix}`,
    // D3-02: a short status (Done · Partly · Different) with what it counted toward; the allocation detail is in the sheet
    different: (credited: string, target: string) => `Different · counts toward ${credited} · ${target} open`,
    also: (regions: string) => `also trained: ${regions}`,
    skipped: (target: string) => `${cap(target)} is marked as skipped.`,
  },
  logged: {
    done: 'Logged as planned',
    partial: (counted: string) => `Logged · partly · counted ${counted}`,
    skipped: 'Logged as skipped',
  },
  change: 'Change what you did',
  toast: {
    skipped: (what: string) => `${cap(what)} marked as skipped`,
    logged: (what: string) => `${cap(what)} logged`,
    undo: 'Undo',
    proposal: (pct: number) => `Proposal waiting on Today · keeps ${pct} %`,
  },
  cantSave: 'That couldn’t be saved. Try again.',

  swapSheet: {
    title: (name: string) => `Swap ${name}`,
    /** The sheet's one line: the scope, and the credit threshold said once for every option (r068 T9). */
    todayOnly: (dayWord: string, fullPct: number) => `For ${dayWord} session only · full credit from ${fullPct} %`,
    none: 'Nothing on your equipment matches',
    showAll: 'Show all',
    needs: (what: string, plural: boolean) => `needs ${what} (you don’t have ${plural ? 'them' : 'one'})`,
    use: (name: string) => `Use ${name}`,
    useShort: 'Use',
    somethingElse: 'Something else…',
    askCoach: 'Ask the Coach for options',
    coachDraft: (name: string) => `Options to swap ${name} today?`,
  },

  else: {
    title: 'Something else',
    titleItem: (name: string) => `Instead of ${name}`,
    field: 'What did you do?',
    placeholder: 'e.g. rollouts 3 × 10',
    results: 'Matching exercises',
    ready: 'on your equipment',
    needsKit: 'needs other equipment',
    asOther: (name: string) => `Log it as “${name}”`,
    asTyped: (text: string) => `Use “${text}” as you typed it`,
    picked: 'What you did',
    newItem: 'New to your catalogue',
    sets: 'sets',
    reps: 'reps',
    minutes: 'minutes',
    save: 'Save',
    noMatch: 'No match in the catalogue',
    /** §V4.4 manual log: an activity outside the plan (no session to compare with). */
    /** Back to the list once something is picked (the list folds away so the estimate shows). */
    another: 'Pick another activity',
    change: 'Change',
    logTitle: 'Log an activity',
    logPlaceholder: 'e.g. brisk walk 40 min',
    log: 'Log',
    common: 'Common activities',
    time: 'Time',
    effort: 'How hard',
    efforts: { light: 'Easy', moderate: 'Moderate', vigorous: 'Hard' },
    previewLabel: 'Estimate',
    energy: 'Energy above rest',
    energyRange: (range: string) => `${range} · estimated`,
    energyInfo: 'Movement above your own rest, from the type, minutes and how hard. The range is a scenario, not a measurement.',
    points: 'Heart Points',
    pointsChip: 'Fit-compatible estimate',
    noEstimate: 'No estimate for a type the catalogue does not know yet',
    logged: (name: string, minutes: string) => `Logged ${name} · ${minutes} min`,
    /** (r063 FX3) Quiet mode: no minutes. */
    loggedQuiet: (name: string) => `Logged ${name}`,
    /** (0.6.3 A27) When it happened: a start, or an explicit "time not known". */
    when: {
      start: 'Started at',
      ends: (clock: string) => `Ends ${clock}`,
      unknown: 'I don’t know the time',
      unknownHelp: 'It counts on this day without a clock time, so it is not matched against your ring or phone.',
      needed: 'Set the start, or say you don’t know the time.',
      /** (r069 D3) the steps the ring and phone counted in the logged time */
      steps: 'Steps counted then',
    },
    /** (0.6.3 A5) The log overlaps an activity the ring or phone recorded: the person chooses before it is saved. */
    resolve: {
      title: (what: string) => `Your ring or phone recorded ${what}. What was this?`,
      replace: 'Use this log instead of the recording',
      link: 'The same activity: add these details to it',
      separate: 'These were two separate activities',
      /** (r063 FX3 aR16) What "the same activity" saves: the recording's own window and evidence, not the typed minutes. */
      linked: (when: string, minutes: string | null, from: string, hr: boolean) =>
        `Saved as the recording: ${when}${minutes ? `, ${minutes} min` : ''}, from your ${from}${hr ? ' with its heart rate' : ''}. The estimate below is for that time.`,
    },
    needsWeight: 'Vitals needs your body weight for an estimate. Add it in your profile or log a weigh-in.',
    loading: 'Reading your setup…',
  },

  equipment: {
    /** Header ⋯ item and the sheet's title. */
    title: 'Equipment',
    owned: 'Your equipment',
    edit: 'Edit equipment',
    none: 'No equipment listed · sessions use body weight',
    add: 'Add equipment',
    places: 'Places and days',
    everyDay: 'every day',
    wouldHelp: 'Would help',
    nothing: 'Nothing to buy for this plan',
    needed: 'needed for this plan',
    adds: (what: string) => `adds ${what} work`,
    tierName: (tier: number) => (tier <= 0 ? 'free' : `price ${'₹'.repeat(Math.min(4, tier))}`),
  },

  week: {
    /** Header ⋯ item on phones (the list sits beside the day on desktop). */
    open: 'This week',
    title: 'This week',
    titleOf: (monday: string) => `Week of ${monday}`,
    rest: 'rest day',
    outside: 'outside the plan',
    status: { done: 'done', partial: 'partly', skipped: 'skipped', unknown: 'not logged', planned: 'planned' },
  },

  weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as readonly string[],
} as const;

/**
 * What each card's (i) says (r071, AUDIT §1.2). The text that used to sit under a number or a picture lives here; a card
 * keeps the figure, the picture and mono facts. `infoProblems` (components/info.ts) guards length, evidence slugs and tone.
 * The credit thresholds in `session` and `stimulus` are the catalogue's (full at 90 %, partly from 60 %): a test keeps the
 * words and `FULL_CREDIT_AT` / `PARTIAL_CREDIT_AT` equal.
 */
export const INFO = {
  session: {
    title: 'How a session is logged',
    body: 'Tick sets or whole exercises as you do them; Session done counts anything you did not touch as planned. A swapped exercise is compared with the prescribed work: 90 % or more counts in full, 60 to 89 % counts partly. “Leave 2 reps in the tank” means stop with two reps still possible. Energy is an estimate from your weight.',
    source: { kind: 'estimate', words: 'Energy comes from your weight and the work in the session.' },
    evidence: ['resistance-training', 'training-catalogue'],
  },
  rest: {
    title: 'Rest days',
    body: 'A rest day has no session, only a step target to keep you moving. Steps come from your ring and phone, counted once, so the number can grow after you open the page. Log an activity if you trained anyway; it counts on this day.',
    source: { kind: 'ring', words: 'Steps from your ring and phone, counted once.' },
    evidence: 'daily-activity-maintenance',
  },
  week: {
    title: 'Your week',
    body: 'Each day shows what your plan asks for and what you logged: done, partly, skipped, not logged yet, or planned for later. A rest day is part of the plan. The bars show planned minutes and the bright one is today. Tap a day to open it.',
    source: { kind: 'plan', words: 'What the plan asks for, and what you logged against it.' },
  },
  hub: {
    title: 'Activities without a plan',
    body: 'You can log or record activity without a plan. What your ring and phone detect counts on its own; log anything they missed. A plan only adds matching and forecasts.',
    source: { kind: 'ring', words: 'Your ring and phone, plus what you log by hand.' },
    evidence: 'cardio-activity',
  },
  stimulus: {
    title: 'Same stimulus',
    body: 'Swapping an exercise keeps your plan honest. Vitals compares the work you did with the work prescribed: muscle, strength, cardio, energy and mobility. At 90 % or more it counts in full; 60 to 89 % counts partly and says what is short; below that it counts as different work and is credited to what it trained.',
    source: { kind: 'engine', words: 'The exercise catalogue’s own comparison.' },
    evidence: 'training-catalogue',
  },
} satisfies Record<string, InfoEntry>;
