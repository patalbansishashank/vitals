/**
 * Wiring of the living plan (docs/LIVING_PLAN.md §9, E4 part) around E5's executors (`./living`):
 *
 * - **Ports** (`ctx.ports.living`): the re-planning `PlannerPort` (the planner worker's receding-horizon
 *   `replan`), the session compiler (E8 `resolveSession` + `toEngineDose` over the seed catalogue) and the
 *   biometric observation adapter (E10's BioStore documents, `./bio/observations.ts`).
 * - **Rollover**: every plan day up to the current day (local date at `dayRolloverH`, default 04:00) gets its
 *   prescription frozen into `dayStatus.prescribed` (`freezePrescription` with the version in force that day; paused
 *   days get the habitual day), so re-plans never rewrite what a past day asked for. Runs at boot, when the day changes
 *   and after plan lifecycle commands.
 * - **Daily assimilation**: after log commands (debounced 1 s) the replay + trend filter runs (`projectLiving`, which
 *   calls `dailyAssimilation`) from the latest confirmed snapshot, cached by the record's `inputsHash`; the trend is kept
 *   in `derived/trend:<planId>` for quick reads.
 *
 * Writers here are derive jobs (results the documents imply), never user edits.
 */
import type * as Catalogues from '@/catalogues';
import type * as CatalogueContent from '@/content/catalogues';
import type { PersonProfile } from '@/engine';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { SIGNAL_BY_NAME } from '@/engine/types/signals';
import {
  addDays,
  compareDates,
  confirmedStateFromRecord,
  freezePrescription,
  headAdopted,
  isLive,
  pausedDaySet,
  planDay,
  projectLiving,
  realisedSchedule,
  versionInForce,
  type ConfirmedStateRecord,
  type DayStatusDoc,
  type LivingDocs,
  type LogEntry,
  type MeasurementEntry,
  type ObservationAdapter,
  type PlanDoc,
  type PlannerPort as LivingPlannerPort,
  type PlanVersionDoc,
  type SessionCompiler,
} from '@/living';
import { appDay, DEFAULT_ROLLOVER_H, rolloverOf } from '@/living/appDay';
import { bodyOf, type Doc } from '@/store';
import { settingsValues } from '@/state/internal/settings';
import { getDocumentStore, writeOps } from '@/state/runtime';
import { simulatorProfileNow } from '@/state/internal/simulatorProfile';
import type { DocOpRecord } from '@/state/scope';
import { installPorts, on, timeZone } from './bus';
import { createBioObservationAdapter } from './bio/observations';

export interface LivingPorts {
  planner: LivingPlannerPort;
  sessionCompiler: SessionCompiler;
  observations: ObservationAdapter;
}

declare module './types' {
  interface CommandPorts {
    /** Living-plan ports (planner re-plan, session compiler, biometric observations). */
    living?: LivingPorts;
  }
}

/* ---------------------------------------------------------------- ports */

/** VO2max for the stimulus context: measured (labs), else the engine bus's safe initial value. */
function stimulusContextOf(profile: PersonProfile) {
  const rp = resolveProfile(profile);
  return {
    bodyMassKg: profile.body.weightKg,
    heightM: profile.body.heightCm / 100,
    vo2max: profile.labs?.vo2maxMlKgMin ?? SIGNAL_BY_NAME.get('vo2maxMlKgMin')!.init,
    rmrKcalPerDay: rp.rmr0Kcal,
  };
}

type CatalogueModules = [typeof Catalogues, typeof CatalogueContent];
let catalogue: CatalogueModules | null = null;
let loading: Promise<void> | null = null;

/** E8's resolver; returns null (the projection then derives sessions from the stimulus) until the catalogue is loaded. */
export const sessionCompiler: SessionCompiler = (performed, startH) => {
  if (!catalogue) {
    loading ??= Promise.all([import('@/catalogues'), import('@/content/catalogues')]).then((m) => {
      catalogue = m;
    });
    return null;
  }
  const [cat, content] = catalogue;
  const resolved = cat.resolveSession(performed, content.SEED_CATALOGUE, stimulusContextOf(simulatorProfileNow()));
  if (resolved.doses.length === 0) return null;
  const dose = cat.toEngineDose(resolved.doses, startH);
  return [...(dose.resistance ? [dose.resistance] : []), ...dose.cardio];
};

