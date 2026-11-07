/**
 * The state hooks V4 reads for the activity review and Today (energy SPEC §V3, §V4.1-4.2):
 *
 *  - `useActivityReview(from, to)` / `reviewSheetNow`: the review strip and sheet model over the stored candidates
 *    ("N activities to review · M min · ~K kcal", rows with their revision, Approve all's exact items). The screens send
 *    `activity.approveAll` with `model.approveAll`, `activity.approve` / `activity.edit` / `activity.reject` per row.
 *  - `useTodayEnergySteps()` / `loadTodayEnergySteps`: today's steps (fused so far, the named plan-share prior for the rest
 *    of the awake day, the likely total and its goal) and energy (so far · likely by bedtime · plan, all "estimated", from
 *    the engine's realised today run — the single authority), plus the provisional pending bouts when D8's overlay is on.
 *
 * Reads only: every change goes through the command bus.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { bodyOf } from '@/store';
import {
  provisionalBouts,
  reviewSheetModel,
  type CandidateRecord,
  type ReviewSheetModel,
} from '@/living/activityCandidates';
import { todayEnergyStepsModel, type TodayEnergyStepsModel } from '@/living/todayModel';
import {
  energyDay,
  hoursFromRun,
  type EnergyBout,
  type EnergyHour,
  type EnergyComponent,
} from '@/living/sensors/energyDay';
import { getDocumentStore } from './runtime';
import type { DayTemplate, PersonProfile } from '@/engine';
import { resolveProfile, rmrRouteOf } from '@/engine/core/resolveProfile';
import type { Envelope } from '@/living/sensors/types';
import type { LogEntry, PrescribedDaySnapshot } from '@/living/types';
import type { readDocs as ReadDocs } from '@/commands/living';
import type { LiveStepsSnapshot } from '@/living/gaugeImport';
import { settingsValues } from './internal/settings';
import { useSettingsStore } from './settingsStore';

const EMPTY: CandidateRecord[] = [];
let cache: { stamp: number; records: CandidateRecord[] } | null = null;
let stamp = 0;

function candidatesNow(): CandidateRecord[] {
  try {
    const store = getDocumentStore();
    if (cache && cache.stamp === stamp) return cache.records;
    const records = store
      .peekAll<CandidateRecord>('activityCandidates')
      .map((d) => bodyOf<CandidateRecord>(d));
    cache = { stamp, records };
    return records;
  } catch {
    return EMPTY;
  }
}

function subscribeCandidates(listener: () => void): () => void {
  let off: (() => void) | null = null;
  try {
    off = getDocumentStore().watch('activityCandidates', {}, () => {
      stamp++;
      listener();
    });
  } catch {
    off = null;
  }
  return () => off?.();
}

/** The review model now (no React). */
export function reviewSheetNow(o: { from?: string; to?: string } = {}): ReviewSheetModel {
  const s = settingsValues();
  return reviewSheetModel(candidatesNow(), {
    ...o,
    quiet: s.quietMode,
    provisionalOverlay: s.provisionalOverlay !== false,
  });
}

/** The review strip and sheet over [from, to] (both optional); re-renders on every candidate or settings change. */
export function useActivityReview(from?: string, to?: string): ReviewSheetModel {
  const records = useSyncExternalStore(subscribeCandidates, candidatesNow, candidatesNow);
  const quiet = useSettingsStore((s) => s.quietMode);
  const overlay = useSettingsStore((s) => s.provisionalOverlay);
  void quiet;
  void overlay;
  const s = settingsValues();
  return reviewSheetModel(records, {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    quiet: s.quietMode,
    provisionalOverlay: s.provisionalOverlay !== false,
  });
}

