/**
 * Ring (`/ring…`): everything Gauge measures, read from the person's server. Four tabs in the bar (Overview · Sleep ·
 * Activity · Scores) and three pushed pages (a signal over time, a workout, the short-video brain and its limit). The
 * ring's connection and battery sit in the bar's status slot. The day is in the
 * address (`?date=`) so a card on Today opens the same day here. (r069 U2) Under the tabs, the shared date control:
 * Overview is one day; Sleep, Activity and Scores also show a week, a month, a year or a custom range
 * (`?period=…`, `src/features/living/period.ts`), which the address keeps across the tabs. Without a server or without Gauge data, one empty
 * state says what to do. Works with or without a plan (outside the Living guard).
 */
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { LinkBank, Page } from '@/components';
import { TopBar, type MenuEntry } from '@/app/shell';
import { DateControl } from '@/features/living/components/DateControl';
import { ALL_PERIODS, DAY_ONLY, coercePeriod, periodFromSearch, periodSearch, type Period, type PeriodKind } from '@/features/living/period';
import { isLocalDate } from '@/living/dates';
import type { LocalDate } from '@/living';
import { RING_COPY as C } from './copy';
import { useAvailability } from './data';
import { METRICS, calendarDate, isRingMetric, sentText, workoutName } from './model';
import { lastSentOf, useGaugeLive, waitingOf } from './localFill';
import { ringPaths, type RingTab } from './paths';
import { refreshGauge, useGaugeProblem, useNow } from './useGauge';
import { syncWords, useRingCommand, useRingLink } from './commands';
import { quietSynced } from './quiet';
import { useActivityData } from '@/features/living/activity/data';
import { engine, engineActive, isBusy, useGaugeEngine } from '@/state/gaugeEngine';
import { DeviceView, MoveFromGauge } from './engine';
import { ENGINE_COPY as EC } from './engine/copy';
import { useQuietMode } from '@/state/settingsStore';
import { Loading, RingGate } from './components/parts';
import { SleepSections } from '@/features/living/sleep/sections';
import { SleepPeriodView } from '@/features/living/sleep/SleepPeriod';
import { ActivityPeriodView } from './views/ActivityPeriodView';
import { ActivityView } from './views/ActivityView';
import { OverviewView } from './views/OverviewView';
import { ScoresPeriodView } from './views/ScoresPeriodView';
import { ScoresView } from './views/ScoresView';
import { useRingDays } from './marks';
import { MetricView } from './views/MetricView';
import { RingStatusCapsule } from './views/RingStatusCard';
import { ShortVideoView } from './views/ShortVideoView';
import { WorkoutView, useWorkout } from './views/WorkoutView';
import '@/features/living/living.css';
import './ring.css';

const TABS: ReadonlyArray<{ id: RingTab; label: string }> = [
  { id: 'overview', label: C.tabs.overview },
  { id: 'sleep', label: C.tabs.sleep },
  { id: 'activity', label: C.tabs.activity },
  { id: 'scores', label: C.tabs.scores },
];

/** (r069 U2) The periods each tab can show: the Overview is one day by nature. */
export const RING_PERIODS: Record<RingTab, readonly PeriodKind[]> = { overview: DAY_ONLY, sleep: ALL_PERIODS, activity: ALL_PERIODS, scores: ALL_PERIODS };

/** The period in the address (never after today); a pushed page reads the day it ends on. */
function useRingPeriod(today: string): Period {
  const [params] = useSearchParams();
  return periodFromSearch(params, today as LocalDate, ALL_PERIODS, today as LocalDate);
}

/**
 * (r068 B2) "Refresh ring data": the phone's Gauge syncs the ring and uploads (`ring.sync` through the server), then
 * every question on screen is asked again; the screen re-reads at once too, so what the server already has shows
 * meanwhile. While the request travels, and when it fails, the bar's subtitle says where it is ("Sent to your phone…",
 * "Syncing the ring…", or why not). A Gauge too old for `ring.sync` gets the re-read only, and says so.
 */