/** Load the catalogue now (tests, boot after first paint). */
export function loadSessionCatalogue(): Promise<void> {
  sessionCompiler([], 0);
  return loading ?? Promise.resolve();
}

/** The planner worker's receding-horizon `replan` (PLANNER_V2 §7). */
const plannerPort: LivingPlannerPort = { replan: async (req, options) => (await import('@/workers/plannerClient')).replan(req, options) };

/** E10's measurements from the biometrics documents (policy-gated, one source per metric per day). */
export const observationAdapter: ObservationAdapter = createBioObservationAdapter();

export function installLivingPorts(over: Partial<LivingPorts> = {}): LivingPorts {
  const living: LivingPorts = { planner: plannerPort, sessionCompiler, observations: observationAdapter, ...over };
  installPorts({ living });
  return living;
}
installLivingPorts();

/* ---------------------------------------------------------------- documents */

type WithId<T> = T & { id: string };
const withId = <T>(d: Doc<unknown>): WithId<T> => ({ ...bodyOf<T>(d), id: d._id });

export function readLivingDocs(observations: ObservationAdapter = observationAdapter, range?: { from: string; to: string }): LivingDocs {
  const store = getDocumentStore();
  const active = store.peek<{ planId: string | null }>('activePlan', 'me');
  const plans = store.peekAll<PlanDoc>('plans').map((d) => withId<PlanDoc>(d));
  const plan = (active?.planId ? plans.find((p) => p.id === active.planId) : undefined) ?? plans.filter(isLive).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  return {
    plan,
    versions: plan ? store.peekAll<PlanVersionDoc>('planVersions').map((d) => bodyOf<PlanVersionDoc>(d)).filter((v) => v.planId === plan.id) : [],
    dayStatus: store.peekAll<DayStatusDoc>('dayStatus').map((d) => bodyOf<DayStatusDoc>(d)),
    entries: store.peekAll<LogEntry>('dailyLogs').map((d) => withId<LogEntry>(d)),
    measurements: store.peekAll<MeasurementEntry>('measurements').map((d) => withId<MeasurementEntry>(d)),
    records: plan ? store.peekAll<ConfirmedStateRecord>('anchors').map((d) => bodyOf<ConfirmedStateRecord>(d)).filter((r) => r.planId === plan.id) : [],
    ...(plan && range ? { observations: observations.observations(range.from, range.to) } : {}),
    // quiet mode reaches the living screens' projection as it reaches today.get (Q4-17)
    settings: { quietMode: settingsValues().quietMode },
  };
}

export { DEFAULT_ROLLOVER_H };

/** The current plan day's date: the day rolls over at `rolloverH` local time (SUITE_SPEC §3.4; `settings.dayRolloverH`). */
export function currentDay(now: number = Date.now(), tz = timeZone(), rolloverH = rolloverOf(settingsValues())): string {
  return appDay(now, { tz, rolloverH });
}

/* ---------------------------------------------------------------- rollover */

/** Freeze the prescription of every unfrozen plan day up to the current day. Returns the dates frozen. */
export async function runRollover(now: number = Date.now()): Promise<string[]> {
  const store = getDocumentStore();
  await store.ready;
  const docs = readLivingDocs();
  const plan = docs.plan;
  const head = plan ? headAdopted(docs.versions) : null;
  if (!plan || !head || !isLive(plan)) return [];
  const tz = timeZone();
  const today = currentDay(now, tz);
  const last = compareDates(today, addDays(plan.plannedEndDate, -1)) < 0 ? today : addDays(plan.plannedEndDate, -1);
  if (compareDates(last, plan.startDate) < 0) return [];
  const status = new Map(docs.dayStatus.map((s) => [s.date, s] as const));
  const paused = pausedDaySet(plan, addDays(today, 1));
  const ops: DocOpRecord[] = [];
  const frozen: string[] = [];
  for (let date = plan.startDate; compareDates(date, last) <= 0; date = addDays(date, 1)) {
    const prev = status.get(date);
    if (prev?.prescribed && prev.prescribed.planId === plan.id) continue;
    const d = planDay(plan, date);
    const version = versionInForce(docs.versions, d) ?? head;
    const prescribed = freezePrescription({ plan, version, date, tz, ...(paused.has(d) ? { paused: true } : {}) });
    const after = { ...(prev ?? {}), date, planId: plan.id, planDay: d, prescribed } as unknown as Record<string, unknown>;
    ops.push({ col: 'dayStatus', id: `day:${date}`, before: (prev as unknown as Record<string, unknown>) ?? null, after });
    frozen.push(date);
  }
  await writeOps('derive', ops, 'rollover');
  return frozen;
}

