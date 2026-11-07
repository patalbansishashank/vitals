/*
 * Screenshot harness (dev only) for the V3 wiring: Progress and Settings › Heart rate read the REAL adapters over a
 * document store seeded through the real commands (a plan, meals, a day report, Gauge sessions imported with
 * `activity.fromGauge`, some approved with `activity.approve`, one left pending). Nothing is overridden on the Progress
 * or Heart adapters; only the home server is absent here, so its minute timeline is synthesised from the same sessions
 * (labelled synthetic). Open /src/features/living/progress/__screens__/wire.html?page=progress|heart
 * Nothing here ships: no route links to it and the production build has no entry for it.
 */
import '@/styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
 
import { createDocumentStore, createMemoryBackend, mintWriteToken } from '@/store';
import { setDocumentStore, getDocumentStore } from '@/state/runtime';
import { seedClearedSafety } from '@/features/onboarding/testing';
import { useProfileStore } from '@/state/profileStore';
import { addDays, localToInstant } from '@/living/dates';
import {
  DEFAULT_ITEM_WEIGHTS,
  type LocalDate,
  type LogEntry,
  type PlanDoc,
  type PlanVersionDoc,
} from '@/living';
import type { DayTemplate } from '@/engine';
import type { GaugeTimeline } from '@/net/gauge';
import { setTimelineSource } from '@/features/living/progress/data/timelines';

const q = new URLSearchParams(location.search);
const page = q.get('page') ?? 'progress';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const PLAN_ID = '01JWXRESTDAYPRGRESSWXRE01A';
const now = new Date();
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const START = addDays(TODAY, -27);
const ms = (date: LocalDate, h: number) => Date.parse(localToInstant(date, h, TZ));

/** Sessions Gauge recorded: walks most mornings, a run twice a week; the last one is left to review. */
const SESSIONS = Array.from({ length: 27 }, (_, i) => addDays(START, i)).flatMap((date, i) => {
  const out: Array<{
    id: string;
    date: LocalDate;
    start: number;
    end: number;
    type: string;
    kcal: number;
    bpm: number;
    cadence: number | null;
  }> = [];
  if (i % 7 !== 6)
    out.push({
      id: `walk-${i}`,
      date,
      start: ms(date, 7.5),
      end: ms(date, 8 + (i % 3) * 0.25),
      type: 'walk',
      kcal: 180,
      bpm: 118 + (i % 5) * 3,
      cadence: 112,
    });
  if (i % 7 === 1 || i % 7 === 4)
    out.push({
      id: `run-${i}`,
      date,
      start: ms(date, 18),
      end: ms(date, 18.5),
      type: 'run',
      kcal: 320,
      bpm: i % 7 === 4 ? 185 + (i % 3) * 2 : 156 + (i % 4) * 2,
      cadence: 160,
    });
  return out;
});
const PENDING = SESSIONS.at(-1)!.id;

function timeline(date: LocalDate): GaugeTimeline | null {
  if (date > TODAY || date < START) return null;
  const first = ms(date, 0);
  const n = 1440;
  const selected: Array<number | null> = new Array(n).fill(null);
  const support: Array<'minute' | null> = new Array(n).fill(null);
  const bpm: Array<number | null> = new Array(n).fill(null);
  const supportedS: Array<number | null> = new Array(n).fill(null);
  const stage: GaugeTimeline['sleep']['stage'] = new Array(n).fill(null);
  const day = SESSIONS.filter((s) => s.date === date);
  const wake = ms(date, 6.75);
  const bed = ms(date, 23);
  for (let k = 0; k < n; k++) {
    const t = first + k * 60_000;
    if (t < wake || t >= bed) {
      stage[k] = 'light';
      continue;
    }
    if (t > now.getTime()) break;
    selected[k] = (k * 7919) % 13 === 0 ? 40 : (k * 104729) % 9 === 0 ? 12 : 0;
    support[k] = 'minute';
    const s = day.find((x) => t >= x.start && t < x.end);
    if (s) {
      selected[k] = s.cadence;
      bpm[k] = s.bpm;
      supportedS[k] = 60;
    }
  }
  return {
    source: 'lumen_health',
    timeZone: TZ,
    installations: [],
    freshness: {
      lastUploadAt: null,
      lastReadingAt: null,
      minutesSinceLastUpload: null,
      minutesSinceLastReading: null,
    },
    date,
    tz: TZ,
    start: new Date(first).toISOString(),
    minutes: n,
    steps: {
      selected,
      source: new Array(n).fill('ring'),
      ring: selected,
      phone: new Array(n).fill(null),
      support,
    },
    hr: { bpm, supportedS },
    sleep: { stage },
    sessions: [],
    hcExercise: [],
    acquisition: { ring: [], phone: [] },
  } as unknown as GaugeTimeline;
}

const REST: DayTemplate = {
  id: 'R',
  label: 'everyday',
  energy: { kind: 'kcal', kcal: 2200 },
  macros: {
    protein: { unit: 'g', value: 150 },
    carbs: { unit: 'g', value: 220 },
    fat: { unit: 'remainder' },
  },
  steps: 9000,
  sleep: { bedH: 23, wakeH: 6.75 },
};

