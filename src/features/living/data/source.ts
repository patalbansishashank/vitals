/**
 * The read side of Living mode: one interface every screen reads through, so the stand-in (`./stubSource`) can be
 * swapped for the real queries without touching the screens.
 *
 * TODO(E4/E5): implement `LivingDataSource` over E4's store and E5's pure functions: `today` = `today.get`
 * (`buildTodayView`), `days`/`history` from `dayStatus` + scores, `trend` from the trend filter and the head version's
 * `ProjectionDigest`, `drift` = `plan.drift`, `checkIn` = `plan.checkIn`, `versions` = `plan.versions`,
 * `changes` = pending proposals + applied automatic changes + Coach cards. Install it with `<LivingDataProvider source>`.
 */
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { DriftReport, LocalDate, TodayView } from '@/living';
import type { TrendLaneData } from '@/features/charts/living/types';
import type { ChangeCardModel } from '../model/changeCard';
import type { AdherenceSummary, BodyComposition, CheckInModel, DayGlance, DriftCard, HistoryDay, PlanVersionRow } from './types';

export interface LivingDataSource {
  /** `today.get` for a date (past = frozen prescription + its logs; future = read-only preview); null without a live plan. */
  today(date: LocalDate): TodayView | null;
  /** Date-strip glyphs for the given dates. */
  days(dates: readonly LocalDate[]): DayGlance[];
  /** Weight trend against the forecast for [from, to] (Today 7–14 days, Progress 2 wk · 4 wk · 12 wk · all). */
  trend(from: LocalDate, to: LocalDate): TrendLaneData | null;
  drift(): DriftReport | null;
  /** Drift cards with labels, one per ranked goal (Progress › Goals). */
  driftCards(): DriftCard[];
  adherence(asOf: LocalDate): AdherenceSummary;
  checkIn(asOf: LocalDate): CheckInModel | null;
  history(from: LocalDate, to: LocalDate): HistoryDay[];
  composition(): BodyComposition | null;
  versions(): PlanVersionRow[];
  /** Change cards for a surface: Today's notices zone (proposals + applied automatic changes), the Coach, or all. */
  changes(scope: 'today' | 'all'): ChangeCardModel[];
  /** Change notification and a revision counter (bumps on every change). */
  subscribe(listener: () => void): () => void;
  revision(): number;
}

const Ctx = createContext<LivingDataSource | null>(null);
export const LivingDataProvider = Ctx.Provider;

let fallback: LivingDataSource | null = null;
/** The source used when no provider is mounted (the app installs the stub at boot of the living chunk). */
export function setDefaultLivingSource(s: LivingDataSource): void {
  fallback = s;
}

export function useLivingSource(): LivingDataSource {
  const s = useContext(Ctx) ?? fallback;
  if (!s) throw new Error('No living data source installed');
  return s;
}

/** Read from the source; re-renders when it changes. `deps` are the selector's inputs (date, range…). */
export function useLiving<T>(select: (s: LivingDataSource) => T, deps: readonly unknown[]): T {
  const src = useLivingSource();
  const rev = useSyncExternalStore(
    (l) => src.subscribe(l),
    () => src.revision(),
    () => src.revision(),
  );
  const key = JSON.stringify(deps);
  // The selector is keyed by the source revision and its inputs (`deps`, primitives or arrays of them).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => select(src), [src, rev, key]);
}
