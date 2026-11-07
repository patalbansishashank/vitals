/*
 * V4c screenshot harness (dev only, never in the app's routes): the real Today page inside the real app shell, on the
 * in-memory Living stand-in with the fixture plan ("Spring cut", day 15, a walking Tuesday), a few logged meals, and the
 * harness's activity data (./fixtures.ts: the real V2/V3 functions on a synthetic day) and an in-memory Gauge.
 *   /src/features/living/today/__screens__/screens.html?scene=pending&time=13:20
 * `&plan=none`: Planning mode (no plan; 0.6.3 Today without a plan — the energy model then has nothing to run on).
 * Driven by ./render.mjs and ./render-home.mjs (which fix the page clock, so the ring demo and the day agree).
 */
import '@/styles/index.css';
import { StrictMode, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppShell } from '@/app/shell/AppShell';
import { LivingClockContext, fixedClock, localDateOf } from '../../clock';
import { LivingActionsProvider } from '../../data/actions';
import { LivingDataProvider } from '../../data/source';
import { createStubLiving, fixedPlanControl } from '../../data/stub';
import { fixturePlan } from '../../data/fixtures';
import { resetActivePlan, useActivePlanStore } from '../../activePlan';
import { ActivityDataProvider } from '../../activity/data';
import TodayPage from '../TodayPage';
import FoodPage from '../../food/FoodPage';
import TrainPage from '../../train/TrainPage';
import EnergyPage from '../../energy/EnergyPage';
import { ActivityHub } from '../../train/components/ActivityHub';
import { useSettingsStore } from '@/state/settingsStore';
import { withSystemWrite } from '@/state/scope';
import { addDays, daysBetween } from '@/living/dates';
import { commandsFixture, dayFixture, fixtureActivityData, type Scene } from './fixtures';
import { DailyCardSamples } from './samples';
import { CheckInSheet } from '../components/CheckInSheet';
import { weeklyModelFixture } from './weeklyModel.fixture';
import { LimitsPanel } from '@/features/planner/components/LimitsPanel';
import { defaultConstraints } from '@/features/planner/request';
import { GoalRankList } from '@/features/planner/components/GoalRankList';
import type { GoalDraft } from '@/state/plannerStore';
import '@/features/planner/planner.css';

const q = new URLSearchParams(location.search);
const scene = (q.get('scene') ?? 'pending') as Scene;
const quiet = q.get('quiet') === '1';
const time = q.get('time') ?? '13:20';
const noPlan = q.get('plan') === 'none';
const noSleep = q.get('sleep') === 'none';
const noVideos = q.get('videos') === 'none';

const today = localDateOf(new Date());
const clock = fixedClock(`${today}T${time}:00`);
const plan = noPlan ? null : fixturePlan(today);
const stub = createStubLiving({ clock, plan: fixedPlanControl(plan) });
// A single synthetic weigh-in for the planless layout shown in the owner's image; no real profile is read or written.
const baseSource: typeof stub.source = noPlan && q.get('weight') === 'sample' ? {
  ...stub.source,
  trend: (from, to) => {
    const days = daysBetween(from, to) + 1;
    return { startDate: from, days, todayIndex: days - 1, unit: 'kg', decimals: 1,
      weighIns: [{ day: days - 1, value: 77 }],
      trend: Array.from({ length: days }, (_, i) => i === days - 1 ? 77 : NaN),
      trendSd: Array.from({ length: days }, () => 0) };
  },
} : stub.source;
// Optional-card QA: a synthetic running fast, isolated from the shipped data source.
const fastSource: typeof stub.source = q.get('fast') === 'sample' ? {
  ...baseSource,
  today: (date) => {
    const view = baseSource.today(date);
    return view?.prescription ? {
      ...view,
      prescription: { ...view.prescription, fast: {
        lastIntakeAt: new Date(`${addDays(date, -1)}T20:00:00`).toISOString(),
        firstIntakeAt: new Date(`${date}T12:00:00`).toISOString(),
        hours: 16,
      } },
      logged: { ...view.logged, fast: { state: 'running', sinceH: 14, remainingH: 2 } },
    } : view;
  },
} : baseSource;
const source: typeof stub.source = q.has('weekly') ? {
  ...fastSource,
  checkIn: (asOf) => {
    const report = fastSource.checkIn(asOf);
    const target = fastSource.today(asOf)?.prescription?.energyKcal ?? 2050;
    return report ? { ...report, weeklyModel: { ...weeklyModelFixture(asOf, q.get('weekly') ?? ''), targetKcal: target, targetRangeKcal: [target, target], deficitKcal: 2630 - target } } : null;
  },
} : fastSource;
resetActivePlan();
if (plan) useActivePlanStore.getState().setPlan(plan);

