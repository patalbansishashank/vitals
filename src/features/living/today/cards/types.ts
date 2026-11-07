/**
 * What every Today card receives (r071 AUDIT §2.7). The page builds ONE `TodayCardCtx` (it already holds all of this: the
 * day's view, the trend, the review, the clock, quiet mode) and the registry hands it to each card's `render`. A card
 * reads the context and its own data hooks; it never reads the page. `size` is the one the person chose (a tile or a
 * card; `hero` and `slim` are fixed); `onRemove` is set while the card is in a list the person can edit, and it becomes
 * the "Remove from Today" foot of the card's (i) panel (`withRemoveFoot`).
 */
import type { CardSize, EnergyUnitChoice } from '@/components';
import type { LocalDate, TodayView } from '@/living';
import type { ReviewRow, ReviewSheetModel } from '@/living/activityCandidates';
import type { TrendLaneData } from '@/features/charts/living/types';
import type { RingTodayState } from '@/features/ring';
import type { ActivePlan } from '../../activePlan';
import type { TodayActivityView } from '../../activity/data';
import type { TodayRow, TodayState } from '../model';

export interface TodayCardCtx {
  /** The viewed day, and the real today. */
  date: LocalDate;
  today: LocalDate;
  isToday: boolean;
  /** The running plan; null on Today without one (`planless`). */
  plan: ActivePlan | null;
  planless: boolean;
  /** The page state of the day (`active`, `paused`, `past`, ...); `active` without a plan. */
  state: TodayState;
  /** The plan's day view (null without a plan, or while it loads). */
  view: TodayView | null;
  /** The weight trend lane around the day (null while it loads or without weigh-ins). */
  trend: TrendLaneData | null;
  /** The activity review of the week up to the day. */
  review: ReviewSheetModel;
  /** One page-owned energy/steps run shared by the independent cards. */
  activityView?: TodayActivityView | null;
  /** The plan's rows for the day, in time order (empty without a plan). */
  rows: readonly TodayRow[];
  /** The clock hour on the real today; null on any other day. */
  nowH: number | null;
  nowMs: number;
  /** Quiet mode in effect for the page: the person's quiet setting, unless "Show numbers" was pressed. */
  quiet: boolean;
  /** From 1024 px. */
  lg: boolean;
  eu: EnergyUnitChoice;
  /** Why the ring's cards are there or not (the ring package's own state). */
  ring: RingTodayState;
  /** Open an activity's sheet (the page owns the sheet). */
  openActivity: (row: ReviewRow) => void;
  focusPlan?: ((itemId: string) => void) | undefined;
  /** "Record" and "Log an activity": the page owns both sheets and the header ⋯ carries the same two keys. */
  record: { can: boolean; open: () => void };
  log: { can: boolean; open: () => void };
}

/** The props of every card component the registry renders. */
export interface TodayCardProps {
  ctx: TodayCardCtx;
  /** `tile` or `card` for a card with two sizes; `hero` and `slim` are fixed. */
  size: CardSize;
  /** Present while the card sits in the person's list: the (i) panel's "Remove from Today". Absent on the hero. */
  onRemove?: (() => void) | undefined;
}