/* ---------------------------------------------------------------- daily assimilation */

const snapshotCache = new Map<string, { anchorDay: number; inputsHash: string; snapshot: unknown }>();

/** Replay + trend filter from the latest confirmed snapshot; keeps the trend in `derived/trend:<planId>`. */
export async function runAssimilation(now: number = Date.now()): Promise<{ usedCache: boolean; trendKg: number | null } | null> {
  const store = getDocumentStore();
  await store.ready;
  const tz = timeZone();
  const today = currentDay(now, tz);
  const docs = readLivingDocs(observationAdapter, { from: addDays(today, -60), to: today });
  const plan = docs.plan;
  const head = plan ? headAdopted(docs.versions) : null;
  if (!plan || !head || !isLive(plan) || compareDates(today, plan.startDate) < 0) return null;
  const nowIso = new Date(now).toISOString();
  const latest = [...docs.records].sort((a, b) => a.anchorDay - b.anchorDay).pop() ?? null;
  let cached = latest ? (snapshotCache.get(latest.inputsHash) ?? null) : null;
  if (latest && !cached) {
    // rebuild the confirmed snapshot of the latest record once per inputs hash (an edited past day invalidates it)
    const past = projectLiving({ docs, today, tz, now: nowIso, sessionCompiler, skipAssimilation: true }).days.filter((x) => compareDates(x.date, today) < 0);
    const state = confirmedStateFromRecord(plan, realisedSchedule(plan, head, past.map((x) => x.result), today), docs.records, latest);
    cached = { anchorDay: latest.anchorDay, inputsHash: latest.inputsHash, snapshot: state.snapshot };
    snapshotCache.clear();
    snapshotCache.set(latest.inputsHash, cached);
  }
  const p = projectLiving({ docs, today, tz, now: nowIso, sessionCompiler, ...(cached ? { cached: cached as never } : {}) });
  const t = p.assimilation?.trendToday ?? null;
  await writeOps('derive', [{ col: 'derived', id: `trend:${plan.id}`, before: null, after: { kind: 'trend', planId: plan.id, asOf: today, at: nowIso, trendToday: t, usedCache: p.assimilation?.usedCache ?? false } }], 'assimilation');
  return { usedCache: p.assimilation?.usedCache ?? false, trendKg: t?.kg ?? null };
}

/* ---------------------------------------------------------------- automation */

let automation: { off: () => void; timer: ReturnType<typeof setInterval> } | null = null;
let assimTimer: ReturnType<typeof setTimeout> | null = null;
let lastDay = '';

const report = (e: unknown) => console.error('Vitals: living-plan upkeep failed', e);

/** Hooks the bus: rollover on plan lifecycle commands and day changes, assimilation after logs (debounced 1 s). */
export function startLivingAutomation(): () => void {
  if (automation) return automation.off;
  const off = on((e) => {
    if (e.type !== 'committed') return;
    if (e.commandId.startsWith('plan.')) void runRollover().catch(report);
    // measurements by hand or a changed stream policy change what the plan observed
    if (e.commandId.startsWith('log.') || e.commandId === 'plan.checkIn' || e.commandId === 'bio.manual' || e.commandId === 'bio.setPolicy' || e.commandId.startsWith('biometrics.') || e.commandId === 'bio.deleteSource') {
      if (assimTimer) clearTimeout(assimTimer);
      assimTimer = setTimeout(() => void runAssimilation().catch(report), 1000);
    }
  });
  const timer = setInterval(() => {
    const day = currentDay();
    if (day !== lastDay) {
      lastDay = day;
      void runRollover().catch(report);
    }
  }, 60_000);
  lastDay = currentDay();
  void runRollover().catch(report);
  automation = {
    timer,
    off: () => {
      off();
      clearInterval(timer);
      if (assimTimer) clearTimeout(assimTimer);
      automation = null;
    },
  };
  return automation.off;
}
