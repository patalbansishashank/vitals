/**
 * The hooks behind the home-screen widgets' feed (r071 W1). They read the stores and models the cards read (the same
 * `ActivityData`, `useRingDay`, the living source), never a card: the Today library lets people remove a card, and a
 * figure published from a card would freeze on the home screen without any error. `WidgetFeed` (mounted once in the
 * shell, Android only) calls these and hands each part to the publisher (`src/platform/widgets.ts`).
 *
 * Every figure is the one the card shows (same model, same formatter); the pictures are built only when the shell can
 * draw them (`status().contract`) and a widget that draws them is placed (`status().byCard`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import '@/features/living/boot';
import { useEnergyUnit, useQuietMode } from '@/state/settingsStore';
import { useLivingClock, useToday } from '@/features/living/clock';
import { weekOf } from '@/features/living/format';
import { useActivityData } from '@/features/living/activity/data';
import { stepsHours } from '@/features/living/activity/model';
import { useLiving } from '@/features/living/data/source';
import { useRingDay } from '@/features/ring/day';
import { useAvailability, useTimeline } from '@/features/ring/data';
import { statusOf } from '@/features/ring/model';
import { addDays, localToInstant } from '@/living/dates';
import { widgetPublisher, type WidgetBody, type WidgetRing, type WidgetSeries, type WidgetToday } from '@/platform/widgets';
import { activityWidgetPart, heartRateDay, sleepWidgetPart, weightWidgetPart } from './feed';
export { FEED_CARDS, placementOf, useWidgetStatus, useWidgetWeightAllowed, type Placement } from './status';

// ------------------------------------------------------------------------------------------------ the app day

/**
 * When the app's day ends (epoch ms): the app's day rolls over at `dayRolloverH` (04:00), so between midnight and then
 * "today" is still yesterday's date. The widget keeps the figures of `today` until this instant.
 */
export function useDayEnd(today: string): number {
  const clock = useLivingClock();
  return useMemo(() => Date.parse(localToInstant(addDays(today, 1), clock.rolloverH, clock.tz)), [today, clock.rolloverH, clock.tz]);
}

// ------------------------------------------------------------------------------------------------ publishing

/** Hand a Today part to the widgets (Android app only; a no-op elsewhere). Effects run when the part's content changes. */
export function usePublishToday(part: WidgetToday | null): void {
  const quiet = useQuietMode().on;
  const key = part ? JSON.stringify(part) : null;
  useEffect(() => {
    const pub = widgetPublisher();
    if (!pub || key === null) return;
    pub.setQuiet(quiet);
    pub.setToday(JSON.parse(key) as WidgetToday);
  }, [key, quiet]);
}

export function usePublishRing(part: WidgetRing | null): void {
  const quiet = useQuietMode().on;
  const key = part ? JSON.stringify(part) : null;
  useEffect(() => {
    const pub = widgetPublisher();
    if (!pub || key === null) return;
    pub.setQuiet(quiet);
    pub.setRing(JSON.parse(key) as WidgetRing);
  }, [key, quiet]);
}

/**
 * The weight part. The publisher sends it only while the person's opt-in is on (`setWeightAllowed`, kept by the shell
 * feed); a part that goes away (the setting off, the widget removed) is taken back.
 */
export function usePublishBody(part: WidgetBody | null): void {
  const quiet = useQuietMode().on;
  const key = part ? JSON.stringify(part) : null;
  useEffect(() => {
    const pub = widgetPublisher();
    if (!pub || key === null) return;
    pub.setQuiet(quiet);
    pub.setBody(JSON.parse(key) as WidgetBody);
  }, [key, quiet]);
  // unmounting (the setting turned off, the widget removed) takes the weight off the home screen; a change of the part does not
  useEffect(() => () => widgetPublisher()?.setBody(null), []);
}

// ------------------------------------------------------------------------------------------------ the parts

/** Steps by hour for the bars: read only while a Steps widget that draws them is placed (the probe is mounted then). */
export interface StepsHoursFigures {
  hours: Array<number | null>;
  nowHour: number | null;
}

/** Reads the day's minute timeline for the steps bars and hands them up; unmounting takes them away. */
export function useStepsHoursProbe(date: string, on: (v: StepsHoursFigures | null) => void): void {
  const timeline = useActivityData().useTimeline(date);
  useEffect(() => {
    if (!timeline) {
      on(null);
      return;
    }
    const hs = stepsHours(timeline);
    const start = timeline.start ? Date.parse(timeline.start) : Date.parse(`${timeline.date}T00:00:00`);
    const nowHour = Math.floor((Date.now() - start) / 3_600_000);
    on({ hours: hs.map((h) => h.selected), nowHour: nowHour >= 0 && nowHour < hs.length ? nowHour : null });
    return () => on(null);
  }, [timeline, on]);
}

/** The week's Heart Points and the days of it so far: what the first revision's Today widget drew (the new widgets do not). */
export interface HeartPointsFigures {
  week: number | null;
  daysIn: number;
}

/** Reads the week's Heart Points as the Activity card does and hands them up; mounted only for a shell that draws them. */
export function useHeartPointsProbe(today: string, on: (v: HeartPointsFigures | null) => void): void {
  const data = useActivityData();
  const week = weekOf(today);
  const hp = data.useHeartPoints(week[0]!, today);
  const points = hp ? hp.week : undefined;
  useEffect(() => {
    on(points === undefined ? null : { week: points, daysIn: weekOf(today).filter((d) => d <= today).length });
    return () => on(null);
  }, [points, today, on]);
}

