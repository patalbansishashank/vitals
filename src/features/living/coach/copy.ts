/**
 * User-facing copy for the Coach (design/screens/living-mode.md, Coach section), its change cards and its composer.
 * Plain, specific, second person; the Coach relays, it never argues or moralises. No exclamation marks, no streaks.
 * Scanned by `src/features/living/__tests__/copy.test.ts`.
 */

import type { InfoEntry } from '../components/info';

export const COACH_COPY = {
  title: 'Coach',
  conversation: 'Conversation',
  ready: 'Ready',
  setup: 'Setup needed',
  starters: {
    meal: 'Log a meal',
    weight: 'Ask about your weight',
    plan: 'Change the plan',
    choose: 'Help me choose a plan',
    mealPrompt: 'had dal, rice and two eggs for lunch',
    weightPrompt: 'why is my weight up?',
    planPrompt: 'I’m busy Thursday to Saturday',
  },
  logLabel: 'Conversation with the Coach',
  /** Speaker names, for screen readers (the layout shows who is speaking). */
  you: 'You',
  coach: 'Coach',
  writing: 'The Coach is writing…',
  /** No provider: the page's one line and its one action; also what the no-provider adapter answers. */
  noProvider: {
    title: 'Connect an AI provider to use the Coach.',
    setup: 'Set up a provider',
  },
  /** A provider is configured but couldn't be set up (living-mode.md §7.5); the runtime's reason shows under it. */
  setupFailed: {
    title: 'The Coach couldn’t start with your AI provider.',
    fix: 'Check the AI provider',
  },
  /** Settings › Coach. */
  settingsTo: '/settings/coach',
  emptyReady: 'Tell the Coach what you ate or did, or ask about your weight or your plan.',
  emptyPlanning: 'No plan is running. Ask about your body, a what-if, or how to choose a plan.',
  planningPrompts: ['Help me choose a plan', 'What would a 16:8 window change?', 'How fast can I lose 5 kg?'],
  stopped: 'Stopped. Proposals already made are still waiting below.',
  keyRefused: (provider: string) => `Your key was refused by ${provider}. Check it in Settings › Coach.`,
  outOfCredit: 'Your provider says you’re out of credit (or at your plan’s limit). Nothing was logged.',
  rateLimited: (seconds: number) => `The provider is busy — trying again in ${seconds} s.`,
  // a browser reports "server not running" and "server refuses web pages" (CORS) as the same failure: name both
  cors: (provider: string) =>
    `No answer from ${provider}: it may not be running or reachable, or it may not accept requests from a web page.`,
  offline: 'You’re offline. Your message is kept; send it when you’re back.',
  offlineReason: 'You’re offline.',
  /** Header status icons' names (and tooltips): the connection state. */
  capsule: {
    offline: 'You’re offline',
    retrying: (seconds: number) => `Provider busy: retrying in ${seconds} s`,
    retryingNow: 'Provider busy: retrying now',
  },
  sendNow: 'Send now',
  notSent: 'Not sent yet',
  discardKept: 'Discard message',
  /** What the connected model can't do: one line at the start of the conversation. */
  noTools: 'This model can’t change anything in Vitals. Logs it suggests wait for you to confirm.',
  basic: 'This model can log and answer questions, but not change your plan or run simulations.',
  safetyNoPlanningLine:
    'Your safety mode doesn’t allow plan changes here. The Coach can still log and explain.',
  /** The Coach's own answer when the safety mode blocks a plan change. */
  safetyNoPlanning: 'In your current safety mode, plans can’t be changed here. I can still log and explain.',
  segment: 'Earlier days are summarised for the Coach.',
  quiet: 'Quiet mode: the Coach talks about portions, not calories or scores.',
  showNumbers: 'Show numbers',
  hideNumbers: 'Hide numbers',
  photoSent: (provider: string) =>
    `Sent to ${provider} for this message only; the photo stays on this device.`,
  photoAlt: 'Your photo',
  tryAgain: 'Try again',
  settingsLink: 'Open Settings',
  proposalsWaiting: (n: number) => `${n} proposal${n === 1 ? '' : 's'} waiting`,
  announceReply: (text: string) => `The Coach replied: ${text}`,
  announceCards: (n: number) => `${n} card${n === 1 ? '' : 's'} below.`,
  announceStopped: 'Stopped.',
  confirmTitle: (what: string) => `${what.charAt(0).toUpperCase()}${what.slice(1)}?`,
  typeToConfirm: (word: string) => `Type ${word} to confirm.`,
  ended: 'The plan ended. You can restore it for 7 days.',
  cantComplete: 'Only the plan screens can complete that confirmation.',
  adjustDraft: (what: string) => `Change the proposal “${what}”: `,
  unknownConversation: 'This conversation isn’t on this device.',
  /** The Coach on the paired server: temporary chats (deleted after `retentionHours`). */
  server: {
    until: (when: string) => `On your server until ${when}`,
    chats: 'Chats on your server',
    keep: (hours: number) => `Keep ${hours} h longer`,
    kept: (when: string) => `Kept until ${when}`,
    remove: 'Delete this chat',
    removed: 'Chat deleted',
    fresh: 'New chat',
    none: 'No chats on your server.',
    listFailed: 'Couldn’t read the chats on your server.',
    open: 'Open',
    current: 'Open now',
    delete: 'Delete',
    deleteName: (title: string) => `Delete ${title}`,
    openName: (title: string) => `Open ${title}`,
    untitled: 'Chat',
    started: (when: string) => `started ${when}`,
  },
} as const;

