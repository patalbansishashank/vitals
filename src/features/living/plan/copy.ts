/**
 * Plan details copy (design/screens/living-mode.md §9–§10; IA §4.11–§4.12). Plain, second person, no internal
 * references. Scanned by src/features/living/__tests__/copy.test.ts.
 */

export const PLAN_COPY = {
  title: 'Plan details',
  backToday: 'Today',
  backDetails: 'Plan details',
  versionTitle: (n: number) => `Version ${n}`,

  /* facts */
  facts: 'This plan',
  name: 'plan',
  rung: 'rung',
  span: 'start · planned end',
  spanValue: (start: string, end: string) => `${start} → ${end}`,
  status: 'status',
  day: 'day',
  dayValue: (day: number, of: number) => `${day} of ${of}`,
  checkIn: 'weekly check-in',
  intentions: 'intentions',
  rungs: { hard: 'hard', medium: 'medium', easy: 'easy', ideal: 'ideal', custom: 'custom' } as Record<string, string>,
  statuses: { scheduled: 'scheduled', active: 'running', paused: 'paused', ended: 'ended' },
  pausedSince: (date: string) => `paused since ${date}`,
  weighIn: (time: string) => `weigh in at ${time}`,
  trainingDays: (days: string) => `training on ${days}`,
  missed: { nextDay: 'a missed session moves to the next day', skip: 'a missed session is skipped', shorter: 'a missed session becomes a shorter one' },
  noIntentions: 'No intentions set.',
  editIntentions: 'Edit intentions',
  editSoon: 'Editing intentions here is coming soon.',

  /* the ease switch (the section label names the topic; the switch says what it does — Q6-14) */
  easing: 'going easier',
  autoEase: 'Let the plan ease itself',
  autoEaseBody:
    'When your data says to go easier — poor sleep, signs of strain, a missed day — the plan makes the lighter change at once and shows it on Today with Undo. Off: every change waits for you.',
  autoEaseNote: 'This is not the Coach’s “small plan edits” switch in Settings › AI provider, which is about what the Coach may change.',
  autoEaseOn: 'The plan eases itself when your data says so.',
  autoEaseOff: 'Every change now waits for you.',

  /* versions */
  versions: 'Versions',
  versionRow: (v: number, reason: string, date: string, summary: string) => `v${v} · ${reason} · ${date} — ${summary}`,
  current: 'current',
  proposed: 'proposed',
  diffTitle: 'What changed',
  diffCols: { date: 'date', what: 'what', change: 'before → after', why: 'why' },
  noDiff: 'The plan as chosen — nothing changed in this version.',
  goalDates: 'goal dates',
  noGoalDates: 'This version didn’t forecast new goal dates.',
  goalDateValue: (label: string, range: string) => `${label}: likely ${range}`,
  versionMissing: 'That version doesn’t exist.',
  versionUnknownTitle: 'Plan version',
  versionMissingBody: 'Pick one from the list of versions.',
  allVersions: 'All versions',

  /* proposals */
  proposals: 'Waiting for you',
  noProposals: 'Nothing is waiting for you.',
  reviewOnToday: 'Review on Today',

  /* actions */
  actions: 'Change the plan',
  pause: 'Pause plan',
  resume: 'Resume plan',
  end: 'End plan…',
  replan: 'Re-plan',
  replanMenu: 'Re-plan options',
  replanRest: 'Re-plan the rest (same goals)',
  replanScratch: 'Re-plan from scratch',
  replanning: (days: number) => `Re-planning the remaining ${days} days…`,
  scheduledNoPause: 'A plan that hasn’t started can’t be paused.',
  endedNoChange: 'This plan has ended.',

  /* pause sheet */
  pauseTitle: 'Pause the plan',
  pauseBody: 'Paused days prescribe your usual day. What you log still counts.',
  from: 'from',
  fromChoices: { today: 'today', tomorrow: 'tomorrow' },
  until: 'until',
  untilText: 'you resume — from Today or here',
  reason: 'reason (optional)',
  reasonHint: 'busy week, travel, illness…',
  pauseConfirm: 'Pause plan',
  pausedToast: (date: string) => `Paused from ${date}. Resume any time.`,
  resumedToast: 'Resumed. The end date moves by the days you paused.',
  cancel: 'Cancel',

  /* end */
  endTitle: (name: string) => `End ${name}?`,
  endBody: 'It ends today. Your logs and versions are kept, and you can restore it for 7 days.',
  endType: 'Type end to confirm.',
  endKey: 'End plan',
  endedToast: (name: string) => `${name} ended.`,

  failed: 'That didn’t work. Try again.',
} as const;
