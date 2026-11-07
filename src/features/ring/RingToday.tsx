/**
 * The ring on Today (r071). Today mounts these cards by name (`RingSleepToday`, `RingGlance`, `ShortVideoCard`,
 * `RingStepsToday`, `RingTodayNote`), or the two groups `RingTodayFaces` has always drawn (`part` glance and videos). Each
 * opens the Ring section on the same day; each takes an `infoFooter` for the (i) panel's foot ("Remove from Today"). Without
 * a server or Gauge data they render nothing: the Ring section carries the empty state, and the one slim note says why.
 * Never an error wall.
 *
 * - `RingSleepToday`: last night, compact (the number, a small hypnogram, the goal).
 * - `RingGlance`: heart rate now, with HRV, blood oxygen and stress under it. The Day score is its own card.
 * - `RingStepsToday`: the day's steps on a day without a plan (the Activity card's compact form).
 * - `RingShortVideos`: the short-video count, where Gauge has counted some this week.
 */
import type { ReactNode } from 'react';
import { BluetoothOff, HeartPulse } from 'lucide-react';
import { CardFoot, CardHead, GradientCard, KeyLink, MonoMeta } from '@/components';
import { useServerPairing } from '@/features/settings/server/hooks';
import { paths } from '@/app/paths';
import { useQuietMode } from '@/state/settingsStore';
import { RING_COPY as C } from './copy';
import { gauge } from './api';
import { useAvailability, useShortVideo, useTimeline } from './data';
import { useRingDay } from './day';
import { RING_DOMAIN } from './domains';
import { noteInfo, signalsInfo } from './info/overview';
import { hasGaugeData, sentText, shiftDate } from './model';
import { lastSentOf, useGaugeLive, waitingOf } from './localFill';
import { availableSources, entryOf, offeredEntries, shownIds } from './monitor/catalogue';
import { useRingMonitor } from './monitor/store';
import { entryValue, personal, type MonitorCtx } from './monitor/values';
import { ringPaths } from './paths';
import { useNow } from './useGauge';
import { quietSynced } from './quiet';
import { statusWord } from './signalWords';
import { MeasureKey } from './components/MeasureKey';
import { Loading, useUnitPrefs } from './components/parts';
import { SignalHero, SignalRow, pickHero, signalStatus } from './components/SignalRows';
import { ActivityCard } from './views/ActivityCard';
import { ShortVideoCard } from './views/ShortVideoCard';
import { SleepCard } from './views/SleepCard';
import './views/overview.css';

export function RingTodayFaces({
  date,
  today,
  part = 'all',
}: {
  date: string;
  today: string;
  /** (r068 V1) Both cards (default), or one of them where Today places them in different columns. */
  part?: 'all' | 'glance' | 'videos';
}) {
  const a = useAvailability();
  if (a.status !== 'ready' || !hasGaugeData(a.data) || date > today) return null;
  return (
    <>
      {part !== 'videos' ? <RingGlance date={date} today={today} /> : null}
      {part !== 'glance' ? <RingShortVideos date={date} /> : null}
    </>
  );
}

/** Why Today has no ring cards, or 'ready' (and 'loading' while the server is asked). */
export type RingTodayState = 'loading' | 'ready' | 'empty' | 'unreachable' | 'unpaired';

export function useRingTodayState(): RingTodayState {
  const a = useAvailability();
  const paired = useServerPairing() !== null;
  if (a.status === 'loading') return 'loading';
  if (a.status === 'unavailable') return paired || gaugeProblem() === 'offline' ? 'unreachable' : 'unpaired';
  return hasGaugeData(a.data) ? 'ready' : 'empty';
}

function gaugeProblem(): string | null {
  try {
    return gauge().status().problem ?? null;
  } catch {
    return null;
  }
}

/** Today's words for the ring's states (no digits: they read the same in quiet mode). The sentences are the note's (i) text. */
export const RING_TODAY_WORDS = {
  unreachable: 'Ring data shows when this device reaches your server.',
  unpaired: 'Ring data shows here once this device is connected to your server.',
  connect: 'Connect',
  empty: 'Ring data shows here once your phone sends some to your server.',
  steps: 'Steps',
} as const;

