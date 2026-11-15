/**
 * Ring (`/ring…`): what the ring measures of the body at rest, read from the person's server. Three tabs in the bar
 * (Overview · Sleep · Scores) and three pushed pages (a signal over time, a workout, the short-video brain and its
 * limit). Steps and activities are a topic of their own: Activity › Movement (`/activity`), which the Overview's
 * Activity card opens. The ring's connection and battery sit in the bar's status slot. The day is in the
 * address (`?date=`) so a card on Today opens the same day here. (r069 U2) Under the tabs, the shared date control:
 * Overview is one day; Sleep and Scores also show a week, a month, a year or a custom range
 * (`?period=…`, `src/features/living/period.ts`), which the address keeps across the tabs. Without a server or without Gauge data, one empty
 * state says what to do. Works with or without a plan (outside the Living guard).
 */
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { LinkBank, Page } from '@/components';
import { TopBar } from '@/app/shell';
import { useToday } from '@/features/living/clock';
import { DateControl } from '@/features/living/components/DateControl';
import { ALL_PERIODS, DAY_ONLY, coercePeriod, periodFromSearch, periodSearch, type Period, type PeriodKind } from '@/features/living/period';
import { isLocalDate } from '@/living/dates';
import type { LocalDate } from '@/living';
import { TodayEnergyFeed, useRingRefresh, useRingSynced } from './bar';
import { RING_COPY as C } from './copy';
import { METRICS, calendarDate, isRingMetric, workoutName } from './model';
import { ringPaths, type RingTab } from './paths';
import { useNow } from './useGauge';
import { useGaugeEngine } from '@/state/gaugeEngine';
import { DeviceView, MoveFromGauge } from './engine';
import { ENGINE_COPY as EC } from './engine/copy';
import { useQuietMode } from '@/state/settingsStore';
import { Loading, RingGate } from './components/parts';
import { SleepSections } from '@/features/living/sleep/sections';
import { SleepPeriodView } from '@/features/living/sleep/SleepPeriod';
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
  { id: 'scores', label: C.tabs.scores },
];

/** (r069 U2) The periods each tab can show: the Overview is one day by nature. */
export const RING_PERIODS: Record<RingTab, readonly PeriodKind[]> = { overview: DAY_ONLY, sleep: ALL_PERIODS, scores: ALL_PERIODS };

/** The period in the address (never after today); a pushed page reads the day it ends on. */
function useRingPeriod(today: string): Period {
  const [params] = useSearchParams();
  return periodFromSearch(params, today as LocalDate, ALL_PERIODS, today as LocalDate);
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
  const tab: RingTab = pathname === '/ring/sleep' ? 'sleep' : pathname === '/ring/scores' ? 'scores' : 'overview';
  return <RingTabs tab={tab} period={period} today={today} />;
}

function RingTabs({ tab, period: asked, today }: { tab: RingTab; period: Period; today: string }) {
  const navigate = useNavigate();
  const refresh = useRingRefresh();
  const lastSynced = useRingSynced();
  const synced = refresh.words ?? lastSynced;
  const quiet = useQuietMode().on;
  // the engine's energy is for the app's day (it rolls over at the person's hour); the period and date control stay on calendar days
  const appToday = useToday();
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
        {quiet ? null : <TodayEnergyFeed today={appToday} />}
        {tab === 'overview' ? <MoveFromGauge /> : null}
        <Gate>
          <DateControl value={period} onChange={select} today={today as LocalDate} max={today as LocalDate} periods={RING_PERIODS[tab]} useMarks={useRingDays} />
          {tab === 'overview' ? <OverviewView date={period.from} /> : null}
          {tab === 'sleep' ? date ? <SleepSections date={date} today={today} /> : <SleepPeriodView period={period} today={today} /> : null}
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
  const refresh = useRingRefresh();
  const lastSynced = useRingSynced();
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
  const synced = useRingSynced();
  const [params] = useSearchParams();
  const d = params.get('date');
  const activity = params.get('activity');
  const { q, workout } = useWorkout(id, d && isLocalDate(d) ? d : null, today);
  return (
    <>
      <TopBar title={workout ? workoutName(workout.type) : C.workouts} subtitle={synced} back={{ to: ringPaths.movement(d ?? undefined), label: C.activityHub.title }} />
      <Page stack className="rg-page">
        <Gate>
          {q.status === 'loading' ? <Loading lines={5} /> : workout ? <WorkoutView w={workout} activityId={activity} today={today} /> : <p className="rg-none">{C.workoutMissing}</p>}
        </Gate>
      </Page>
    </>
  );
}

function ShortVideoScreen({ date }: { date: string }) {
  const refresh = useRingRefresh();
  const lastSynced = useRingSynced();
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