// ------------------------------------------------------------------------------------------- today's energy and steps
export interface TodayEnergyDeps {
  /** Runs the engine over a schedule and returns today's hours (null = no run available here). */
  runHours?: (
    kind: 'realised' | 'plan',
    profile: unknown,
    schedule: unknown,
    todayIdx: number,
    dayStartMs: number,
  ) => Promise<EnergyHour[] | null>;
  now?: () => number;
  /** (r063 S27) Today's live step snapshot (default the import's, `state/liveSteps`). */
  liveSteps?: () => LiveStepsSnapshot | null;
}

/** (r063 S27/A29) "So far" moves with the clock: today's model is recomputed this often while the page is visible (P). */
export const TODAY_ENERGY_TICK_MS = 5 * 60_000;

const HOURLY = ['rmr', 'tef', 'neat', 'stepsEnergy', 'exerciseEnergy', 'tdee'] as const;

async function defaultRunHours(
  _kind: 'realised' | 'plan',
  profile: unknown,
  schedule: unknown,
  todayIdx: number,
  dayStartMs: number,
): Promise<EnergyHour[] | null> {
  const { getSimulationClient } = await import('@/workers/simulationClient');
  const s = schedule as { horizonDays: number };
  const r = await getSimulationClient().runNominal(
    profile as never,
    { ...(schedule as object), horizonDays: Math.max(1, Math.min(s.horizonDays, todayIdx + 1)) } as never,
    { record: 'full', series: [...HOURLY], collectEvents: false },
  );
  const hourly = r.hourly as Partial<Record<(typeof HOURLY)[number], ArrayLike<number>>> | undefined;
  if (!hourly || !hourly.tdee || hourly.tdee.length < (todayIdx + 1) * 24) return null;
  return hoursFromRun(
    hourly as Record<(typeof HOURLY)[number], ArrayLike<number>>,
    todayIdx * 24,
    24,
    dayStartMs,
  );
}

/**
 * Today's energy and steps from the documents: the projection's `todayActual` (actual so far + plan remainder) and, when
 * the engine can run here, the realised and planned today runs. Without a plan (0.6.3), the habitual day's
 * (`loadPlanlessToday`); null on a plan's day that has no prescription (before the start, after the end).
 */
export async function loadTodayEnergySteps(
  deps: TodayEnergyDeps = {},
): Promise<TodayEnergyStepsModel | null> {
  const [{ readDocs }, { currentDay }, living, { localToInstant }] = await Promise.all([
    import('@/commands/living'),
    import('@/commands/livingWiring'),
    import('@/living/projection'),
    import('@/living/dates'),
  ]);
  const now = deps.now?.() ?? Date.now();
  const today = currentDay(now);
  const stored = await readDocs(today);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  // (r063 S27/A29) today's live step reading (the import's freshest), not only the throttled entry it wrote
  const [{ liveStepsOverlay }, { liveTodaySteps }] = await Promise.all([
    import('@/living/gaugeImport'),
    import('./liveSteps'),
  ]);
  const docs = {
    ...stored,
    entries: liveStepsOverlay(stored.entries, deps.liveSteps ? deps.liveSteps() : liveTodaySteps(), {
      today,
      tz,
      rolloverH: stored.settings?.dayRolloverH ?? 4,
    }),
  };
  const p = living.projectLiving({
    docs,
    today,
    tz,
    now: new Date(now).toISOString(),
    skipAssimilation: true,
  });
  const actual = p.todayActual;
  // (0.6.3) no live plan: today as the habitual day from Your body (energy by kind needs no plan)
  if (!p.plan || !p.head || p.plan.status === 'ended')
    return loadPlanlessToday(deps, { docs, today, tz, now });
  if (!actual) return null;
  const s = settingsValues();
  const todayIdx = p.days.find((d) => d.date === today)?.planDay ?? -1;
  let run: EnergyHour[] | null = null;
  let planRun: EnergyHour[] | null = null;
  if (!s.quietMode && todayIdx >= 0) {
    const runHours = deps.runHours ?? defaultRunHours;
    // (Codex #4) the engine's hours of a day are CLOCK hours from local midnight (sessions keep their clock `startH`), so
    // hour k is the civil instant `today k:00`, not the app day's rollover start plus k hours
    const dayStart = Date.parse(localToInstant(today, 0, tz));
    const schedule = living.projectionSchedule(p, today);
    try {
      [run, planRun] = await Promise.all([
        schedule
          ? runHours('realised', p.plan.baselineProfile, schedule, todayIdx, dayStart)
          : Promise.resolve(null),
        runHours('plan', p.plan.baselineProfile, p.head.schedule, todayIdx, dayStart),
      ]);
    } catch {
      run = null;
      planRun = null;
    }
  }
  // (r063 A16/S23) the windows of every session each run books: today's entries and the plan's remainder; the head plan's own
  const { energyBoutsOf, prescribedBouts } = await import('@/living/todayReplay');
  const rx = p.days.find((d) => d.date === today)?.prescription ?? null;
  return todayEnergyStepsModel({
    actual,
    run,
    planRun,
    nowMs: now,
    quiet: s.quietMode,
    provisional: provisionalBouts(candidatesNow(), today, s.provisionalOverlay !== false),
    bouts: energyBoutsOf(actual.bouts, today, tz),
    planBouts: rx ? energyBoutsOf(prescribedBouts(rx), today, tz) : [],
  });
}