/** (r071) What the slim note says in a few words: the state, as a fact. */
export const RING_NOTE_WORDS = {
  unreachable: 'Server unreachable',
  unpaired: 'Not connected',
  empty: 'Waiting for the phone',
} as const;

/**
 * Where the ring's cards would be (nothing while loading or when they show): one slim row with the state in words and, when
 * this device is not connected to a server, one pill to connect. What it means is its (i).
 */
export function RingTodayNote({ state, infoFooter }: { state: RingTodayState; infoFooter?: ReactNode }) {
  if (state === 'loading' || state === 'ready') return null;
  return (
    <GradientCard
      as="section"
      size="slim"
      domain={RING_DOMAIN.device}
      head={
        <CardHead
          as="h2"
          icon={BluetoothOff}
          title={C.title}
          info={noteInfo(RING_TODAY_WORDS[state], infoFooter)}
        />
      }
    >
      <MonoMeta tone="ink">{RING_NOTE_WORDS[state]}</MonoMeta>
      {state === 'unpaired' ? (
        <KeyLink to={paths.settings('sync')} variant="primary" size="sm" arrow>
          {RING_TODAY_WORDS.connect}
        </KeyLink>
      ) : null}
    </GradientCard>
  );
}

/** Last night's sleep on Today: the Sleep card in its compact form (the number, a small hypnogram, the goal). */
export function RingSleepToday({
  date,
  today,
  infoFooter,
}: {
  date: string;
  today: string;
  infoFooter?: ReactNode;
}) {
  const state = useRingTodayState();
  const day = useRingDay(date);
  if (state !== 'ready' || date > today) return null;
  return <SleepCard date={date} day={day} compact infoFooter={infoFooter} />;
}

/**
 * (r068 V24) The ring's main night ending on `date`, in hours asleep to the quarter hour (null without one): what the
 * Today sleep row's sheet starts its "Hours asleep" field on, so it never opens empty beside an answer.
 */
export function useRingNightHours(date: string): number | null {
  const day = useRingDay(date);
  const v = day.night;
  return v && Number.isFinite(v.tstLower) && v.tstLower > 0 ? Math.round(v.tstLower / 15) / 4 : null;
}

/** The day's steps on Today without a plan: the Ring overview's Activity card, compact (the number against the goal). */
export function RingStepsToday({
  date,
  today,
  infoFooter,
}: {
  date: string;
  today: string;
  infoFooter?: ReactNode;
}) {
  const state = useRingTodayState();
  const day = useRingDay(date);
  if (state !== 'ready' || date > today) return null;
  return (
    <ActivityCard date={date} day={day} title={RING_TODAY_WORDS.steps} compact infoFooter={infoFooter} />
  );
}

// (0.6.7, owner: "stress is missing") Today's ring card names the signals Today's own cards do not show (never sleep
// times, steps, energy or zones). (r068 V4) Only four of them: heart rate, HRV, blood oxygen and stress first (in the
// person's own order, any they hid left out, the next shown filling a gap); the full list is the Ring page's. (r071) The
// first is the card's hero, the other three are its rows.
const GLANCE_FACTS = 4;
const GLANCE_FIRST = ['hr', 'hrv', 'spo2', 'stress'];
const ON_TODAY_ELSEWHERE = new Set([
  'zone13',
  'zone45',
  'sleepDuration',
  'fellAsleep',
  'woke',
  'midpoint',
  'steps',
  'distance',
  'activeTime',
  'activeEnergy',
  'totalEnergy',
  'dayScore',
]);

/** (r068 V4) Which signals the Today card shows: the key four first, in the person's order, then the next ones shown. */
export function glanceIds(shown: readonly string[]): string[] {
  const usable = shown.filter((id) => !ON_TODAY_ELSEWHERE.has(id));
  const first = usable.filter((id) => GLANCE_FIRST.includes(id));
  return [...first, ...usable.filter((id) => !GLANCE_FIRST.includes(id))];
}

/**
 * Heart rate now, and what else the ring says about how you are (r071): the heart rate as the hero with the day's spark,
 * HRV, blood oxygen and stress as three rows on their scales, "Measure now" and when Gauge last sent in the foot (today
 * only). The whole card opens the Ring overview on this day. Nothing while Gauge data is unavailable or the day is ahead.
 */