function useRefresh(): { menu: MenuEntry[]; words: string | null } {
  const link = useRingLink();
  const sync = useRingCommand('ring.sync');
  const eng = useGaugeEngine();
  const [asked, setAsked] = useState<'sync' | 'old' | null>(null);
  // capabilities are [] until Gauge reports them: try, and an old Gauge answers `unknown_type`
  const canSync = link.paired && (link.capabilities.length === 0 || link.capabilities.includes('ring.sync'));
  const local = engineActive(eng);
  const refresh = () => {
    refreshGauge();
    // (r070) the engine on this phone syncs the ring itself: no round trip through the server
    if (local) {
      void engine.syncNow().then(() => refreshGauge());
      return;
    }
    if (!canSync) {
      setAsked(link.paired ? 'old' : null);
      return;
    }
    setAsked('sync');
    void sync.send({});
  };
  const menu: MenuEntry[] = [
    { id: 'ring-refresh', label: sync.pending || isBusy(eng, 'sync') ? 'Refreshing…' : 'Refresh ring data', onSelect: refresh, disabled: sync.pending || isBusy(eng, 'sync') },
  ];
  let words: string | null = null;
  if (local) words = isBusy(eng, 'sync') ? EC.syncing : eng.error?.action === 'sync' ? eng.error.message : null;
  else if (sync.pending) words = syncWords(sync.last);
  else if (asked === 'old') words = 'Update the ring app on the phone to refresh from the ring';
  // a finished sync shows in "Synced just now"; a failure, a partial sync or an upload still on its way keeps its words
  else if (asked === 'sync' && sync.last && (sync.last.state !== 'done' || sync.last.result?.uploaded === false || sync.last.result?.complete === false)) words = syncWords(sync.last);
  // (r068 final B2) when the phone answers done, its upload has landed: ask every question on screen again
  const doneId = sync.last?.state === 'done' ? sync.last.id : null;
  useEffect(() => {
    if (doneId) refreshGauge();
  }, [doneId]);
  return { menu, words };
}

/**
 * "Gauge sent 17:16" (r069 sync: the newest of the server's provenance, the live pulse and Gauge's own record on this
 * phone, with the readings still waiting there), ticking once a minute. (0.6.3 A30) Offline it says the readings are the
 * ones this device kept; refused (the pairing ended) shows the empty state instead.
 */
function useSynced(): string | undefined {
  const a = useAvailability();
  const now = useNow();
  const quiet = useQuietMode().on;
  const problem = useGaugeProblem();
  const live = useGaugeLive();
  if (!a.data) return undefined;
  const sent = lastSentOf(a.data.freshness.lastUploadAt, live);
  const waiting = waitingOf(live, now);
  const synced = quiet ? quietSynced(sent, now) + (waiting > 0 ? ` · ${C.waitingQuiet}` : '') : sentText(sent, now, waiting);
  if (problem === 'offline') return `${synced} · ${C.offlineKept}`;
  if ('cached' in a && a.cached === true) return `Saved readings${'refreshing' in a && a.refreshing === true ? ' · checking for updates' : ''} · ${synced}`;
  return synced;
}

const Gate = RingGate;

export default function RingPage() {
  const { kind, id } = useParams();
  const { pathname } = useLocation();
  const today = calendarDate(useNow());
  const period = useRingPeriod(today);
  const date = coercePeriod(period, DAY_ONLY, today as LocalDate).from;
  if (pathname.startsWith('/ring/signals/')) return isRingMetric(kind) ? <MetricScreen kind={kind} date={date} /> : <Navigate to={ringPaths.root} replace />;
  if (pathname.startsWith('/ring/workouts/') && id) return <WorkoutScreen id={id} today={today} />;
  if (pathname === '/ring/short-videos') return <ShortVideoScreen date={date} />;
  if (pathname === ringPaths.device) return <DeviceScreen />;
  const tab: RingTab = pathname === '/ring/sleep' ? 'sleep' : pathname === '/ring/activity' ? 'activity' : pathname === '/ring/scores' ? 'scores' : 'overview';
  return <RingTabs tab={tab} period={period} today={today} />;
}

/**
 * (0.6.3 S23) Today's engine run, as Today makes it: it publishes the plan's active energy (the Ring's active-energy goal)
 * and the day's energy (the monitor's energy entries). Not in quiet mode (no energy figures there).
 */
function TodayEnergyFeed({ today }: { today: string }) {
  useActivityData().useToday(today, true);
  return null;
}