/**
 * Today without a plan (0.6.3; Planning mode): the same chain as the plan's today, on the habitual day instead of the
 * plan's. The person is Your body's (`buildPersonProfile`, the profile the Simulator and the Planner run: RMR from height,
 * weight, age and sex, or lean mass, or a measured value); the day is `habitualTemplateFor` (100 % of maintenance, the
 * habitual steps and sleep) with no implicit training: only what was approved or logged today is exercise. `todayActual`
 * then puts today's fused steps so far and the approved activities on it (the rest of the awake day at the habitual steps,
 * the named prior), the engine runs that one day, and `todayEnergyStepsModel` reads so far and likely by bedtime from the
 * run (no plan figure). The screens place it in the day with `energyDay` (sleep, steps and the approved bouts), as with a
 * plan. Without the body basics there is no run: `energyMissing: 'profile'`.
 */
async function loadPlanlessToday(
  deps: TodayEnergyDeps,
  c: { docs: Awaited<ReturnType<typeof ReadDocs>>; today: string; tz: string; now: number },
): Promise<TodayEnergyStepsModel | null> {
  const [
    { useProfileStore, selectBodyValues },
    body,
    { habitualTemplateFor },
    { weekdayOf, localToInstant },
    { projectEntries },
    { todayActual, energyBoutsOf },
  ] = await Promise.all([
    import('./profileStore'),
    import('@/features/body/model'),
    import('@/living/calendar'),
    import('@/living/dates'),
    import('@/living/logs'),
    import('@/living/todayReplay'),
  ]);
  const s = settingsValues();
  const values = selectBodyValues(useProfileStore.getState());
  const missing = body.summarizeBody(values).missing.length > 0;
  const profile = body.buildPersonProfile(values);
  let head: DayTemplate;
  try {
    head = { ...habitualTemplateFor(profile, weekdayOf(c.today)), habitualTraining: false };
  } catch {
    return null;
  }
  const rolloverH = c.docs.settings?.dayRolloverH ?? 4;
  const entries = projectEntries(c.docs.entries).filter((e) => e.date === c.today) as LogEntry[];
  // the habitual day as a prescription: no sessions of its own, its steps and sleep (what the replay reads)
  const prescription = {
    planId: '',
    version: 0,
    planDay: 0,
    dayType: 'habitual',
    energyKcal: 0,
    macros: { proteinG: 0, carbG: 0, fatG: 0, fibreG: 0 },
    meals: [],
    sessions: [],
    supplements: [],
    items: [],
    template: head,
    maintenanceKcal: Number.NaN,
    ...(head.steps !== undefined ? { steps: head.steps } : {}),
    ...(head.sleep?.bedH !== undefined && head.sleep?.wakeH !== undefined
      ? { sleep: { bedH: head.sleep.bedH, wakeH: head.sleep.wakeH } }
      : {}),
  } satisfies PrescribedDaySnapshot;
  const actual = todayActual({
    date: c.today,
    prescription,
    headTemplate: head,
    entries,
    nowMs: c.now,
    tz: c.tz,
    rolloverH,
  });
  let run: EnergyHour[] | null = null;
  if (!s.quietMode && !missing) {
    const runHours = deps.runHours ?? defaultRunHours;
    const dayStart = Date.parse(localToInstant(c.today, 0, c.tz));
    const schedule = {
      schemaVersion: 1,
      startDate: c.today,
      horizonDays: 1,
      programs: [actual.template],
      days: [{ program: 0 }],
    };
    try {
      run = await runHours('realised', profile, schedule, 0, dayStart);
    } catch {
      run = null;
    }
  }
  return todayEnergyStepsModel({
    actual,
    run,
    planRun: null,
    nowMs: c.now,
    quiet: s.quietMode,
    provisional: provisionalBouts(candidatesNow(), c.today, s.provisionalOverlay !== false),
    planless: true,
    energyMissing: missing ? 'profile' : null,
    // (r063 A16) only what was approved or logged today is exercise: its windows hold its energy
    bouts: energyBoutsOf(actual.bouts, c.today, c.tz),
  });
}

