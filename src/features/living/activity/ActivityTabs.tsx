/**
 * Activity: one place for everything about moving, with or without a plan. Three tabs in the bar: Train (`/train`, the
 * day's sessions, or logging and recording without a plan), Movement (`/activity`: steps, their history and the
 * activities that count) and Energy (`/energy`: what a day burned). Each page draws this row in its header's `tabs`
 * slot, the way Ring draws its own.
 */
import { LinkBank } from '@/components';
import { RING_COPY } from '@/features/ring/copy';
import { calendarDate } from '@/features/ring/model';
import { useNow } from '@/features/ring/useGauge';
import type { LocalDate } from '@/living';
import { useToday } from '../clock';
import { energyPaths } from '../energy/paths';
import { useAppMode } from '../mode';
import { livingPaths } from '../paths';
import { dayPeriod, periodSearch, type Period } from '../period';

export type ActivityTab = 'train' | 'movement' | 'energy';

const HUB = RING_COPY.activityHub;

export const ACTIVITY_COPY = {
  title: HUB.title,
  tabsLabel: HUB.tabsLabel,
  tabs: { train: HUB.train, movement: HUB.movement, energy: HUB.energy } satisfies Record<ActivityTab, string>,
} as const;

/** The browser tab's title of an Activity page: "Activity · Movement". */
export const activityDocumentTitle = (tab: ActivityTab): string => `${ACTIVITY_COPY.title} · ${ACTIVITY_COPY.tabs[tab]}`;

/**
 * The tabs do not share a clock. Train and Energy are on the app's day, which rolls over at the person's hour (04:00
 * unless changed); Movement is on the calendar day the ring files its readings under. From midnight to the rollover
 * the calendar is a day ahead.
 */
export interface ActivityDays {
  app: LocalDate;
  calendar: LocalDate;
}

/** Movement's today (as on Ring): the calendar day, with no rollover hour. */
export function useMovementToday(): LocalDate {
  return calendarDate(useNow()) as LocalDate;
}

/**
 * Where each tab opens from a page showing `period`, whose own today is `today`: the selection travels with the person.
 * An address leaves the day out only for its own page's today, so each link is written against the today of the tab it
 * opens (`days`; one day for all three outside the small hours): at 01:00 on Monday Energy still shows Sunday as
 * today, and its Movement tab opens Sunday, not the calendar's Monday. Movement and Energy show any period up to their
 * today, so a day still ahead of it (Train previews the plan's coming days) opens them on today. Train is one day, and
 * only a plan gives its days anything to pick between: a week, or no plan, opens it on today, and so does the today of
 * the page it is opened from.
 */
export function activityTabLinks(period: Period, today: LocalDate, planned: boolean, days: ActivityDays = { app: today, calendar: today }): Record<ActivityTab, string> {
  const measured = (own: LocalDate) => periodSearch(period.from > own ? dayPeriod(own) : period, own);
  const trainDay = planned && period.kind === 'day' && period.from !== today && period.from !== days.app ? period.from : undefined;
  return {
    train: livingPaths.train(trainDay),
    movement: `${livingPaths.movement()}${measured(days.calendar)}`,
    energy: `${energyPaths.day()}${measured(days.app)}`,
  };
}

const ORDER: readonly ActivityTab[] = ['train', 'movement', 'energy'];

/** The tab row; `period` is what the page shows now (Train passes its day) and `today` the page's own today. */
export function ActivityTabs({ period, today }: { period: Period; today: LocalDate }) {
  const planned = useAppMode().plan !== null;
  const links = activityTabLinks(period, today, planned, { app: useToday(), calendar: useMovementToday() });
  return <LinkBank label={ACTIVITY_COPY.tabsLabel} className="lv-activity-tabs" items={ORDER.map((t) => ({ to: links[t], label: ACTIVITY_COPY.tabs[t] }))} />;
}