const f = dayFixture(today, clock.now().getTime(), scene);
const commands = commandsFixture(f);
const baseData = fixtureActivityData(f, { quiet, commands });
// A nonzero week for inspecting sparse seven-bar charts at the actual full card width, never an app data source.
const fixtureData: typeof baseData = q.get('week') === 'sample' ? {
  ...baseData,
  useReview: (from, to) => {
    const review = baseData.useReview(from, to);
    const sample = review.decided[0] ?? review.rows[0];
    if (!sample) return review;
    const decided = [38, 48, 67, 17, 69, 72, 2].map((minutes, index) => {
      const date = addDays(today, index - 6);
      const start = new Date(`${date}T07:00:00`).getTime();
      return { ...sample, id: `week-${index}`, date, status: 'approved' as const, minutes,
        startAt: new Date(start).toISOString(), endAt: new Date(start + minutes * 60_000).toISOString() };
    }).filter((row) => row.date >= from && row.date <= to);
    return { ...review, rows: [], strip: null, decided };
  },
} : baseData;
// without a plan the model is the habitual day's (0.6.3): no plan figure; `&body=none` = no body basics (no run)
const noBody = q.get('body') === 'none';
const data: typeof fixtureData = noPlan
  ? {
      ...fixtureData,
      useToday: (date, isToday) => {
        const v = fixtureData.useToday(date, isToday);
        if (!v) return null;
        const energy = noBody || !v.model.energy ? null : { ...v.model.energy, plan: null, planActive: null };
        return {
          ...v,
          plan: null,
          model: { ...v.model, energy, planless: true, energyMissing: noBody ? 'profile' : null },
        };
      },
    }
  : fixtureData;

// what the person logged by now (synthetic): lunch from 12:30, the snack later, last night's sleep from the ring
async function seed() {
  const chosenCards = q.get('cards');
  if (chosenCards) {
    // Dev-only fixture choice, applied before the page mounts so layout tests reproduce the saved owner order.
    // eslint-disable-next-line no-restricted-syntax
    withSystemWrite(() => useSettingsStore.setState({ todayCards: chosenCards.split(',') }));
  }
  if (noSleep || noVideos) {
    const [{ setGaugeApi }, { makeGaugeFixture }] = await Promise.all([
      import('@/features/ring/api'),
      import('@/features/ring/fixtures'),
    ]);
    const api = makeGaugeFixture({ now: clock.now().getTime() });
    setGaugeApi({
      ...api,
      daily: async (date) => {
        const day = await api.daily(date);
        return day && noSleep ? { ...day, sleep: [] } : day;
      },
      sleep: async (from, to) => {
        const nights = await api.sleep(from, to);
        return nights && noSleep ? { ...nights, sessions: [] } : nights;
      },
      shortVideo: async (from, to) => {
        const video = await api.shortVideo(from, to);
        return video && noVideos ? { ...video, days: [] } : video;
      },
    });
  }
  // quiet mode lives in the settings too (the ring's cards and the shared components read it there)
  // (dev harness only: there is no command bus here, so the system write stands in for `settings.update`)
  // eslint-disable-next-line no-restricted-syntax
  if (quiet) withSystemWrite(() => useSettingsStore.setState({ quietMode: true, quietModeSet: true }));
  // no plan: nothing to log against (the ring and the activity review carry the day)
  if (noPlan) return;
  const h = clock.now().getHours() + clock.now().getMinutes() / 60;
  if (h >= 12.75)
    await stub.actions.logMeal(today, {
      slot: 'lunch',
      clockH: 12.6,
      components: [
        { name: 'Rajma chawal', energyKcal: 640, proteinG: 26, carbG: 96, fatG: 14 },
        { name: 'Cucumber raita', energyKcal: 110, proteinG: 6, carbG: 8, fatG: 5 },
      ],
    });
  if (h >= 17)
    await stub.actions.logMeal(today, {
      slot: 'snack',
      clockH: 16.6,
      asPlanned: true,
      components: [{ name: 'Roasted chana and curd', energyKcal: 390, proteinG: 28, carbG: 36, fatG: 12 }],
    });
  if (h >= 20)
    await stub.actions.logMeal(today, {
      slot: 'dinner',
      clockH: 19.6,
      components: [
        { name: 'Paneer bhurji with two rotis', energyKcal: 940, proteinG: 52, carbG: 74, fatG: 44 },
      ],
    });
  if (scene !== 'nodevice' && scene !== 'manual') await stub.actions.logSleep(today, 6.9);
  // the over-plan evening: the morning's weigh-in and the planned walk are answered
  if (scene === 'overplan') {
    await stub.actions.logWeight(today, 84.9);
    await stub.actions.markRow(today, 'session:14:0', 'asPlanned');
  }
  if (quiet) await stub.actions.setQuietMode(true);
}