export function RingGlance({
  date,
  today,
  infoFooter,
}: {
  date: string;
  today: string;
  infoFooter?: ReactNode;
}) {
  const a = useAvailability();
  if (a.status !== 'ready' || !hasGaugeData(a.data) || date > today) return null;
  return <GlanceCard date={date} today={today} infoFooter={infoFooter} />;
}

function GlanceCard({ date, today, infoFooter }: { date: string; today: string; infoFooter?: ReactNode }) {
  const a = useAvailability();
  const now = useNow();
  const live = useGaugeLive();
  const prefs = useUnitPrefs();
  const quiet = useQuietMode().on;
  const day = useRingDay(date);
  const stored = useRingMonitor();
  const timeline = useTimeline(date);
  const offered = offeredEntries(availableSources({ timeline: timeline.status === 'ready' }), quiet);
  const isToday = date === today;
  const ctx: MonitorCtx = {
    daily: day.daily,
    baselines: day.baselines,
    night: day.night,
    scores: day.scores,
    steps: day.steps,
    zones: null,
    prefs,
    now,
  };
  const base = personal(day.baselines);
  const facts = glanceIds(shownIds(stored, offered))
    .map((id) => {
      const e = entryOf(id)!;
      const v = entryValue(id, ctx);
      const status = signalStatus(e, v, base);
      return { id, e, v, status, word: status ? statusWord(status, quiet) : null };
    })
    .filter((f) => f.v.text !== null)
    .slice(0, GLANCE_FACTS);
  if (day.q.status === 'ready' && !facts.length) return null;
  const hero = pickHero(facts, quiet);
  const rows = facts.filter((f) => f !== hero);
  // (r068 V3) another day is over: no "synced 4 min ago" and no Measure now on Monday
  const sent = a.data ? lastSentOf(a.data.freshness.lastUploadAt, live) : null;
  const synced =
    isToday && a.data ? (quiet ? quietSynced(sent, now) : sentText(sent, now, waitingOf(live, now))) : null;
  const ready = day.q.status === 'ready';
  return (
    <GradientCard
      as="section"
      domain={RING_DOMAIN.signals}
      glow="tr"
      href={ringPaths.tab('overview', isToday ? undefined : date)}
      head={
        <CardHead
          as="h2"
          icon={HeartPulse}
          title={C.heartRate}
          info={signalsInfo({ quiet, prefs, footer: infoFooter })}
        />
      }
      foot={
        ready ? (
          <CardFoot right={synced ?? undefined}>
            {/* heart rate on demand, on the real today only */}
            {isToday ? <MeasureKey /> : null}
          </CardFoot>
        ) : undefined
      }
    >
      {day.q.status === 'loading' ? <Loading lines={3} /> : null}
      {ready ? (
        <>
          {hero ? (
            <SignalHero
              entry={hero.e}
              value={hero.v}
              status={hero.status}
              date={date}
              today={today}
              base={base}
              prefs={prefs}
              quiet={quiet}
            />
          ) : null}
          {rows.length ? (
            <ul className="rgo-rows" data-after-hero={hero ? '' : undefined}>
              {rows.map(({ id, e, v }) =>
                e.metric && v.reading !== null ? (
                  <SignalRow
                    key={id}
                    kind={e.metric}
                    label={e.label}
                    to={ringPaths.signal(e.metric, date)}
                    value={v.reading}
                    base={base}
                    age={v.age}
                    prefs={prefs}
                    status={v.chip}
                  />
                ) : null,
              )}
            </ul>
          ) : null}
        </>
      ) : null}
    </GradientCard>
  );
}

/** The short-video card where Gauge has counted some this week; nothing otherwise (Today never nags). */
export function RingShortVideos({ date, infoFooter }: { date: string; infoFooter?: ReactNode }) {
  const q = useShortVideo(shiftDate(date, -6), date);
  if (q.status !== 'ready' || !q.data.days.length) return null;
  return <ShortVideoCard date={date} compact infoFooter={infoFooter} />;
}