/** "What the Coach knows" (standing briefing, visible): sentence case, facts with their units, no repeats. */
export const BRIEFING_COPY = {
  title: 'What the Coach knows',
  always: 'Always',
  alwaysLines: [
    'How Vitals works, its safety rules and how it asks before changing your plan.',
    'It can’t change your safety answers, fasting opt-ins or keys.',
  ],
  about: 'About you',
  trendWeight: (kg: string, range: string) => `Trend weight ${kg} kg (likely ${range} kg)`,
  trendWeightQuiet: 'Trend weight as a direction only (quiet mode)',
  noTrend: 'Not enough weigh-ins for a trend weight yet',
  supplements: (list: string) => `Supplements today · ${list}`,
  setupAnswers: 'Your setup answers',
  plan: 'Your plan',
  noPlan: 'No plan is running.',
  planLine: (name: string, day: number, of: number) => `${name} · day ${day} of ${of}`,
  todayLine: (parts: string) => `Today · ${parts}`,
  goalDate: (range: string) => `Goal date ${range}`,
  adherence: (a7: string) => `Adherence ${a7} % over 7 days`,
  adherenceQuiet: (word: string) => `Adherence over 7 days · ${word}`,
  proposals: (n: number) => `${n} proposal${n === 1 ? '' : 's'} waiting`,
  week: 'Last 7 days',
  weekLine: (day: string, n: number) => `${day} · ${n} logged`,
  weekEmpty: 'Nothing logged in the last 7 days.',
  notLogged: 'not logged',
  ask: 'Still to ask',
  askNone: 'Nothing waiting.',
  sentTo: 'Sent to',
  sentLine: (provider: string, model: string) =>
    `${provider} (${model}): this conversation and what the Coach looks up. Never your name or email; a photo only with its own message.`,
  sentNone: 'Nothing is sent: no AI provider is connected.',
  drift3: {
    ahead: 'Ahead of the forecast',
    onTrack: 'On track with the forecast',
    behind: 'Behind the forecast',
  },
  fast: (h: number) => `fast ${h} h`,
  window: (from: string, to: string) => `eating ${from}–${to}`,
  meals: (n: number) => `${n} meal${n === 1 ? '' : 's'}`,
  strength: (at: string) => `strength ${at}`,
  cardio: (at: string) => `cardio ${at}`,
} as const;