function RingTabs({ tab, period: asked, today }: { tab: RingTab; period: Period; today: string }) {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const lastSynced = useSynced();
  const synced = refresh.words ?? lastSynced;
  const quiet = useQuietMode().on;
  // the tab shows what it can of the period in the address; the address keeps the rest for the next tab
  const period = coercePeriod(asked, RING_PERIODS[tab], today as LocalDate);
  const date = period.kind === 'day' ? period.from : null;
  const search = periodSearch(asked, today as LocalDate);
  const select = (p: Period) => navigate(`${ringPaths.tab(tab)}${periodSearch(p, today as LocalDate)}`, { replace: true });
  const tabs = <LinkBank label={C.tabsLabel} className="rg-tabs" items={TABS.map((t) => ({ to: `${ringPaths.tab(t.id)}${search}`, label: t.label, end: true }))} />;
  // (r068 S07) the date control under the tabs names the day or period; the bar says only how fresh the data is
  const subtitle = synced || undefined;
  return (
    <>
      <TopBar title={C.title} documentTitle={`Ring · ${TABS.find((t) => t.id === tab)!.label}`} subtitle={subtitle} tabs={tabs} menu={refresh.menu} status={<RingStatusCapsule />} />
      <Page stack className="rg-page">
        {quiet ? null : <TodayEnergyFeed today={today} />}
        {tab === 'overview' ? <MoveFromGauge /> : null}
        <Gate>
          <DateControl value={period} onChange={select} today={today as LocalDate} max={today as LocalDate} periods={RING_PERIODS[tab]} useMarks={useRingDays} />
          {tab === 'overview' ? <OverviewView date={period.from} /> : null}
          {tab === 'sleep' ? date ? <SleepSections date={date} today={today} /> : <SleepPeriodView period={period} today={today} /> : null}
          {tab === 'activity' ? date ? <ActivityView date={date} today={today} /> : <ActivityPeriodView period={period} today={today} /> : null}
          {tab === 'scores' ? date ? <ScoresView date={date} /> : <ScoresPeriodView period={period} today={today} /> : null}
        </Gate>
      </Page>
    </>
  );
}

/** (r070) Ring › Device: the ring this phone talks to. Only where the engine is (the Android app); elsewhere back to the Ring. */
function DeviceScreen() {
  const eng = useGaugeEngine();
  if (!eng.available) return <Navigate to={ringPaths.root} replace />;
  return (
    <>
      <TopBar title={EC.device} documentTitle={`Ring · ${EC.device}`} back={{ to: ringPaths.root, label: C.title }} />
      <Page stack className="rg-page">
        <DeviceView />
      </Page>
    </>
  );
}

function MetricScreen({ kind, date }: { kind: keyof typeof METRICS; date: string }) {
  const refresh = useRefresh();
  const lastSynced = useSynced();
  const synced = refresh.words ?? lastSynced;
  return (
    <>
      <TopBar title={METRICS[kind].label} subtitle={synced} back={{ to: ringPaths.tab('overview', date), label: C.title }} menu={refresh.menu} />
      <Page stack className="rg-page">
        <Gate>
          <MetricView kind={kind} date={date} />
        </Gate>
      </Page>
    </>
  );
}

function WorkoutScreen({ id, today }: { id: string; today: string }) {
  const synced = useSynced();
  const [params] = useSearchParams();
  const d = params.get('date');
  const activity = params.get('activity');
  const { q, workout } = useWorkout(id, d && isLocalDate(d) ? d : null, today);
  return (
    <>
      <TopBar title={workout ? workoutName(workout.type) : C.workouts} subtitle={synced} back={{ to: ringPaths.tab('activity', d ?? undefined), label: C.tabs.activity }} />
      <Page stack className="rg-page">
        <Gate>
          {q.status === 'loading' ? <Loading lines={5} /> : workout ? <WorkoutView w={workout} activityId={activity} today={today} /> : <p className="rg-none">{C.workoutMissing}</p>}
        </Gate>
      </Page>
    </>
  );
}

function ShortVideoScreen({ date }: { date: string }) {
  const refresh = useRefresh();
  const lastSynced = useSynced();
  const synced = refresh.words ?? lastSynced;
  return (
    <>
      <TopBar title={C.shortVideos} subtitle={synced} back={{ to: ringPaths.tab('overview', date), label: C.title }} menu={refresh.menu} />
      <Page stack className="rg-page">
        <Gate>
          <ShortVideoView date={date} />
        </Gate>
      </Page>
    </>
  );
}

