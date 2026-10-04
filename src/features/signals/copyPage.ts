/**
 * Page-level copy for Body signals (design/screens/ring-pages.md §6.2, §6.3, §6.9, §7.1): the frame, the period bar and
 * its calendar, the whole-page states, the source line and the Progress link card. Charts keep their own copy.
 * Sentence case, lowercase engraved labels, a thin space between a number and its unit, no exclamation marks.
 */
import { THIN_SPACE } from '@/components/lib/format';
import type { PeriodKind, SignalsTab } from './models';

const U = THIN_SPACE;

/** "A", "A and B", "A, B and C". */
export function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export const SIGNALS_PAGE_COPY = {
  title: 'Body signals',
  backTo: 'Ring',

  tabsLabel: 'Body signals',
  tabs: { sleep: 'sleep', heart: 'heart and recovery', activity: 'activity' } satisfies Record<SignalsTab, string>,

  /* period bar (§7.1) */
  periodLabel: 'Period',
  periods: { day: 'day', week: 'week', month: 'month', year: 'year' } satisfies Record<PeriodKind, string>,
  navLabel: 'Choose the period',
  earlier: (p: PeriodKind) => `Previous ${p}`,
  later: (p: PeriodKind) => `Next ${p}`,
  laterBlocked: 'Nothing after today yet',
  earlierBlocked: 'Nothing recorded before this',
  today: 'today',
  todayName: (tab: SignalsTab) => (tab === 'sleep' ? 'Go to last night' : 'Go to today'),
  openCalendar: (label: string) => `${label}. Choose a date`,

  /* calendar popover */
  goToDate: 'Go to date',
  prevMonth: 'Previous month',
  nextMonth: 'Next month',
  weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const,
  weekdaysLong: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const,
  hasData: 'has readings',
  noData: 'no readings',
  future: 'after today',
  calendarHint: 'Days with a dot have readings.',

  /* whole-page states (§6.3) */
  emptyTitle: 'Nothing measured yet.',
  emptyBody: 'Connect a ring or import a file to see your sleep, heart and activity here.',
  connectRing: 'Connect a ring',
  importFile: 'Import a file',
  notReadSince: (day: string) => `Your ring hasn’t been read since ${day}.`,
  openRing: 'Open Ring',

  /* source line (§6.2) */
  from: (labels: readonly string[]) => `From ${joinLabels(labels)}`,
  read: (ago: string) => `read ${ago}`,
  reading: (pct: number | null) => (pct === null ? 'reading your ring' : `reading your ring · ${pct}${U}%`),
  tierNote: 'These readings are most useful as changes from your own normal.',

  /* relative read time (§5.2) */
  justNow: 'just now',
  minAgo: (n: number) => `${n}${U}min ago`,
  hAgo: (n: number) => `${n}${U}h ago`,
  yesterdayAt: (clock: string) => `yesterday ${clock}`,

  /* Progress link card (§6.9) */
  link: {
    /* not "Body signals": Progress already has a faceplate of that name (the score strip) right above */
    title: 'From your ring',
    open: 'Open body signals ›',
    openName: 'Open body signals',
    label: 'from your ring',
    asleepLastNight: 'last night asleep',
    asleepNightTo: (day: string) => `asleep, night to ${day}`,
    resting: 'resting heart rate',
    restingOn: (day: string) => `resting heart rate, ${day}`,
    stepsToday: 'steps today',
    asleep: (h: number, m: number) => (h === 0 ? `${m}${U}min` : `${h}${U}h ${m}${U}min`),
    bpm: (n: number) => `${n}${U}bpm`,
    noData: 'no data',
    noDataToday: 'no data yet today',
  },
} as const;