/**
 * (r069 D4) The engine's hours and the booked bouts of a past day, for the day Energy page (today is Today's own run,
 * `loadTodayEnergySteps`). The same single authority as Today and Progress:
 *  - a day of the running plan: the realised run over the plan's history (`projectionSchedule`, as Progress reads its
 *    energy out), that day's 24 clock hours;
 *  - any other day (no plan, or before it started): Today's planless chain on that date — Your body's person, the habitual
 *    day of that weekday with no implicit training, and the day's own entries (its steps and every activity logged or
 *    approved) as the actual day through its end. Without the body basics there is no run (`missing: 'profile'`).
 * The bouts are the day's done sessions (each activity's energy goes to its own minutes). Hours start at local midnight
 * (the engine's day is clock hours), like Today's. Quiet mode runs nothing.
 */
export interface DayEnergyRun {
  date: string;
  hours: EnergyHour[] | null;
  bouts: EnergyBout[];
  basis: 'plan' | 'body';
  missing: 'profile' | null;
  energyBasis?: EnergyBasis;
}

/** The actual profile used by the run; a plan keeps its baseline profile. */
export interface EnergyBasis {
  weightKg: number;
  formula: 'Measured RMR' | 'Mifflin–St Jeor' | 'Cunningham' | 'Müller (fat-free mass)';
}
export function energyBasisOf(p: PersonProfile): EnergyBasis {
  const route = rmrRouteOf(p);
  const r = route === 'ffm' ? resolveProfile(p) : null;
  const ffmi = r ? r.ffm0Kg / (p.body.heightCm / 100) ** 2 : 0;
  const trained = r?.habits.trainingHistory === '1to3y' || r?.habits.trainingHistory === 'gt3y';
  const highFfmi = ffmi >= (p.body.sex === 'male' ? 20 : 17);
  return {
    weightKg: p.body.weightKg,
    formula:
      route === 'measured'
        ? 'Measured RMR'
        : route === 'equation'
          ? 'Mifflin–St Jeor'
          : trained || highFfmi
            ? 'Cunningham'
            : 'Müller (fat-free mass)',
  };
}