const wrap = (el: ReactElement) => (
  <LivingClockContext.Provider value={clock}>
    <LivingDataProvider value={source}>
      <LivingActionsProvider value={stub.actions}>
        <ActivityDataProvider value={data}>{el}</ActivityDataProvider>
      </LivingActionsProvider>
    </LivingDataProvider>
  </LivingClockContext.Provider>
);

function LimitSample() {
  const [c, setC] = useState({ ...defaultConstraints({}), maxMuscleLossPct: 5 as number | null, maxCardioSessionMin: 15 as number | null });
  return <main className="lm-page" style={{ maxWidth: 760, margin: '0 auto' }}><LimitsPanel c={c} customised={false} safetyMaxFastH={24} onChange={(patch) => setC((old) => ({ ...old, ...patch }))} /></main>;
}

function GoalSample() {
  const [goals, setGoals] = useState<GoalDraft[]>([{ key: 'fat-maximum', metric: 'fatMass', mode: 'lower', amount: null, strength: 'must', functional: 'end' }]);
  return <main className="lm-page" style={{ maxWidth: 760, margin: '0 auto' }}><h1 className="lm-h1">Goals</h1><GoalRankList goals={goals} onMove={() => undefined} onRemove={(key) => setGoals((old) => old.filter((g) => g.key !== key))} onUpdate={(key, patch) => setGoals((old) => old.map((g) => g.key === key ? { ...g, ...patch } : g))} /></main>;
}

const router = createMemoryRouter(
  [
    {
      path: '/',
      element: wrap(<AppShell />),
      children: [
        { path: 'today', element: <TodayPage /> },
        { path: 'today/:date', element: <TodayPage /> },
        { path: 'weekly', element: <><TodayPage /><CheckInSheet open onClose={() => undefined} today={today} quiet={quiet} /></> },
        { path: 'limits', element: <LimitSample /> },
        { path: 'goals', element: <GoalSample /> },
        // `&view=food` / `&view=train`: the other Living pages on the same stand-in (r068 design-foundation shots)
        { path: 'food', element: <FoodPage /> },
        { path: 'train', element: <TrainPage /> },
        // `&view=energy` (or `energy/<date>`): the day Energy page (r069 D4) on the harness's day
        { path: 'energy', element: <EnergyPage /> },
        { path: 'energy/:date', element: <EnergyPage /> },
        { path: 'samples', element: <DailyCardSamples date={today} nowMs={clock.now().getTime()} plan={plan} quiet={quiet} empty={q.get('empty') === '1'} long={q.get('long') === '1'} /> },
        // `&view=hub`: Train's activity hub on its own (0.6.4 key alignment)
        {
          path: 'hub',
          element: (
            <main className="lm-page" style={{ maxWidth: q.get('wide') === '1' ? undefined : 720, padding: 16 }}>
              <ActivityHub date={today} today={today} quiet={quiet} onLog={() => undefined} />
            </main>
          ),
        },
        { path: '*', element: <TodayPage /> },
      ],
    },
  ],
  { initialEntries: [`/${q.get('view') ?? 'today'}`] },
);

void seed().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  ),
);