/** Change cards (shared: Coach, Today, Plan details). */
export const CARD_COPY = {
  lookedAt: 'looked at',
  showLookups: 'Show what it looked at',
  /** r068 L18: the folded rest of a proposal's explanation. */
  why: 'Why',
  needsConfirmation: 'Needs your confirmation',
  notAllowed: 'Not allowed by your safety settings',
  onlyYou: 'Only you can change that',
  stale: 'Something changed since this was proposed. Updated version:',
  expired: 'Expired — ask again',
  discarded: 'Discarded',
  undone: '(undone)',
  changesTo: 'changes to',
  apply: 'Apply',
  logIt: 'Log it',
  adjust: 'Adjust',
  discard: 'Discard',
  undo: 'Undo',
  redo: 'Redo',
  edit: 'Edit',
  done: 'Done',
  review: 'Review and confirm…',
  useUpdated: 'Use the updated version',
  notNow: 'Not now',
  leaveIt: 'Leave it',
  looksRight: 'Looks right',
  options: 'Options:',
  saw: 'saw',
  couldntSee: 'couldn’t see',
  total: 'total',
  states: {
    applied: 'Applied',
    pending: 'Proposed',
    undone: 'Undone',
    discarded: 'Discarded',
    expired: 'Expired',
    stale: 'Updated version waiting',
  },
  logged: 'Logged',
  window: 'Time remaining',
  notReached: 'not reached',
  grams: 'grams',
  gramsOf: (name: string) => `${name}, grams`,
  changeGrams: (name: string, amount: string) => `Change ${name}: ${amount}`,
  sure: (who: string, c: number) =>
    `${who} was ${c >= 0.85 ? 'quite' : c >= 0.6 ? 'fairly' : 'not very'} sure: ${c.toFixed(2)}`,
  name: {
    apply: (o: string) => `Apply ${o}`,
    logIt: (o: string) => `Log ${o}`,
    adjust: (o: string) => `Adjust ${o}`,
    discard: (o: string) => `Discard ${o}`,
    undo: (o: string) => `Undo ${o}`,
    redo: (o: string) => `Redo ${o}`,
    edit: (o: string) => `Edit ${o}`,
    review: (o: string) => `Review and confirm: ${o}`,
    useUpdated: (o: string) => `Use the updated ${o}`,
    notNow: (o: string) => `Not now: ${o}`,
    leaveIt: (o: string) => `Leave it: ${o}`,
    looksRight: (o: string) => `Looks right: ${o}`,
  },
  announce: {
    applied: (t: string) => `${t}: applied.`,
    undone: (t: string) => `${t}: undone. Redo available.`,
    discarded: (t: string) => `${t}: discarded.`,
    expired: (t: string) => `${t}: expired.`,
    stale: (t: string) => `${t}: something changed. An updated version is shown.`,
  },
} as const;

/** The composer (Coach full, Today's log bar). */
export const COMPOSER_COPY = {
  placeholder: 'Tell the Coach or ask…',
  label: 'Message to the Coach',
  prompts: 'Suggestions',
  send: 'Send',
  stopName: 'Stop the Coach',
  photo: 'Add a photo or PDF',
  pdf: 'Add a PDF report',
  removePhoto: 'Remove the photo',
  removePdf: 'Remove the PDF',
  photoAttached: 'Photo attached',
  pdfAttached: (name: string) => `PDF attached · ${name}`,
  noVision:
    'This model can’t see photos. Describe the meal in words, or choose a model with vision in Settings.',
} as const;

/**
 * What each card's (i) says (r071, AUDIT §1.2). The text that used to sit under a number or a picture lives here; a card
 * keeps the figure, the picture and mono facts. `infoProblems` (components/info.ts) guards length, evidence slugs and tone.
 */
export const INFO = {
  coach: {
    title: 'What the Coach can do',
    body: 'The Coach logs what you ate or did, answers questions about your plan and weight, and proposes changes. Nothing changes your plan until you apply it, and it cannot change your safety answers, fasting opt-ins or keys. It only sees what “What the Coach knows” lists.',
    source: { kind: 'engine', words: 'Your AI provider, with only what “What the Coach knows” lists.' },
  },
  card: {
    title: 'What this card means',
    body: 'A card is something the Coach did or wants to do. Logged means it saved at once and you can undo it for 24 hours. A proposal changes nothing until you apply it, and it expires after 24 hours. Only you can complete “Needs your confirmation”. “Not allowed” follows your safety settings. Ranges show how sure the numbers are.',
    source: { kind: 'plan', words: 'What the Coach did or proposes, and the plan it would change.' },
    evidence: 'tracking-replanning',
  },
} satisfies Record<string, InfoEntry>;