/** The inputs every past day's run reads, read once per load. */
async function dayEnergyContext(deps: TodayEnergyDeps) {
  const [
    { readDocs },
    { currentDay },
    living,
    dates,
    { appDayStartInstant },
    { projectEntries },
    replay,
    { habitualTemplateFor },
    { useProfileStore, selectBodyValues },
    body,
  ] = await Promise.all([
    import('@/commands/living'),
    import('@/commands/livingWiring'),
    import('@/living/projection'),
    import('@/living/dates'),
    import('@/living/realisedHistory'),
    import('@/living/logs'),
    import('@/living/todayReplay'),
    import('@/living/calendar'),
    import('./profileStore'),
    import('@/features/body/model'),
  ]);
  const now = deps.now?.() ?? Date.now();
  const today = currentDay(now);
  const docs = await readDocs(today);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const rolloverH = docs.settings?.dayRolloverH ?? 4;
  const entries = projectEntries(docs.entries) as LogEntry[];
  const values = selectBodyValues(useProfileStore.getState());
  const profile = body.buildPersonProfile(values);
  const missing = body.summarizeBody(values).missing.length > 0;
  const p = living.projectLiving({
    docs,
    today,
    tz,
    now: new Date(now).toISOString(),
    skipAssimilation: true,
  });
  const planLive = !!(p.plan && p.head && p.plan.status !== 'ended');
  /** The date's plan day, when the running plan holds it. */
  const planDayOf = (date: string): number | undefined =>
    planLive ? p.days.find((d) => d.date === date)?.planDay : undefined;
  /** The date as Your body's habitual day with its own entries as the whole actual day: the one-day schedule and its bouts. */
  const planless = (date: string) => {
    let head: DayTemplate;
    try {
      head = { ...habitualTemplateFor(profile, dates.weekdayOf(date as never)), habitualTraining: false };
    } catch {
      return null;
    }
    const prescription = {
      planId: '',
      version: 0,
      planDay: 0,
      dayType: 'habitual',
      energyKcal: 0,
      macros: { proteinG: 0, carbG: 0, fatG: 0, fibreG: 0 },
      meals: [],
      sessions: [],
      supplements: [],
      items: [],
      template: head,
      maintenanceKcal: Number.NaN,
      ...(head.steps !== undefined ? { steps: head.steps } : {}),
      ...(head.sleep?.bedH !== undefined && head.sleep?.wakeH !== undefined
        ? { sleep: { bedH: head.sleep.bedH, wakeH: head.sleep.wakeH } }
        : {}),
    } satisfies PrescribedDaySnapshot;
    const dayEndApp = Date.parse(appDayStartInstant(dates.addDays(date as never, 1), tz, rolloverH)) - 60_000;
    const actual = replay.todayActual({
      date: date as never,
      prescription,
      headTemplate: head,
      entries: entries.filter((e) => e.date === date),
      nowMs: dayEndApp,
      tz,
      rolloverH,
    });
    const bouts = replay.energyBoutsOf(actual.bouts, date as never, tz).filter((b) => b.source !== 'planned');
    const schedule = {
      schemaVersion: 1,
      startDate: date,
      horizonDays: 1,
      programs: [actual.template],
      days: [{ program: 0 }],
    };
    return { schedule, bouts };
  };
  const dayStart = (date: string) => Date.parse(dates.localToInstant(date as never, 0, tz));
  // the plan's realised schedule is read only when a plan day is asked, once per load
  let planMemo: { schedule: unknown; key: string } | null | undefined;
  const planSchedule = () => {
    if (planMemo === undefined) {
      const schedule = p.plan && planLive ? living.projectionSchedule(p, today) : null;
      planMemo = schedule ? { schedule, key: hashText(JSON.stringify(schedule)) } : null;
    }
    return planMemo;
  };
  return {
    today,
    quiet: settingsValues().quietMode,
    profile,
    missing,
    plan: p.plan,
    planDayOf,
    planless,
    dayStart,
    planSchedule,
  };
}

/**
 * Past days' runs, kept for the session by what they were run on (the person and the day's template; the plan's
 * realised schedule), so a day opened from a week's bars reads the very figure its bar showed, and coming back is instant.
 */
