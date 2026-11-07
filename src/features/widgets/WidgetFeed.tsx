/**
 * The home-screen widgets' feed (0.6.6), mounted once in the app shell in the Android app only (its own chunk).
 *
 * (r071 W1) It reads the stores and models, never a card. Before, today's energy, steps and Heart Points were published
 * from the Activity card and last night's sleep from the sleep card, so a card the person removed from Today (the library
 * of r071) would have frozen its widget without an error. Now every part comes from here, whichever page is open:
 *  - the shell's answer says which widgets are placed (`status().byCard`); only the parts a placed widget needs are
 *    read at all (the engine run behind energy and steps is the heavy one), and the pictures (series) only for a shell
 *    that reads the new snapshot revision;
 *  - the quiet setting and the weight opt-in (`widgetWeight`, a device setting, off when the key is missing);
 *  - a publish whenever the app goes to the background, and the snapshot forgotten when the person erases their data.
 * Renders nothing.
 */
import { useEffect, useMemo } from 'react';
import { useQuietMode } from '@/state/settingsStore';
import { useToday } from '@/features/living/clock';
import { useDaily } from '@/features/ring/data';
import { useRingTodayState } from '@/features/ring/RingToday';
import { useUnitPrefs } from '@/features/ring/components/parts';
import { valueText } from '@/features/ring/model';
import { useRingState } from '@/features/ring/views/cards';
import { registerEraseHook } from '@/state/persistence';
import { clearWidgets, startWidgetFlushOnPause, widgetPublisher } from '@/platform/widgets';
import { ringWidgetPart } from './feed';
import {
  FEED_CARDS,
  hrWord,
  placementOf,
  useActivityPart,
  useHeartPointsProbe,
  useHolder,
  useHrDayProbe,
  usePublishBody,
  usePublishRing,
  usePublishToday,
  useSleepPart,
  useStepsHoursProbe,
  useSyncProbe,
  useWeightPart,
  useWidgetStatus,
  useWidgetWeightAllowed,
  type HeartPointsFigures,
  type HrDayFigures,
  type Placement,
  type StepsHoursFigures,
  type SyncFigures,
} from './useWidgetFeed';

/** Reads today's minute timeline for the steps bars while a Steps widget is placed. */
function StepsProbe({ on }: { on: (v: StepsHoursFigures | null) => void }) {
  useStepsHoursProbe(useToday(), on);
  return null;
}

/** Reads today's minute timeline for the heart-rate line while a Heart rate widget is placed. */
function HrProbe({ on }: { on: (v: HrDayFigures | null) => void }) {
  useHrDayProbe(useToday(), on);
  return null;
}

/** The week's Heart Points, for a shell that still draws them (an app older than r071). */
function PointsProbe({ on }: { on: (v: HeartPointsFigures | null) => void }) {
  useHeartPointsProbe(useToday(), on);
  return null;
}

/** The last upload, for a shell that still draws it (an app older than r071). */
function SyncProbe({ on }: { on: (v: SyncFigures | null) => void }) {
  useSyncProbe(on);
  return null;
}

/** Energy and steps: the Today glance, the Energy widget and the Steps widget. */
function ActivityFeed({ placement }: { placement: Placement }) {
  const [steps, onSteps] = useHolder<StepsHoursFigures>();
  const [points, onPoints] = useHolder<HeartPointsFigures>();
  usePublishToday(useActivityPart({ energyPictures: placement.pictures('energy'), stepsHours: steps, points }));
  return (
    <>
      {placement.pictures('steps') ? <StepsProbe on={onSteps} /> : null}
      {placement.legacy ? <PointsProbe on={onPoints} /> : null}
    </>
  );
}

/** Last night's sleep: the Today glance and the Sleep widget. */
function SleepFeed({ placement }: { placement: Placement }) {
  usePublishToday(useSleepPart({ pictures: placement.pictures('sleep') }));
  return null;
}

/** The ring: the latest heart rate and the battery (the Heart rate widget; an older shell also draws the last sync). */
function RingFeed({ placement }: { placement: Placement }) {
  const today = useToday();
  const state = useRingTodayState();
  const daily = useDaily(today);
  const ring = useRingState();
  const prefs = useUnitPrefs();
  const [day, onDay] = useHolder<HrDayFigures>();
  const [sync, onSync] = useHolder<SyncFigures>();

  const metric = daily.data?.metrics?.hr;
  const latest = metric && 'latest' in metric && metric.latest && 'value' in metric.latest && typeof metric.latest.value === 'number' ? metric.latest : null;
  const hrText = latest ? valueText('hr', latest.value as number, prefs) : null;
  const part =
    state === 'loading'
      ? null
      : ringWidgetPart({
          state,
          hr: latest && hrText ? { text: hrText, at: latest.at, state: hrWord(latest.value as number), range: day?.range ?? null, series: day?.series ?? null } : null,
          battery: ring.battery !== null ? { percent: ring.battery, at: ring.batteryAt } : null,
          lastUploadAt: sync?.lastUploadAt ?? null,
        });
  usePublishRing(part);
  return (
    <>
      {placement.pictures('ring') ? <HrProbe on={onDay} /> : null}
      {placement.legacy ? <SyncProbe on={onSync} /> : null}
    </>
  );
}

/** The trend weight: only mounted while the person's opt-in is on and a Weight widget is placed. */
function WeightFeed({ placement }: { placement: Placement }) {
  usePublishBody(useWeightPart({ pictures: placement.pictures('weight') }));
  return null;
}

export function WidgetFeed() {
  const status = useWidgetStatus();
  const quiet = useQuietMode().on;
  const weightAllowed = useWidgetWeightAllowed();

  useEffect(() => startWidgetFlushOnPause(), []);
  // "Erase all data": the home screen forgets the snapshot too
  useEffect(() => registerEraseHook(() => clearWidgets()), []);
  useEffect(() => widgetPublisher()?.setQuiet(quiet), [quiet]);
  // the weight opt-in is kept here, so turning it off reaches the home screen even with no weight part mounted
  useEffect(() => widgetPublisher()?.setWeightAllowed(weightAllowed), [weightAllowed]);

  // no widget is placed: nothing is read, and the snapshot the phone still holds goes (a widget placed later must never
  // draw figures published under a setting that has changed since; it asks for the app until the feed publishes)
  const placed = status?.placed;
  useEffect(() => {
    if (placed === 0) void clearWidgets();
  }, [placed]);

  const placement = useMemo(() => (status ? placementOf(status) : null), [status]);
  // nothing is read until the shell has said which widgets are placed
  if (!placement) return null;
  return (
    <>
      {placement.wants(FEED_CARDS.activity) ? <ActivityFeed placement={placement} /> : null}
      {placement.wants(FEED_CARDS.sleep) ? <SleepFeed placement={placement} /> : null}
      {placement.wants(FEED_CARDS.ring) ? <RingFeed placement={placement} /> : null}
      {weightAllowed && placement.wants(FEED_CARDS.weight) ? <WeightFeed placement={placement} /> : null}
    </>
  );
}

export default WidgetFeed;