/** When the ring last uploaded: what the first revision's Heart rate widget drew as "Synced ..." (the new widgets do not). */
export interface SyncFigures {
  lastUploadAt: string | null;
}

/** Reads the last upload and hands it up; mounted only for a shell that draws it. */
export function useSyncProbe(on: (v: SyncFigures | null) => void): void {
  const avail = useAvailability();
  const lastUploadAt = avail.data?.freshness.lastUploadAt ?? null;
  useEffect(() => {
    on({ lastUploadAt });
    return () => on(null);
  }, [lastUploadAt, on]);
}

/**
 * Today's energy and steps (and the week's Heart Points for a shell that draws them), as the Activity card shows them
 * (the same `ActivityData`, so the figures are the card's to the digit): null until the model has loaded.
 */
export function useActivityPart(o: { energyPictures: boolean; stepsHours: StepsHoursFigures | null; points: HeartPointsFigures | null }): WidgetToday | null {
  const data = useActivityData();
  const today = useToday();
  const until = useDayEnd(today);
  const eu = useEnergyUnit();
  const view = data.useToday(today, true);
  const m = view?.model ?? null;
  // the realised day's scenario band; until its display day exists, the plan day's relative band (the card's own rule)
  const band = view?.day ?? view?.plan ?? null;
  const steps = o.stepsHours;
  return useMemo(() => {
    if (!m) return null;
    const soFar = m.steps.fusedSoFar ?? null;
    const goal = m.steps.goal?.value ?? null;
    return activityWidgetPart({
      date: today,
      until,
      unit: eu,
      energy: m.energy
        ? {
            soFar: m.energy.soFar,
            envelope: band?.envelope ?? null,
            total: band?.total ?? null,
            byBedtime: m.energy.byBedtime,
            plan: m.energy.plan,
            bins: o.energyPictures ? (view?.day?.bins15 ?? null) : null,
          }
        : null,
      steps: {
        soFar,
        goal,
        // the likely total only once a step is counted and a plan share is known (the card's rule)
        likely: soFar !== null && goal !== null && m.steps.prior > 0 ? (m.steps.total ?? null) : null,
        hours: steps?.hours ?? null,
        nowHour: steps?.nowHour ?? null,
      },
      ...(o.points ? { heartPoints: o.points } : {}),
      pictures: o.energyPictures || steps !== null,
    });
  }, [m, band, view, o.points, eu, today, until, steps, o.energyPictures]);
}

/**
 * Last night's sleep as the Sleep card shows it (the Ring overview's night, against the goal). `useRingDay` also asks for the
 * day's steps, load and scores: cached Gauge questions the Ring screens share, asked here only while a Today or Sleep
 * widget is placed (the night must be the card's to the minute, so it is not rebuilt from a lighter read).
 */
export function useSleepPart(o: { pictures: boolean }): WidgetToday | null {
  const today = useToday();
  const until = useDayEnd(today);
  const day = useRingDay(today);
  const night = day.night;
  const goalMin = day.goals.sleepMin.value;
  return useMemo(() => (night ? sleepWidgetPart(today, night, goalMin, { pictures: o.pictures, until }) : null), [night, goalMin, today, until, o.pictures]);
}

/** Today's heart-rate line and range for the Heart rate widget; read from the minute timeline only while it is mounted. */
export interface HrDayFigures {
  series: WidgetSeries | null;
  range: string | null;
}

export function useHrDayProbe(date: string, on: (v: HrDayFigures | null) => void): void {
  const q = useTimeline(date);
  const timeline = q.status === 'ready' ? q.data : null;
  useEffect(() => {
    if (!timeline) {
      on(null);
      return;
    }
    const start = timeline.start ? Date.parse(timeline.start) : Date.parse(`${timeline.date}T00:00:00`);
    const nowMinute = Math.min(timeline.hr.bpm.length - 1, Math.floor((Date.now() - start) / 60_000));
    on(heartRateDay(timeline.hr.bpm, nowMinute, true));
    return () => on(null);
  }, [timeline, on]);
}

/** The trend weight for the Weight widget (opt-in): the trend, where it stands against the plan, the last two weeks. */
export function useWeightPart(o: { pictures: boolean }): WidgetBody | null {
  const today = useToday();
  const view = useLiving((s) => s.today(today), [today]);
  const trend = useLiving((s) => s.trend(addDays(today, -13), today), [today]);
  return useMemo(() => {
    const line = trend ? trend.trend.map((v) => (Number.isFinite(v) ? v : null)) : null;
    const last = line ? [...line].reverse().find((v): v is number => v !== null) ?? null : null;
    const kg = view?.trendWeight ? view.trendWeight.kg : last;
    const state = view?.drift?.[0]?.state ?? null;
    return weightWidgetPart({ kg: kg ?? null, state: state === 'ahead' || state === 'onTrack' || state === 'behind' ? state : null, trend: line, pictures: o.pictures });
  }, [view, trend, o.pictures]);
}

/** The reading's word for the Heart rate widget: the app's own band for the latest heart rate ("Normal", "Elevated"). */
export function hrWord(bpm: number): string {
  return statusOf('hr', bpm).word;
}

/** A stable callback for the probes' `on` (state setters are, but a wrapper keeps their types small). */
export function useHolder<T>(): [T | null, (v: T | null) => void] {
  const [v, set] = useState<T | null>(null);
  const on = useCallback((x: T | null) => set(x), []);
  return [v, on];
}