const runCache = new Map<string, Promise<EnergyHour[] | null>>();
const RUN_CACHE_MAX = 800;
function cachedRun(key: string, run: () => Promise<EnergyHour[] | null>): Promise<EnergyHour[] | null> {
  const hit = runCache.get(key);
  if (hit) return hit;
  const v = run().catch(() => null);
  if (runCache.size >= RUN_CACHE_MAX) runCache.delete(runCache.keys().next().value!);
  runCache.set(key, v);
  // a failed run is asked again next time
  void v.then((h) => {
    if (!h) runCache.delete(key);
  });
  return v;
}

/** Tests only: forget the past days' runs. */
export function clearDayEnergyRuns(): void {
  runCache.clear();
}

type DayCtx = Awaited<ReturnType<typeof dayEnergyContext>>;

/** The hours of one past date (the plan's realised run, else Your body's habitual day), or why there are none. */
async function pastDayHours(
  ctx: DayCtx,
  date: string,
  deps: TodayEnergyDeps,
): Promise<{
  hours: EnergyHour[] | null;
  bouts: EnergyBout[];
  basis: 'plan' | 'body';
  missing: 'profile' | null;
}> {
  const runHours = deps.runHours ?? defaultRunHours;
  const day = ctx.planless(date);
  const bouts = day?.bouts ?? [];
  const planDay = ctx.planDayOf(date);
  if (ctx.plan && planDay !== undefined && planDay >= 0) {
    const plan = ctx.planSchedule();
    if (plan) {
      const key = `plan:${date}:${planDay}:${plan.key}`;
      const hours = ctx.quiet
        ? null
        : await cachedRun(key, () =>
            runHours('realised', ctx.plan!.baselineProfile, plan.schedule, planDay, ctx.dayStart(date)),
          );
      return { hours, bouts, basis: 'plan', missing: null };
    }
  }
  if (!day) return { hours: null, bouts, basis: 'body', missing: null };
  if (ctx.missing) return { hours: null, bouts, basis: 'body', missing: 'profile' };
  if (ctx.quiet) return { hours: null, bouts, basis: 'body', missing: null };
  const key = `body:${date}:${hashText(JSON.stringify([ctx.profile, day.schedule]))}`;
  const hours = await cachedRun(key, () =>
    runHours('realised', ctx.profile, day.schedule, 0, ctx.dayStart(date)),
  );
  return { hours, bouts, basis: 'body', missing: null };
}

