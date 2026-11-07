/**
 * Plan details copy (design/screens/living-mode.md §9–§10; IA §4.11–§4.12). Labels in sentence case, facts as rows,
 * no internal references, no "coming soon". Scanned by src/features/living/__tests__/copy.test.ts.
 */

import type { InfoEntry } from '../components/info';

export const PLAN_COPY = {
  title: 'Plan details',
  backDetails: 'Plan details',
  /* the plan card's title in plain words when the stored name is an internal tag ("Coach: medium") */
  rungNames: { hard: 'Hard', medium: 'Medium', easy: 'Easy' },
  rungPlan: (rung: string) => `${rung} plan`,
  untitled: 'Your plan',
  versionShort: (n: number) => `Version ${n}`,
  versionTitle: (n: number, date: string) => `Version ${n} · ${date}`,

  /* facts (rows of the plan card; the status row only when the plan is not running) */
  status: 'Status',
  starts: 'Starts',
  day: 'Day',
  dayValue: (day: number, of: number) => `${day} of ${of}`,
  ends: 'Ends',
  checkIn: 'Check-in',
  length: 'Length',
  weeks: (n: number) => `${n} week${n === 1 ? '' : 's'}`,
  everyWeekday: (weekday: string) => `${weekday}s`,
  statuses: { scheduled: 'Scheduled', active: 'Running', paused: 'Paused', ended: 'Ended' },
  weighIn: 'Weigh-in',
  trainingDays: 'Training',
  missedSession: 'Missed session',
  missed: { nextDay: 'moves to the next day', skip: 'is skipped', shorter: 'becomes a shorter one' },

  /* the ease switch: the row says what it does; when it applies is its accessible description only */
  autoEase: 'Let the plan ease itself',
  autoEaseBody: 'After a missed day, lighter changes apply straight away, with Undo.',
  autoEaseOn: 'Lighter changes apply at once',
  autoEaseOff: 'Every change waits for you',

  /* versions */
  versions: 'Versions',
  current: 'current',
  proposed: 'proposed',
  diffTitle: 'What changed',
  diffCols: { date: 'Date', what: 'What', change: 'Before → after', why: 'Why' },
  asChosen: 'The plan as first chosen.',
  noDiff: 'No day changed in this version.',
  goalDates: 'Goal dates',
  goalDateValue: (label: string, range: string) => `${label} · likely ${range}`,
  versionMissing: 'That version doesn’t exist.',
  versionUnknownTitle: 'Plan version',
  allVersions: 'All versions',
  weekOf: (week: number, of: number) => `Week ${week} of ${of}`,
  versionDay: (day: number) => `Day ${day}`,
  adopted: (proposed: boolean, date: string, day: number) =>
    `${proposed ? 'Proposed' : 'Adopted'} ${date} · Day ${day}`,
  table: 'Table',
  notReached: 'Not reached',

  /* proposals */
  proposals: 'Waiting for you',

  /* actions: the header ⋯ holds the plan's lifecycle; Resume sits on the Paused row */
  pause: 'Pause plan',
  resume: 'Resume plan',
  end: 'End plan…',
  replanRest: 'Re-plan the rest (same goals)',
  replanScratch: 'Re-plan from scratch',
  replanning: (days: number) => `Re-planning the remaining ${days} days…`,

  /* pause sheet */
  pauseTitle: 'Pause plan',
  from: 'From',
  fromChoices: { today: 'Today', tomorrow: 'Tomorrow' },
  until: 'Until',
  untilText: 'You resume',
  reason: 'Reason (optional)',
  reasonHint: 'busy week, travel, illness…',
  pauseConfirm: 'Pause',
  pausedToast: 'Plan paused',
  pausesToast: (date: string) => `Plan pauses from ${date}`,
  resumedToast: 'Resumed. The end date moves by the days you paused.',
  cancel: 'Cancel',

  /* end */
  endTitle: 'End plan?',
  endBody: 'You can restore it for 7 days.',
  endKey: 'End plan',
  endedToast: (name: string) => `${name} ended.`,

  failed: 'That didn’t work. Try again.',
} as const;

/**
 * What each card's (i) says (r071, AUDIT §1.2). The text that used to sit under a number or a picture lives here; a card
 * keeps the figure, the picture and mono facts. `infoProblems` (components/info.ts) guards length, evidence slugs and tone.
 */
export const INFO = {
  plan: {
    title: 'Your plan',
    body: 'The plan runs day by day to its end date, with a weekly check-in. Training days are the days it asks for a session. “Let the plan ease itself” lets lighter changes after a missed day apply straight away, with Undo; every other change waits for you. A missed session follows the rule you chose at the start.',
    source: { kind: 'plan', words: 'The dates and days you chose when you started it.' },
    evidence: 'tracking-replanning',
  },
  versions: {
    title: 'Plan versions',
    body: 'Every change to your plan makes a new version, so nothing is lost. Version 1 is the plan as you first chose it. Open one to see what moved and how the goal date shifted. A proposed version waits for you and is not part of the plan until you apply it.',
    source: { kind: 'plan', words: 'Every version your plan has had.' },
    evidence: 'tracking-replanning',
  },
  safety: {
    title: 'Safety check',
    body: 'Before a plan starts, Vitals checks it against your safety answers. Verified means it passed; Unchecked means there is no check to run yet; Review needs a look first; a limit conflict cannot start. Exercise review and kidney nutrition show here when they apply.',
    source: { kind: 'engine', words: 'Your safety answers and the limits they set.' },
  },
} satisfies Record<string, InfoEntry>;