const meal = (id: string, date: LocalDate, clockH: number, kcal: number | null): LogEntry & { _id: string } =>
  ({
    _id: id,
    id,
    date,
    tz: TZ,
    at: localToInstant(date, clockH, TZ),
    source: { by: 'user', method: 'typed' },
    kind: 'meal',
    clockH,
    components: [],
    totals: {
      energyKcal: { value: kcal ?? 0, sd: 0 },
      proteinG: { value: 40, sd: 0 },
      carbG: { value: 70, sd: 0 },
      fatG: { value: 25, sd: 0 },
      ...(kcal === null ? { unknown: ['energyKcal'] } : {}),
    },
  }) as unknown as LogEntry & { _id: string };

const ULID = (n: number) => `01JWXMEA${String(n).padStart(18, '0')}`;

async function seed(): Promise<void> {
  setDocumentStore(
    createDocumentStore({
      backend: createMemoryBackend({ device: 'WIREDEVICE000001' }),
      device: 'WIREDEVICE000001',
    }),
  );
  seedClearedSafety();
  const p = useProfileStore.getState();
  p.setSex('male');
  p.setAge(38);
  p.setHeight(178);
  p.setWeight(84);
  const store = getDocumentStore();
  await store.ready;
  const profile = {
    schemaVersion: 1 as const,
    body: { sex: 'male' as const, ageYears: 38, heightCm: 178, weightKg: 84 },
    startDate: START,
  };
  const plan: PlanDoc = {
    name: 'Steady',
    rung: 'medium',
    origin: { kind: 'planner', requestHash: 'h', runAt: `${START}T06:00:00.000Z` },
    status: 'active',
    startDate: START,
    plannedEndDate: addDays(START, 84),
    request: { profile, goals: [], horizonDays: 84 },
    baselineProfile: profile,
    headVersion: 1,
    pauses: [],
    intentions: {},
    policy: { checkInWeekday: 0, autoApplyLoadLowering: true },
    createdAt: `${START}T06:00:00.000Z`,
  };
  const version = {
    planId: PLAN_ID,
    version: 1,
    parent: null,
    status: 'adopted',
    reason: 'start',
    effectiveFromDay: 0,
    schedule: {
      schemaVersion: 1,
      startDate: START,
      horizonDays: 84,
      programs: [REST],
      days: Array.from({ length: 84 }, () => ({ program: 0 })),
    },
    genome: null,
    sessions: {},
    sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] },
    explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' },
    createdBy: { kind: 'system' },
    createdAt: `${START}T06:00:00.000Z`,
  } as unknown as PlanVersionDoc;
   
  await store.transact(mintWriteToken('migration', { label: 'wire harness seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: START });
    // meals on most days, reported complete; every fourth day one meal has no energy (unresolved: no intake that day)
    let n = 0;
    for (let i = 0; i < 27; i++) {
      const date = addDays(START, i);
      if (i % 5 === 3) continue;
      await tx.append('dailyLogs', meal(ULID(++n), date, 8, 520 + (i % 4) * 40));
      await tx.append('dailyLogs', meal(ULID(++n), date, 13, i % 4 === 2 ? null : 760));
      await tx.append('dailyLogs', meal(ULID(++n), date, 19.5, 820 - (i % 3) * 60));
      await tx.put('dayStatus', { _id: `day:${date}`, date, intake: 'complete' });
    }
  });
  const { dispatch, settleCommits } = await import('@/commands');
  const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };
  await dispatch(
    'activity.fromGauge',
    {
      gaugeSessions: SESSIONS.map((s) => ({
        id: s.id,
        revision: 'r1',
        start: s.start,
        end: s.end,
        type: s.type,
        kcal: s.kcal,
      })),
      hcSessions: [],
    },
    SYS,
  );
  await settleCommits();
  const r = await dispatch('activity.candidates', { from: START, to: TODAY });
  const rows =
    r.ok && 'output' in r
      ? (r.output as { rows: Array<{ id: string; revision: string; startAt: string }> }).rows
      : [];
  const pending = SESSIONS.find((s) => s.id === PENDING)!;
  for (const row of rows)
    if (Date.parse(row.startAt) !== pending.start)
      await dispatch('activity.approve', { id: row.id, revision: row.revision });
  await settleCommits();
}

async function main(): Promise<void> {
  await seed();
  setTimelineSource(async (d) => timeline(d));
  const { installDocumentPlanSource } = await import('@/features/living/mode');
  installDocumentPlanSource();
  const [{ AppShell }, { default: ProgressPage }, { default: SettingsPage }] = await Promise.all([
    import('@/app/shell'),
    import('@/features/living/progress/ProgressPage'),
    import('@/features/settings/SettingsPage'),
  ]);

  const router = createMemoryRouter(
    [
      {
        element: <AppShell />,
        children: [
          { path: '/progress', element: <ProgressPage /> },
          { path: '/settings/:section', element: <SettingsPage /> },
        ],
      },
    ],
    { initialEntries: [page === 'heart' ? '/settings/heart' : '/progress'] },
  );

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

void main();