/** A short stable hash of a text (FNV-1a, 32 bit, hex): a cache key, never a security boundary. */
function hashText(t: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export async function loadDayEnergy(date: string, deps: TodayEnergyDeps = {}): Promise<DayEnergyRun | null> {
  const ctx = await dayEnergyContext(deps);
  if (date >= ctx.today) return null;
  const r = await pastDayHours(ctx, date, deps);
  return {
    date,
    ...r,
    energyBasis: energyBasisOf(r.basis === 'plan' && ctx.plan ? ctx.plan.baselineProfile : ctx.profile),
  };
}

/** (r069 D4) One past day of a period: its total and its kinds (kcal; null when the day has no run). */
export interface PeriodEnergyDay {
  date: string;
  kcal: number | null;
  /** The day's ledger by kind: resting (RMR and the model's other terms), everyday movement, food digestion, exercise. */
  kinds: { resting: number; movement: number; digestion: number; exercise: number } | null;
  components?: Record<EnergyComponent, number> | null;
  envelope?: Envelope | null;
  energyBasis?: EnergyBasis;
}

/**
 * (r069 D4) The past days of a week, month, year or range for the Energy page's bars: each date's total from the same run
 * its day view reads (`pastDayHours`, cached), so a bar and its day agree to the kcal. Today is the page's (Today's run).
 * At most `PERIOD_RUNS_AT_ONCE` runs are asked at a time.
 */
export const PERIOD_RUNS_AT_ONCE = 6;

export async function loadPeriodEnergy(
  dates: readonly string[],
  deps: TodayEnergyDeps = {},
): Promise<{ days: PeriodEnergyDay[]; missing: 'profile' | null }> {
  const ctx = await dayEnergyContext(deps);
  const past = dates.filter((d) => d < ctx.today);
  const out = new Map<string, PeriodEnergyDay>();
  let missing: 'profile' | null = null;
  let next = 0;
  const worker = async () => {
    while (next < past.length) {
      const date = past[next++]!;
      const r = await pastDayHours(ctx, date, deps);
      if (r.missing) missing = r.missing;
      const day = r.hours ? energyDay({ hours: r.hours, minutes: [], bouts: r.bouts }) : null;
      out.set(date, {
        date,
        kcal: day?.total ?? null,
        kinds: r.hours ? kindsOfHours(r.hours) : null,
        components: day?.components ?? null,
        envelope: day?.envelope ?? null,
        energyBasis: energyBasisOf(r.basis === 'plan' && ctx.plan ? ctx.plan.baselineProfile : ctx.profile),
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PERIOD_RUNS_AT_ONCE, past.length) }, worker));
  return { days: past.map((d) => out.get(d) ?? { date: d, kcal: null, kinds: null }), missing };
}

/** A day's hours by kind (the day-level sums of the ledger, as the page groups its quarters). */
export function kindsOfHours(hours: readonly EnergyHour[]): PeriodEnergyDay['kinds'] {
  let rmr = 0;
  let tef = 0;
  let neat = 0;
  let ex = 0;
  let tdee = 0;
  for (const h of hours) {
    rmr += h.rmr;
    tef += h.tef;
    neat += h.neat;
    ex += h.exerciseEnergy;
    tdee += h.tdee;
  }
  const other = tdee - rmr - tef - neat - ex;
  const movement = Math.max(0, neat);
  const exercise = Math.max(0, ex);
  return { resting: rmr + other + (neat - movement) + (ex - exercise), movement, digestion: tef, exercise };
}

/** Today's energy and steps; recomputed when the log, the candidates or the settings change (null while loading). */
export function useTodayEnergySteps(deps: TodayEnergyDeps = {}): TodayEnergyStepsModel | null {
  const [model, setModel] = useState<TodayEnergyStepsModel | null>(null);
  const quiet = useSettingsStore((x) => x.quietMode);
  const overlay = useSettingsStore((x) => x.provisionalOverlay);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void loadTodayEnergySteps(deps)
          .then((m) => {
            if (alive) setModel(m);
          })
          .catch(() => undefined);
      }, 150);
    };
    const offs: Array<() => void> = [];
    try {
      const store = getDocumentStore();
      // (r063 S27) the plan and its versions, the day's status: inputs of today's runs beyond the log
      offs.push(
        store.watch('dailyLogs', {}, refresh),
        store.watch('activityCandidates', {}, refresh),
        store.watch('planVersions', {}, refresh),
        store.watch('plans', {}, refresh),
      );
    } catch {
      refresh();
    }
    // (r063 S27/A29) a new live step reading, the person's body basics, and the clock (a bounded tick while visible)
    void import('./liveSteps').then(({ subscribeLiveSteps }) => {
      if (alive) offs.push(subscribeLiveSteps(refresh));
    });
    void import('./profileStore').then(({ useProfileStore }) => {
      if (alive) offs.push(useProfileStore.subscribe(refresh));
    });
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const tick = setInterval(() => {
      if (visible()) refresh();
    }, TODAY_ENERGY_TICK_MS);
    const onVisible = () => {
      if (visible()) refresh();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      clearInterval(tick);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      offs.forEach((off) => off());
    };
    // the deps object is a test seam; settings changes re-run through quiet/overlay
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiet, overlay]);
  return model;
}
