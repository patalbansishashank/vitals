/**
 * The in-memory stand-in for Living mode's data and commands until E4's store and E5's `today.get` / `plan.*` / `log.*`
 * commands are wired (see `./source.ts` and `./actions.ts`). It keeps logs, marks, measurements and change cards in
 * memory and assembles E5's contract objects (`TodayView`, `AdherenceScore`, `DriftReport`) with E5's pure functions
 * (`scoreDay`, `adherenceTrend`, `energyCredit`, `summarise`, …) so the screens render exactly what the real source will
 * hand them. Plans started from the planner use E5's `freezePrescription`; fixture plans use `./fixtures`.
 *
 * TODO(E4/E5): delete once `LivingDataSource` and `LivingActions` are backed by the store and the commands.
 */
import {
  addDays,
  adherenceTrend,
  compareDates,
  costliestItem,
  daysBetween,
  energyCredit,
  freezePrescription,
  mealTotals,
  proteinCredit,
  scoreDay,
  summarise,
  weekdayOf,
  windowCredit,
  type AdherenceScore,
  type DriftReport,
  type EntrySource,
  type ItemCredit,
  type LocalDate,
  type LogEntry,
  type Mark,
  type MeasurementEntry,
  type Notice,
  type PlanItemType,
  type PrescribedDaySnapshot,
  type ScoredDay,
  type TodayChecklistItem,
  type TodayView,
} from '@/living';
import type { TrendLaneData } from '@/features/charts/living/types';
import { useActivePlanStore, type ActivePlan } from '../activePlan';
import { currentDay, type LivingClock } from '../clock';
import { fmtDateRange, fmtDay, fmtWeekday, mealName } from '../format';
import { changeCardReducer, type ChangeCardModel, type ChangeEvent } from '../model/changeCard';
import type { ActionOutcome, LivingActions, ManualMealInput, MeasurementInput, PlanEventInput, RowMark, SessionLogInput } from './actions';
import { FIXTURE_WEIGHT, fixtureItemCredit, fixturePrescription, fixtureWeighIn, hash01 } from './fixtures';
import type { LivingDataSource } from './source';
import type { AdherenceSummary, BodyComposition, CheckInModel, DayGlance, HistoryDay, PlanVersionRow } from './types';

export interface PlanControl {
  get(): ActivePlan | null;
  subscribe(listener: () => void): () => void;
  patch(patch: Partial<ActivePlan>): void;
  end(on: LocalDate, reason: 'abandoned' | 'completed' | 'replaced' | 'safety'): void;
  discard(): void;
}

/** The active-plan store as the stand-in's plan control. */
export const storePlanControl: PlanControl = {
  get: () => useActivePlanStore.getState().plan,
  subscribe: (l) => useActivePlanStore.subscribe(l),
  patch: (p) => useActivePlanStore.getState().patchPlan(p),
  end: (on, reason) => useActivePlanStore.getState().endPlan(on, reason),
  discard: () => useActivePlanStore.getState().discardPlan(),
};

/** A fixed plan for tests (no store). */
export function fixedPlanControl(initial: ActivePlan | null): PlanControl & { set(p: ActivePlan | null): void } {
  let plan = initial;
  const ls = new Set<() => void>();
  const emit = () => ls.forEach((l) => l());
  return {
    get: () => plan,
    subscribe: (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    patch: (p) => {
      plan = plan ? { ...plan, ...p } : plan;
      emit();
    },
    end: () => {
      plan = null;
      emit();
    },
    discard: () => {
      plan = null;
      emit();
    },
    set: (p) => {
      plan = p;
      emit();
    },
  };
}

interface RowState {
  mark: RowMark;
  credit: number;
  method: EntrySource['method'];
}

interface StubState {
  rev: number;
  quietMode: boolean;
  autoEase: boolean;
  /** Checklist-row marks per date (`meal:lunch`, `session:14:0`, `steps`, …). */
  rows: Record<LocalDate, Record<string, RowState>>;
  dayMarks: Record<LocalDate, Mark>;
  entries: LogEntry[];
  measurements: MeasurementEntry[];
  assumed: Set<LocalDate>;
  difficulty: Record<LocalDate, number>;
  changes: ChangeCardModel[];
  changesSeeded: string | null;
}

export interface StubLiving {
  source: LivingDataSource;
  actions: LivingActions;
  /** Test inspection. */
  inspect(): Readonly<Omit<StubState, 'assumed'>> & { assumed: LocalDate[] };
  reset(): void;
}

const ROW_CREDIT: Record<RowMark, number> = { asPlanned: 1, partly: 0.5, skipped: 0 };
const STATUS_OF: Record<RowMark, 'done' | 'partial' | 'skipped'> = { asPlanned: 'done', partly: 'partial', skipped: 'skipped' };

const ITEM_LABEL: Record<PlanItemType, string> = {
  energy: 'food energy',
  protein: 'protein',
  window: 'eating window',
  fast: 'fast',
  rtSession: 'strength session',
  cardioSession: 'cardio session',
  steps: 'steps',
  sleep: 'sleep',
  supplement: 'supplement',
};

const BLOCKS: Array<{ id: string; label: string; types: PlanItemType[] }> = [
  { id: 'training', label: 'training', types: ['rtSession', 'cardioSession'] },
  { id: 'protein', label: 'protein', types: ['protein'] },
  { id: 'energy', label: 'energy', types: ['energy'] },
  { id: 'fasting', label: 'fasting', types: ['fast', 'window'] },
  { id: 'steps', label: 'steps', types: ['steps'] },
];

function rowIdOfItem(itemId: string): string | null {
  if (itemId.startsWith('rtSession:') || itemId.startsWith('cardioSession:')) return `session:${itemId.slice(itemId.indexOf(':') + 1)}`;
  if (itemId === 'steps' || itemId === 'sleep' || itemId === 'fast') return itemId;
  if (itemId.startsWith('supplement:')) return itemId;
  return null;
}

const EVENT_TITLE: Record<PlanEventInput['kind'], string> = {
  busy: 'busy',
  travel: 'away',
  illness: 'unwell',
  noTraining: 'no training',
  socialMeal: 'a meal out',
};
const EVENT_NOTE: Record<PlanEventInput['kind'], string> = {
  busy: 'Busy days: no training, food as planned.',
  travel: 'Travel: no training and no fasting, food as planned.',
  illness: 'Illness: your usual food, no training and no fasting until you are well. Rest comes first.',
  noTraining: 'No training on those days.',
  socialMeal: 'A meal out: the extra food is planned in.',
};
const EVENT_AFTER: Record<PlanEventInput['kind'], string> = {
  busy: 'no training',
  travel: 'no training · no fasting',
  illness: 'usual food · rest',
  noTraining: 'no training',
  socialMeal: 'the meal planned in',
};

export function createStubLiving(opts: { clock: LivingClock; plan?: PlanControl; seedHistory?: (plan: ActivePlan) => boolean }): StubLiving {
  const clock = opts.clock;
  const plans = opts.plan ?? storePlanControl;
  const seeded = opts.seedHistory ?? ((p: ActivePlan) => !p.doc);
  let st: StubState = blank();
  let idn = 0;
  const listeners = new Set<() => void>();
  let lastPlan = plans.get();
  plans.subscribe(() => {
    const p = plans.get();
    if (p !== lastPlan) {
      if (!p || !lastPlan || p.id !== lastPlan.id) st = blank();
      lastPlan = p;
      bump();
    }
  });

  function blank(): StubState {
    return { rev: 0, quietMode: false, autoEase: true, rows: {}, dayMarks: {}, entries: [], measurements: [], assumed: new Set(), difficulty: {}, changes: [], changesSeeded: null };
  }
  function bump(): void {
    st = { ...st, rev: st.rev + 1 };
    listeners.forEach((l) => l());
  }
  const nextId = (p: string) => `${p}-${++idn}`;
  const nowIso = () => clock.now().toISOString();
  const today = () => currentDay(clock);

  /* ------------------------------------------------------------------ prescription */
  const rxCache = new Map<string, PrescribedDaySnapshot | null>();
  function prescription(plan: ActivePlan, date: LocalDate): PrescribedDaySnapshot | null {
    if (compareDates(date, plan.startDate) < 0 || compareDates(date, plan.plannedEndDate) >= 0) return null;
    const key = `${plan.id}@${plan.headVersion}:${date}`;
    if (rxCache.has(key)) return rxCache.get(key)!;
    let rx: PrescribedDaySnapshot | null = null;
    const paused = isPausedOn(plan, date);
    if (plan.doc && plan.version) {
      try {
        rx = freezePrescription({ plan: plan.doc, version: plan.version, date, tz: clock.tz, paused });
      } catch {
        rx = null;
      }
    }
    rx ??= { ...fixturePrescription(plan, date, clock.tz), ...(paused ? { paused: true } : {}) };
    rxCache.set(key, rx);
    return rx;
  }

  function isPausedOn(plan: ActivePlan, date: LocalDate): boolean {
    return plan.pauses.some((p) => compareDates(date, p.from) >= 0 && (p.to === null || compareDates(date, p.to) < 0));
  }

  /* ------------------------------------------------------------------ credits */
  function mealEntries(date: LocalDate): Array<Extract<LogEntry, { kind: 'meal' }>> {
    return st.entries.filter((e): e is Extract<LogEntry, { kind: 'meal' }> => e.kind === 'meal' && e.date === date);
  }

  function hasLocal(date: LocalDate): boolean {
    return !!st.rows[date] || !!st.dayMarks[date] || st.entries.some((e) => e.date === date) || st.measurements.some((m) => m.date === date);
  }

  function itemCredits(plan: ActivePlan, rx: PrescribedDaySnapshot, date: LocalDate): ItemCredit[] {
    const rows = st.rows[date] ?? {};
    const all = st.dayMarks[date];
    const pastSeed = seeded(plan) && compareDates(date, today()) < 0 && !hasLocal(date);
    const meals = mealEntries(date);
    const mealsKnown = rx.meals.length > 0 && rx.meals.every((m) => rows[`meal:${m.slot}`] || meals.some((e) => e.slot === m.slot));
    const eaten = mealTotals(st.entries.filter((e) => e.date === date));
    return rx.items.map((it): ItemCredit => {
      if (pastSeed) {
        const c = fixtureItemCredit(date, it.itemId, it.type);
        return { itemId: it.itemId, credit: c ? c.credit : null, why: c ? `${ITEM_LABEL[it.type]} ${c.status === 'done' ? 'as planned' : c.status}` : 'not logged' };
      }
      const rowId = rowIdOfItem(it.itemId);
      const row = rowId ? rows[rowId] : undefined;
      if (row) return { itemId: it.itemId, credit: row.credit, why: `${ITEM_LABEL[it.type]} ${row.mark === 'asPlanned' ? 'as planned' : row.mark}` };
      if ((it.type === 'energy' || it.type === 'protein') && mealsKnown) {
        const credit = it.type === 'energy' ? energyCredit(it.target.energyKcal ?? rx.energyKcal, eaten.energyKcal.value, rx.maintenanceKcal) : proteinCredit(it.target.proteinG ?? rx.macros.proteinG, eaten.proteinG.value);
        return { itemId: it.itemId, credit, why: ITEM_LABEL[it.type] };
      }
      if (it.type === 'window' && meals.length > 0 && rx.window) {
        return { itemId: it.itemId, credit: windowCredit(rx.window.startH, rx.window.endH, meals.map((m) => ({ clockH: m.clockH, kcal: m.totals.energyKcal.value }))), why: 'eating window' };
      }
      if (all) return { itemId: it.itemId, credit: all === 'asPlanned' ? 1 : all === 'partly' ? 0.5 : 0, why: 'day marked' };
      return { itemId: it.itemId, credit: null, why: 'not logged' };
    });
  }

  function dayScore(plan: ActivePlan, date: LocalDate): AdherenceScore | null {
    const rx = prescription(plan, date);
    if (!rx || compareDates(date, today()) > 0) return null;
    const assumed = st.assumed.has(date);
    return scoreDay(rx.items, itemCredits(plan, rx, date), { final: compareDates(date, today()) < 0, assumed, paused: !!rx.paused });
  }

  function statusOf(credit: number | null, rowMark?: RowMark): 'done' | 'partial' | 'skipped' | 'unknown' {
    if (rowMark) return STATUS_OF[rowMark];
    if (credit === null) return 'unknown';
    if (credit >= 0.999) return 'done';
    if (credit <= 0) return 'skipped';
    return 'partial';
  }

  function loggedOn(plan: ActivePlan, date: LocalDate): boolean {
    if (hasLocal(date)) return true;
    if (seeded(plan) && compareDates(date, today()) < 0) return hash01(`day:${date}`) >= 0.1;
    return false;
  }

  function scoredDays(plan: ActivePlan, asOf: LocalDate): ScoredDay[] {
    const out: ScoredDay[] = [];
    for (let k = 0; k < 28; k++) {
      const date = addDays(asOf, -k);
      if (compareDates(date, plan.startDate) < 0) break;
      const s = dayScore(plan, date);
      out.push({ date, score: s?.score ?? null, final: s?.final ?? false, logged: loggedOn(plan, date) });
    }
    return out;
  }

  /* ------------------------------------------------------------------ weight */
  function weighIns(plan: ActivePlan, upTo: LocalDate): Array<{ date: LocalDate; value: number; flagged: boolean }> {
    const out: Array<{ date: LocalDate; value: number; flagged: boolean }> = [];
    const n = daysBetween(plan.startDate, upTo);
    for (let k = 0; k <= n; k++) {
      const date = addDays(plan.startDate, k);
      const local = st.measurements.filter((m) => m.metric === 'weightKg' && m.date === date);
      if (local.length) out.push({ date, value: local[local.length - 1]!.value, flagged: false });
      else if (seeded(plan)) {
        const w = fixtureWeighIn(plan.startDate, k, today());
        if (w) out.push({ date, value: w.value, flagged: w.flagged });
      }
    }
    return out;
  }

  /** Trend (EWMA α = 0.1 on unflagged weigh-ins; flagged ones count at a tenth). */
  function trendSeries(plan: ActivePlan, upTo: LocalDate): Map<LocalDate, number> {
    const out = new Map<LocalDate, number>();
    let t: number | null = null;
    const byDate = new Map(weighIns(plan, upTo).map((w) => [w.date, w] as const));
    const n = daysBetween(plan.startDate, upTo);
    for (let k = 0; k <= n; k++) {
      const date = addDays(plan.startDate, k);
      const w = byDate.get(date);
      if (w) {
        const a = w.flagged ? 0.01 : 0.1;
        t = t === null ? w.value : t + a * (w.value - t);
      }
      if (t !== null) out.set(date, t);
    }
    return out;
  }

  function band(plan: ActivePlan, which: 'asPrescribed' | 'realistic', k: number): { p10: number; p50: number; p90: number } | null {
    if (plan.doc && plan.version) {
      const f = plan.version.forecast;
      const s = f[which].scaleWeight ?? f.asPrescribed.scaleWeight;
      const i = k - f.fromDay;
      if (!s || i < 0 || i >= s.p50.length) return null;
      return { p10: s.p10[i]!, p50: s.p50[i]!, p90: s.p90[i]! };
    }
    const slope = which === 'asPrescribed' ? FIXTURE_WEIGHT.prescribedSlope : FIXTURE_WEIGHT.realisticSlope;
    const half = which === 'asPrescribed' ? 0.3 + 0.012 * k : 0.35 + 0.015 * k;
    const p50 = FIXTURE_WEIGHT.start + slope * k;
    return { p10: p50 - half, p50, p90: p50 + half };
  }

  function goalDates(plan: ActivePlan): { realistic: [LocalDate, LocalDate]; prescribed: LocalDate } | null {
    if (plan.doc) {
      const g = plan.version?.forecast.goals.find((x) => x.dateRange);
      return g?.dateRange ? { realistic: g.dateRange, prescribed: g.dateRange[0] } : null;
    }
    const drop = FIXTURE_WEIGHT.start - FIXTURE_WEIGHT.goal;
    const real = Math.round(drop / -FIXTURE_WEIGHT.realisticSlope);
    const pres = Math.round(drop / -FIXTURE_WEIGHT.prescribedSlope);
    return { realistic: [addDays(plan.startDate, real - 4), addDays(plan.startDate, real + 5)], prescribed: addDays(plan.startDate, pres) };
  }

  /* ------------------------------------------------------------------ change cards */
  function seedChanges(plan: ActivePlan): void {
    if (st.changesSeeded === plan.id) return;
    st.changesSeeded = plan.id;
    if (!seeded(plan)) return;
    const t = today();
    const g = goalDates(plan);
    // cards made before the first read (a re-plan, an event) stay on top
    st.changes = [
      ...st.changes,
      {
        id: 'chg-ease-session',
        class: 'edit',
        title: 'Proposal · an easier session today',
        source: { label: 'the plan · from your sleep' },
        createdAt: `${t}T06:30:00`,
        note: 'You slept about 6 h 10 against the 7 h 30 the plan assumed. A shorter session keeps the week on track.',
        items: [{ label: `${fmtDay(t)} lift`, before: '45 min · 4 exercises', after: '30 min · 3 exercises' }],
        impact: g
          ? { goalDates: [{ label: 'goal date', before: g.realistic, after: [addDays(g.realistic[0], 1), addDays(g.realistic[1], 1)] }], metrics: [{ label: 'weight by the end', delta: 0.1, unit: 'kg', decimals: 1 }] }
          : { goalDates: [], metrics: [] },
        state: 'pending',
      },
      {
        id: 'chg-light-food',
        class: 'edit',
        title: 'Small adjustment · food 5 % lower today and tomorrow',
        source: { label: 'the plan · small adjustment' },
        createdAt: `${addDays(t, -1)}T21:00:00`,
        note: 'You ate about 400 kcal more yesterday. Today and tomorrow are 5 % lower.',
        items: [
          { label: `${fmtDay(t)} food`, before: '2 160 kcal', after: '2 050 kcal' },
          { label: `${fmtDay(addDays(t, 1))} food`, before: '1 950 kcal', after: '1 850 kcal' },
        ],
        state: 'applied',
      },
    ];
  }

  /* ------------------------------------------------------------------ Today */
  function checklist(plan: ActivePlan, rx: PrescribedDaySnapshot, date: LocalDate): TodayChecklistItem[] {
    const rows = st.rows[date] ?? {};
    const all = st.dayMarks[date];
    const meals = mealEntries(date);
    const out: TodayChecklistItem[] = [];
    const weighed = st.measurements.some((m) => m.metric === 'weightKg' && m.date === date);
    out.push({ id: 'weigh', ...(plan.intentions.weighInClockH !== undefined ? { at: plan.intentions.weighInClockH } : {}), kind: 'weigh', label: 'Weigh in', done: weighed, command: { id: 'log.measurement', input: { date, metric: 'weightKg' } } });
    out.push({ id: 'mark:all', kind: 'mark', label: 'Day as planned', done: all !== undefined, command: { id: 'log.markDay', input: { date, marks: { all: 'asPlanned' } } } });
    for (const m of rx.meals) {
      const done = !!rows[`meal:${m.slot}`] || meals.some((e) => e.slot === m.slot) || all !== undefined;
      out.push({ id: `meal:${m.slot}`, at: m.clockH, kind: 'meal', label: mealName(m.slot, m.clockH), done, command: { id: 'log.meal', input: { date, slot: m.slot, clockH: m.clockH, asPlanned: true } } });
    }
    for (const s of rx.sessions) {
      out.push({ id: `session:${s.slotKey}`, at: s.startH, kind: 'session', label: s.kind === 'resistance' ? 'Strength session' : 'Cardio session', done: !!rows[`session:${s.slotKey}`] || all !== undefined, command: { id: 'log.session', input: { date, slotKey: s.slotKey, status: 'done' } } });
    }
    if (rx.fast) out.push({ id: 'fast', kind: 'fast', label: `Fast ${Math.round(rx.fast.hours)} h`, done: !!rows.fast || all !== undefined, command: { id: 'log.fast', input: { action: 'record' } } });
    for (const s of rx.supplements) out.push({ id: `supplement:${s.supplementId}`, ...(s.clockH !== undefined ? { at: s.clockH } : {}), kind: 'supplement', label: s.supplementId, done: !!rows[`supplement:${s.supplementId}`], command: { id: 'log.supplement', input: { date, supplementId: s.supplementId, dose: s.dose, unit: s.unit } } });
    if (rx.steps !== undefined) out.push({ id: 'steps', kind: 'steps', label: 'Steps', done: !!rows.steps, command: { id: 'log.steps', input: { date } } });
    if (rx.sleep) out.push({ id: 'sleep', kind: 'sleep', label: 'Last night’s sleep', done: !!rows.sleep, command: { id: 'log.sleep', input: { date } } });
    return out.sort((a, b) => (a.at ?? 99) - (b.at ?? 99));
  }

  function todayView(date: LocalDate): TodayView | null {
    const plan = plans.get();
    if (!plan) return null;
    seedChanges(plan);
    const rx = prescription(plan, date);
    const t = today();
    const entries = st.entries.filter((e) => e.date === date);
    const totals = mealTotals(entries);
    const score = rx ? dayScore(plan, date) : null;
    const credits = rx ? itemCredits(plan, rx, date) : [];
    const rows = st.rows[date] ?? {};
    const trend = adherenceTrend(scoredDays(plan, compareDates(date, t) > 0 ? t : date), compareDates(date, t) > 0 ? t : date);
    const trendW = trendSeries(plan, compareDates(date, t) > 0 ? t : date);
    const k = daysBetween(plan.startDate, date);
    const real = band(plan, 'realistic', k);
    const tw = trendW.get(compareDates(date, t) > 0 ? t : date) ?? null;
    const measured = st.measurements.filter((m) => m.metric === 'weightKg' && m.date === date).at(-1)?.value;
    const notices: Notice[] = [];
    if (plan.status === 'paused') notices.push({ id: 'paused', kind: 'info', level: 'info', text: 'The plan is paused. Days are habitual until you resume.', command: { id: 'plan.resume', input: {} } });
    const due = plan.status === 'active' && date === t && weekdayOf(t) === plan.policy.checkInWeekday && daysBetween(plan.startDate, t) >= 6;
    if (due) notices.push({ id: 'checkIn', kind: 'checkIn', level: 'info', text: 'Your weekly check-in is ready.', command: { id: 'plan.checkIn', input: {} } });
    const gd = goalDates(plan);
    const driftState = tw !== null && real ? (tw < real.p10 ? 'ahead' : tw > real.p90 ? 'behind' : 'onTrack') : null;
    const shift = gd ? daysBetween(gd.prescribed, gd.realistic[0]) + 4 : null;
    return {
      date,
      tz: clock.tz,
      rolloverH: clock.rolloverH,
      mode: 'living',
      minimalMode: false,
      quietMode: st.quietMode,
      plan: { id: plan.id, name: plan.name, rung: plan.rung, day: k + 1, of: daysBetween(plan.startDate, plan.plannedEndDate), status: plan.status, version: plan.headVersion },
      prescription: rx,
      logged: {
        entries: entries.map(summarise),
        totals: { energyKcal: totals.energyKcal, proteinG: totals.proteinG, carbG: totals.carbG, fatG: totals.fatG, fibreG: totals.fibreG },
        items: credits.map((c) => {
          const rowId = rowIdOfItem(c.itemId);
          const status = statusOf(c.credit, rowId ? rows[rowId]?.mark : undefined);
          return { itemId: c.itemId, status, ...(c.credit !== null ? { credit: c.credit } : {}) };
        }),
        ...(rx?.steps !== undefined && rows.steps ? { steps: Math.round((rx.steps ?? 0) * rows.steps.credit) } : {}),
      },
      remaining: rx && !st.quietMode ? { energyKcal: rx.energyKcal - totals.energyKcal.value, proteinG: rx.macros.proteinG - totals.proteinG.value, carbG: rx.macros.carbG - totals.carbG.value, fatG: rx.macros.fatG - totals.fatG.value } : null,
      checklist: rx ? checklist(plan, rx, date) : [],
      adherence: {
        today: st.quietMode ? null : score,
        a7: st.quietMode ? null : trend.a7,
        a28: st.quietMode ? null : trend.a28,
        daysLogged7: trend.daysLogged7,
        spark: st.quietMode ? [] : trend.spark,
      },
      drift:
        driftState && gd
          ? [{ metric: 'scaleWeight', state: driftState, goalDate: { range: gd.realistic, shiftDays: shift, shiftSd: 6 }, text: driftState === 'onTrack' ? 'On track.' : driftState === 'ahead' ? 'Ahead of the forecast.' : 'Behind the forecast.' }]
          : null,
      trendWeight: tw !== null && real ? { kg: tw, sd: 0.3, todayExpected: real, ...(measured !== undefined ? { measured } : {}) } : null,
      checkIn: { due, lastAt: daysBetween(plan.startDate, t) >= 7 ? addDays(t, -7) : null },
      biometrics: seeded(plan)
        ? { lastNight: { hours: 6 + 1 / 6, efficiency: 88, source: 'ring' }, restingHr: { value: 54, vsBaseline: -2 }, hrv: { state: 'normal', metric: 'rmssd' }, flags: [] }
        : null,
      notices,
      coachPrompts: ['log lunch as planned', 'why is my weight up?', 'I’m busy Thursday to Saturday'],
    };
  }

  /* ------------------------------------------------------------------ source */
  const source: LivingDataSource = {
    today: (date) => todayView(date),
    days: (dates) => {
      const plan = plans.get();
      return dates.map((date): DayGlance => {
        const inPlan = !!plan && compareDates(date, plan.startDate) >= 0 && compareDates(date, plan.plannedEndDate) < 0;
        return {
          date,
          inPlan,
          isStart: !!plan && date === plan.startDate,
          isEnd: !!plan && date === addDays(plan.plannedEndDate, -1),
          paused: !!plan && isPausedOn(plan, date),
          assumed: st.assumed.has(date),
          logged: !!plan && inPlan && loggedOn(plan, date),
          score: plan && inPlan ? dayScore(plan, date) : null,
        };
      });
    },
    trend: (from, to) => {
      const plan = plans.get();
      if (!plan) return null;
      const t = today();
      const n = daysBetween(from, to) + 1;
      const tw = trendSeries(plan, compareDates(to, t) < 0 ? to : t);
      const data: TrendLaneData = {
        startDate: from,
        days: n,
        todayIndex: compareDates(t, from) >= 0 && compareDates(t, to) <= 0 ? daysBetween(from, t) : null,
        unit: 'kg',
        decimals: 1,
        weighIns: weighIns(plan, compareDates(to, t) < 0 ? to : t)
          .filter((w) => compareDates(w.date, from) >= 0 && compareDates(w.date, to) <= 0)
          .map((w) => ({ day: daysBetween(from, w.date), value: w.value, ...(w.flagged ? { flagged: true } : {}) })),
        trend: Array.from({ length: n }, (_, i) => tw.get(addDays(from, i)) ?? NaN),
        trendSd: Array.from({ length: n }, () => 0.3),
        realistic: { p10: [], p50: [], p90: [] },
        asPrescribed: { p10: [], p90: [] },
      };
      for (let i = 0; i < n; i++) {
        const k = daysBetween(plan.startDate, addDays(from, i));
        const r = k >= 0 ? band(plan, 'realistic', k) : null;
        const p = k >= 0 ? band(plan, 'asPrescribed', k) : null;
        data.realistic!.p10.push(r?.p10 ?? NaN);
        data.realistic!.p50!.push(r?.p50 ?? NaN);
        data.realistic!.p90.push(r?.p90 ?? NaN);
        data.asPrescribed!.p10.push(p?.p10 ?? NaN);
        data.asPrescribed!.p90.push(p?.p90 ?? NaN);
      }
      if (!plan.doc) data.goal = { value: FIXTURE_WEIGHT.goal, label: `goal ${FIXTURE_WEIGHT.goal} kg` };
      const gd = goalDates(plan);
      if (gd) data.goalDateRange = { from: gd.realistic[0], to: gd.realistic[1], label: `likely ${fmtDateRange(gd.realistic[0], gd.realistic[1])}` };
      const events: NonNullable<TrendLaneData['events']> = [];
      for (const v of versionRows(plan)) if (v.version > 1) events.push({ day: daysBetween(from, v.date), kind: 'version', label: `v${v.version}` });
      for (const p of plan.pauses) events.push({ day: daysBetween(from, p.from), kind: 'pause', label: 'paused', endDay: daysBetween(from, p.to ?? t) });
      data.events = events.filter((e) => e.day >= 0 && e.day < n);
      return data;
    },
    drift: () => driftReport(),
    driftCards: () => {
      const r = driftReport();
      return r ? r.goals.map((g) => ({ goal: g.goal, metric: g.metric, state: g.state, goalDate: g.goalDate, causes: g.causes, action: g.action, text: g.text, label: 'Body weight' })) : [];
    },
    adherence: (asOf) => adherenceSummary(asOf),
    checkIn: (asOf) => checkInModel(asOf),
    history: (from, to) => {
      const plan = plans.get();
      if (!plan) return [];
      const out: HistoryDay[] = [];
      const t = today();
      for (let date = compareDates(to, t) > 0 ? t : to; compareDates(date, from) >= 0 && compareDates(date, plan.startDate) >= 0; date = addDays(date, -1)) {
        const score = dayScore(plan, date);
        const rx = prescription(plan, date);
        const local = st.entries.filter((e) => e.date === date).map(summarise);
        const seededEntries =
          seeded(plan) && rx && local.length === 0 && compareDates(date, t) < 0
            ? itemCredits(plan, rx, date)
                .filter((c) => c.credit !== null)
                .map((c) => ({ id: `${date}:${c.itemId}`, kind: (c.itemId.startsWith('rt') || c.itemId.startsWith('cardio') ? 'session' : c.itemId === 'steps' ? 'steps' : c.itemId === 'sleep' ? 'sleep' : c.itemId.startsWith('supplement') ? 'supplement' : 'meal') as LogEntry['kind'], label: c.why, source: 'user' as const, aiEstimated: false }))
            : [];
        out.push({ date, score, final: compareDates(date, t) < 0, assumed: st.assumed.has(date), paused: isPausedOn(plan, date), entries: [...local, ...seededEntries] });
      }
      return out;
    },
    composition: () => compositionOf(),
    versions: () => {
      const plan = plans.get();
      return plan ? versionRows(plan) : [];
    },
    changes: (scope) => {
      const plan = plans.get();
      if (!plan) return [];
      seedChanges(plan);
      return scope === 'today' ? st.changes.filter((c) => c.class === 'edit' || c.class === 'destructive') : st.changes;
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    revision: () => st.rev,
  };

  function driftReport(): DriftReport | null {
    const plan = plans.get();
    if (!plan) return null;
    const t = today();
    const tw = trendSeries(plan, t).get(t);
    const k = daysBetween(plan.startDate, t);
    const real = band(plan, 'realistic', k);
    const gd = goalDates(plan);
    if (tw === undefined || !real) return null;
    const state = tw < real.p10 ? 'ahead' : tw > real.p90 ? 'behind' : 'onTrack';
    const shift = gd ? daysBetween(gd.prescribed, gd.realistic[0]) + 4 : null;
    return {
      asOf: t,
      goals: [
        {
          goal: 1,
          metric: 'scaleWeight',
          target: plan.doc ? null : FIXTURE_WEIGHT.goal,
          trend: { value: tw, sd: 0.3 },
          band: { p10: real.p10, p90: real.p90 },
          state,
          checkInsOutside: 0,
          goalDate: { range: gd?.realistic ?? null, shiftDays: shift, shiftSd: 6 },
          causes: [{ cause: 'adherence', share: 0.7, text: 'Mostly adherence: two of the last six sessions were skipped.' }],
          action: state === 'behind' ? 'easeOptions' : 'keepGoing',
          text: state === 'onTrack' ? 'On track. The goal date moved a little because a few sessions were skipped.' : state === 'ahead' ? 'Ahead of the forecast.' : 'Behind the forecast. An easier plan would keep the goal date.',
        },
      ],
    };
  }

  function adherenceSummary(asOf: LocalDate): AdherenceSummary {
    const plan = plans.get();
    if (!plan) return { a7: null, a28: null, arrow: null, scored28: 0, daysLogged7: 0, blocks: [], costliest: null, learned: [] };
    const tr = adherenceTrend(scoredDays(plan, asOf), asOf);
    const sums = new Map<string, { s: number; n: number }>();
    let worst: { label: string; cost: number; date: LocalDate; weight: number } | null = null;
    for (let k = 0; k < 7; k++) {
      const date = addDays(asOf, -k);
      if (compareDates(date, plan.startDate) < 0) break;
      const s = dayScore(plan, date);
      if (!s) continue;
      for (const it of s.items) {
        if (it.credit === null) continue;
        const b = BLOCKS.find((x) => x.types.includes(it.type));
        if (b) {
          const cur = sums.get(b.id) ?? { s: 0, n: 0 };
          sums.set(b.id, { s: cur.s + it.credit, n: cur.n + 1 });
        }
        const cost = it.weight * (1 - it.credit);
        if (!worst || cost > worst.cost) worst = { label: ITEM_LABEL[it.type], cost, date, weight: it.weight };
      }
      const c = costliestItem(s);
      void c;
    }
    return {
      a7: tr.a7,
      a28: tr.a28,
      arrow: tr.arrow,
      scored28: tr.scored28,
      daysLogged7: tr.daysLogged7,
      blocks: BLOCKS.map((b) => {
        const v = sums.get(b.id);
        return { type: b.types[0]!, label: b.label, mean: v && v.n > 0 ? Math.round((100 * v.s) / v.n) : null, n: v?.n ?? 0 };
      }),
      costliest: worst && worst.cost > 0 ? `${fmtWeekday(worst.date)}’s ${worst.label} carried ${Math.round(worst.weight * 100)} % of the day and was the costliest item this week.` : null,
      learned: seeded(plan) ? ['Friday lifts happen about 1 time in 3. The plan can move them — see the proposal on Today.'] : [],
    };
  }

  function checkInModel(asOf: LocalDate): CheckInModel | null {
    const plan = plans.get();
    if (!plan) return null;
    const w7 = weighIns(plan, asOf).filter((w) => daysBetween(w.date, asOf) < 7 && daysBetween(w.date, asOf) >= 0).length;
    const enough = w7 >= 4;
    const drift = driftReport();
    const g = drift?.goals[0];
    const tw = trendSeries(plan, asOf);
    const wk = tw.get(asOf) !== undefined && tw.get(addDays(asOf, -7)) !== undefined ? tw.get(asOf)! - tw.get(addDays(asOf, -7))! : null;
    const from = addDays(asOf, -13);
    return {
      due: weekdayOf(asOf) === plan.policy.checkInWeekday,
      weekday: fmtWeekday(addDays(plan.startDate, (plan.policy.checkInWeekday - weekdayOf(plan.startDate) + 7) % 7)),
      weighIns7: w7,
      verdict: enough && g ? { state: g.state, goalDate: g.goalDate.range, shiftText: g.goalDate.shiftDays !== null && Math.abs(g.goalDate.shiftDays) >= 3 ? `moved by ${g.goalDate.shiftDays > 0 ? '+' : '−'}${Math.abs(g.goalDate.shiftDays)} days (±${g.goalDate.shiftSd ?? 0})` : null, cause: g.causes[0]?.text ?? '' } : null,
      trendText: wk !== null ? `trend ${wk < 0 ? '−' : '+'}${Math.abs(wk).toFixed(1)} kg this week (likely ${wk < 0 ? '−' : '+'}${Math.abs(wk * 0.5).toFixed(1)} to ${wk < 0 ? '−' : '+'}${Math.abs(wk * 1.5).toFixed(1)})` : 'Not enough weigh-ins for a weekly trend yet.',
      missingText: enough ? null : `We need at least 4 weigh-ins in 7 days, or 10 in 14 days, to read your trend (you have ${w7}). Adherence is below. Weigh in on ${4 - w7} more morning${4 - w7 === 1 ? '' : 's'}.`,
      adherence: adherenceSummary(asOf),
      proposalId: st.changes.find((c) => c.class === 'edit' && c.state === 'pending')?.id ?? null,
      nextDate: addDays(asOf, 7),
      trend: source.trend(compareDates(from, plan.startDate) < 0 ? plan.startDate : from, asOf),
    };
  }

  function compositionOf(): BodyComposition | null {
    const plan = plans.get();
    if (!plan) return null;
    const t = today();
    const tape = st.measurements.filter((m) => m.method === 'tape' || /Cm$/.test(m.metric));
    const label: Record<string, string> = { waistCm: 'waist', hipCm: 'hip', neckCm: 'neck', chestCm: 'chest', armCm: 'arm', thighCm: 'thigh' };
    const girths = tape.map((m) => ({ label: label[m.metric] ?? m.metric, value: m.value, method: m.method ?? 'tape', date: m.date, repeats: m.repeats?.length ?? 1 }));
    if (seeded(plan) && !girths.some((g) => g.label === 'waist')) girths.unshift({ label: 'waist', value: 94.5, method: 'tape', date: addDays(t, -6), repeats: 3 });
    return {
      asOf: addDays(t, -((weekdayOf(t) - plan.policy.checkInWeekday + 7) % 7 || 7)),
      rows: [
        { label: 'fat mass', value: 24.1, lo: 22.9, hi: 25.3, unit: 'kg', decimals: 1, sinceStart: -1.2 },
        { label: 'lean mass', value: 59.3, lo: 58.4, hi: 60.2, unit: 'kg', decimals: 1, sinceStart: -0.2 },
        { label: 'body fat', value: 28.9, lo: 27.6, hi: 30.2, unit: '%', decimals: 1, sinceStart: -1.0 },
      ],
      girths,
    };
  }

  function versionRows(plan: ActivePlan): PlanVersionRow[] {
    const rows: PlanVersionRow[] = [
      { version: 1, reason: 'start', reasonText: 'started', date: plan.startDate, status: plan.headVersion > 1 ? 'superseded' : 'adopted', summary: 'The plan as chosen.', diff: [], goalDates: [] },
    ];
    if (seeded(plan) && plan.headVersion >= 3) {
      rows.push(
        { version: 2, reason: 'light', reasonText: 'small adjustment', date: addDays(plan.startDate, 4), status: 'superseded', summary: 'Next day −5 % energy', diff: [{ date: addDays(plan.startDate, 5), field: 'food energy', before: '2 050 kcal', after: '1 950 kcal', why: 'about 400 kcal more the day before' }], goalDates: [] },
        { version: 3, reason: 'weekly', reasonText: 'weekly check-in', date: addDays(plan.startDate, 7), status: 'adopted', summary: 'Thursday lift moved to Friday', diff: [{ date: addDays(plan.startDate, 10), field: 'session', before: 'Thu lift 45 min', after: 'Fri lift 45 min', why: 'Thursday sessions were done 1 time in 4' }], goalDates: [] },
      );
    }
    return rows.reverse();
  }

  /* ------------------------------------------------------------------ actions */
  const ok = (undo?: () => Promise<ActionOutcome>): ActionOutcome => ({ ok: true, ...(undo ? { undo } : {}) });
  const fail = (message: string): ActionOutcome => ({ ok: false, message });

  function setRow(date: LocalDate, rowId: string, row: RowState | null): () => Promise<ActionOutcome> {
    const prev = st.rows[date]?.[rowId] ?? null;
    const apply = (r: RowState | null) => {
      const day = { ...(st.rows[date] ?? {}) };
      if (r) day[rowId] = r;
      else delete day[rowId];
      st.rows = { ...st.rows, [date]: day };
      bump();
    };
    apply(row);
    return async () => {
      apply(prev);
      return ok();
    };
  }

  function addEntry(e: LogEntry): () => Promise<ActionOutcome> {
    st.entries = [...st.entries, e];
    bump();
    return async () => {
      st.entries = st.entries.filter((x) => x.id !== e.id);
      bump();
      return ok();
    };
  }

  const src = (method: EntrySource['method']): EntrySource => ({ by: 'user', method });

  function mealEntry(date: LocalDate, m: ManualMealInput, rx: PrescribedDaySnapshot | null): LogEntry {
    const slot = m.slot ? rx?.meals.find((x) => x.slot === m.slot) : undefined;
    const rel = m.asPlanned ? 0.1 : 0.15;
    const comps = m.asPlanned && slot
      ? [{ name: `${mealName(slot.slot, slot.clockH)} as planned`, energyKcal: slot.energyKcal, proteinG: slot.proteinG, carbG: slot.carbG, fatG: slot.fatG, grams: undefined as number | undefined }]
      : m.components;
    const est = (v: number | undefined) => ({ value: v ?? 0, sd: (v ?? 0) * rel });
    const components = comps.map((c) => ({
      name: c.name,
      grams: est(c.grams ?? 0),
      nutrients: { energyKcal: est(c.energyKcal), proteinG: est(c.proteinG), carbG: est(c.carbG), fatG: est(c.fatG) },
      nutrientSource: 'user' as const,
    }));
    const sum = (k: 'energyKcal' | 'proteinG' | 'carbG' | 'fatG') => {
      const v = components.reduce((a, c) => a + c.nutrients[k].value, 0);
      const sd = Math.sqrt(components.reduce((a, c) => a + c.nutrients[k].sd ** 2, 0));
      return { value: v, sd };
    };
    return {
      id: nextId('meal'),
      date,
      tz: clock.tz,
      at: nowIso(),
      source: src(m.asPlanned ? 'asPlanned' : 'typed'),
      kind: 'meal',
      clockH: m.clockH,
      ...(m.slot ? { slot: m.slot } : {}),
      components,
      totals: { energyKcal: sum('energyKcal'), proteinG: sum('proteinG'), carbG: sum('carbG'), fatG: sum('fatG') },
      ...(m.text ? { text: m.text } : {}),
    };
  }

  function rowMark(date: LocalDate, rowId: string, mark: RowMark): Promise<ActionOutcome> {
    const plan = plans.get();
    if (!plan) return Promise.resolve(fail('There is no plan running.'));
    if (compareDates(date, today()) > 0) return Promise.resolve(fail('Future days are a preview. You can log them when they come.'));
    const rx = prescription(plan, date);
    if (rowId.startsWith('meal:')) {
      const slot = rowId.slice(5);
      const m = rx?.meals.find((x) => x.slot === slot);
      if (mark === 'asPlanned' && m) {
        const undoEntry = addEntry(mealEntry(date, { slot, clockH: m.clockH, components: [], asPlanned: true }, rx));
        const undoRow = setRow(date, rowId, { mark, credit: 1, method: 'asPlanned' });
        return Promise.resolve(ok(async () => (await undoEntry(), undoRow())));
      }
      if (mark === 'partly' && m) {
        const e = mealEntry(date, { slot, clockH: m.clockH, components: [{ name: `${mealName(slot, m.clockH)}, about half`, energyKcal: m.energyKcal / 2, proteinG: m.proteinG / 2, carbG: m.carbG / 2, fatG: m.fatG / 2 }] }, rx);
        const undoEntry = addEntry(e);
        const undoRow = setRow(date, rowId, { mark, credit: 0.5, method: 'typed' });
        return Promise.resolve(ok(async () => (await undoEntry(), undoRow())));
      }
    }
    return Promise.resolve(ok(setRow(date, rowId, { mark, credit: ROW_CREDIT[mark], method: mark === 'asPlanned' ? 'asPlanned' : 'typed' })));
  }

  function changeEvent(id: string, ev: ChangeEvent): Promise<ActionOutcome> {
    const i = st.changes.findIndex((c) => c.id === id);
    if (i < 0) return Promise.resolve(fail('That change is no longer here.'));
    const before = st.changes[i]!;
    const after = changeCardReducer(before, ev, clock.now());
    if (after === before) return Promise.resolve(fail('That change can’t be done now.'));
    st.changes = st.changes.map((c, k) => (k === i ? after : c));
    bump();
    return Promise.resolve(ok());
  }

  const actions: LivingActions = {
    tick: (date, item) => {
      if (item.kind === 'weigh') return Promise.resolve(fail('Type your weight to log it.'));
      if (item.kind === 'mark') return actions.markDay(date, 'asPlanned');
      return rowMark(date, item.id, 'asPlanned');
    },
    markRow: (date, rowId, mark) => rowMark(date, rowId, mark),
    markDay: (date, mark) => {
      if (!plans.get()) return Promise.resolve(fail('There is no plan running.'));
      const prev = st.dayMarks[date];
      st.dayMarks = { ...st.dayMarks, [date]: mark };
      bump();
      return Promise.resolve(
        ok(async () => {
          const next = { ...st.dayMarks };
          if (prev) next[date] = prev;
          else delete next[date];
          st.dayMarks = next;
          bump();
          return ok();
        }),
      );
    },
    logWeight: (date, kg) => actions.logMeasurement(date, { metric: 'weightKg', value: kg, method: 'scale', context: 'morningFasted' }),
    logMeasurement: (date, m: MeasurementInput) => {
      if (!Number.isFinite(m.value) || m.value <= 0) return Promise.resolve(fail('Enter a number above zero.'));
      if (m.metric === 'weightKg' && (m.value < 30 || m.value > 300)) return Promise.resolve(fail('Weight must be 30–300 kg.'));
      const value = m.repeats && m.repeats.length > 0 ? m.repeats.reduce((a, b) => a + b, 0) / m.repeats.length : m.value;
      const e: MeasurementEntry = { id: nextId('m'), date, at: nowIso(), metric: m.metric, value, ...(m.repeats ? { repeats: m.repeats } : {}), ...(m.method ? { method: m.method } : {}), ...(m.context ? { context: m.context } : {}), source: src('typed') };
      st.measurements = [...st.measurements, e];
      bump();
      return Promise.resolve(
        ok(async () => {
          st.measurements = st.measurements.filter((x) => x.id !== e.id);
          bump();
          return ok();
        }),
      );
    },
    logMeal: (date, meal) => {
      const plan = plans.get();
      if (!plan) return Promise.resolve(fail('There is no plan running.'));
      const rx = prescription(plan, date);
      const undoEntry = addEntry(mealEntry(date, meal, rx));
      if (meal.slot) {
        const undoRow = setRow(date, `meal:${meal.slot}`, { mark: 'asPlanned', credit: 1, method: meal.asPlanned ? 'asPlanned' : 'typed' });
        return Promise.resolve(ok(async () => (await undoEntry(), undoRow())));
      }
      return Promise.resolve(ok(undoEntry));
    },
    logSession: (date, s: SessionLogInput) => {
      const credit = s.credit ?? (s.status === 'done' ? 1 : s.status === 'partial' ? 0.5 : 0);
      const e: LogEntry = {
        id: nextId('session'),
        date,
        tz: clock.tz,
        at: nowIso(),
        source: src('typed'),
        kind: 'session',
        status: s.status,
        performed: s.performed,
        stimulus: { effectiveSetsByRegion: {}, pattern: 'complex', loadClass: 'moderate', netKcal: 0, mem: 0, hiMinutes: 0, mobilityMinutes: {} },
        catalogueVersion: 'seed',
        itemId: s.slotKey,
        ...(s.startH !== undefined ? { startH: s.startH } : {}),
        ...(s.durationMin !== undefined ? { durationMin: s.durationMin } : {}),
        ...(s.rpe !== undefined ? { rpe: s.rpe } : {}),
        ...(s.note ? { text: s.note } : {}),
      };
      const undoEntry = addEntry(e);
      const mark: RowMark = s.status === 'done' && credit >= 0.999 ? 'asPlanned' : s.status === 'skipped' ? 'skipped' : 'partly';
      const undoRow = setRow(date, `session:${s.slotKey}`, { mark, credit, method: 'typed' });
      return Promise.resolve(ok(async () => (await undoEntry(), undoRow())));
    },
    logFastBroken: (date, atH) => {
      const plan = plans.get();
      const rx = plan ? prescription(plan, date) : null;
      const hours = rx?.fast?.hours ?? 16;
      const done = Math.max(0, atH + 24 - (rx?.window?.endH ?? 20));
      return Promise.resolve(ok(setRow(date, 'fast', { mark: done >= hours ? 'asPlanned' : 'partly', credit: Math.min(1, done / hours), method: 'typed' })));
    },
    // a fast typed by hand: the stand-in keeps no fast entries of its own (the row credit comes from `logFastBroken`)
    logFast: () => Promise.resolve(ok()),
    logSteps: (date, steps) => {
      const plan = plans.get();
      const target = (plan && prescription(plan, date)?.steps) || 9000;
      return Promise.resolve(ok(setRow(date, 'steps', { mark: steps >= target ? 'asPlanned' : 'partly', credit: Math.min(1, steps / target), method: 'typed' })));
    },
    logSleep: (date, hours) => {
      const plan = plans.get();
      const sl = plan ? prescription(plan, date)?.sleep : undefined;
      const target = sl ? (sl.wakeH - sl.bedH + 24) % 24 : 7.5;
      return Promise.resolve(ok(setRow(date, 'sleep', { mark: hours >= target ? 'asPlanned' : 'partly', credit: Math.min(1, hours / target), method: 'typed' })));
    },
    logSupplement: (date, id) => Promise.resolve(ok(setRow(date, `supplement:${id}`, { mark: 'asPlanned', credit: 1, method: 'typed' }))),
    logDifficulty: (date, d) => {
      st.difficulty = { ...st.difficulty, [date]: d };
      bump();
      return Promise.resolve(ok());
    },
    retract: (entryId) => {
      const e = st.entries.find((x) => x.id === entryId);
      const m = st.measurements.find((x) => x.id === entryId);
      if (!e && !m) return Promise.resolve(fail('That entry is already gone.'));
      st.entries = st.entries.filter((x) => x.id !== entryId);
      st.measurements = st.measurements.filter((x) => x.id !== entryId);
      bump();
      return Promise.resolve(
        ok(async () => {
          if (e) st.entries = [...st.entries, e];
          if (m) st.measurements = [...st.measurements, m];
          bump();
          return ok();
        }),
      );
    },
    backfill: (dates) => {
      const next = new Set(st.assumed);
      const marks = { ...st.dayMarks };
      for (const d of dates) {
        next.add(d);
        marks[d] = 'asPlanned';
      }
      st.assumed = next;
      st.dayMarks = marks;
      bump();
      return Promise.resolve(ok());
    },
    applyChange: (id) => changeEvent(id, { type: 'apply' }),
    discardChange: (id) => changeEvent(id, { type: 'discard' }),
    undoChange: (id) => changeEvent(id, { type: 'undo' }),
    redoChange: (id) => changeEvent(id, { type: 'redo' }),
    pause: (from, reason) => {
      const plan = plans.get();
      if (!plan || plan.status !== 'active') return Promise.resolve(fail('Only a running plan can be paused.'));
      plans.patch({ status: 'paused', pauses: [...plan.pauses, { from, to: null, ...(reason ? { reason } : {}) }] });
      rxCache.clear();
      bump();
      return Promise.resolve(ok());
    },
    resume: (on) => {
      const plan = plans.get();
      if (!plan || plan.status !== 'paused') return Promise.resolve(fail('The plan isn’t paused.'));
      const open = plan.pauses.find((p) => p.to === null);
      const shift = open ? Math.max(0, daysBetween(open.from, on)) : 0;
      plans.patch({ status: 'active', pauses: plan.pauses.map((p) => (p.to === null ? { ...p, to: on } : p)), plannedEndDate: addDays(plan.plannedEndDate, shift) });
      rxCache.clear();
      bump();
      return Promise.resolve(ok());
    },
    end: (word) => {
      if (word.trim().toLowerCase() !== 'end') return Promise.resolve(fail('Type end to confirm.'));
      if (!plans.get()) return Promise.resolve(fail('There is no plan running.'));
      plans.end(today(), 'abandoned');
      return Promise.resolve(ok());
    },
    discard: () => {
      if (!plans.get()) return Promise.resolve(fail('There is no plan running.'));
      plans.discard();
      return Promise.resolve(ok());
    },
    replanRest: () => {
      const plan = plans.get();
      if (!plan) return Promise.resolve(fail('There is no plan running.'));
      const left = daysBetween(today(), plan.plannedEndDate);
      const g = goalDates(plan);
      const card: ChangeCardModel = {
        id: nextId('chg-replan'),
        class: 'edit',
        title: `Proposal · re-plan the remaining ${left} days`,
        source: { label: 'you · re-plan the rest' },
        createdAt: nowIso(),
        note: 'Same goals and limits, from where you are today.',
        items: [{ label: 'sessions per week', before: '3 lifts · 2 walks', after: '3 lifts · 2 walks' }, { label: 'food energy on rest days', before: '1 850 kcal', after: '1 900 kcal' }],
        impact: g ? { goalDates: [{ label: 'goal date', before: g.realistic, after: [addDays(g.realistic[0], -2), addDays(g.realistic[1], -1)] }], metrics: [] } : { goalDates: [], metrics: [] },
        state: 'pending',
      };
      st.changes = [card, ...st.changes];
      bump();
      return Promise.resolve({ ok: true, message: 'A proposal is waiting on Today.', proposalId: card.id });
    },
    declareEvent: (e) => {
      const plan = plans.get();
      if (!plan) return Promise.resolve(fail('There is no plan running.'));
      if (plan.status !== 'active' && plan.status !== 'scheduled') return Promise.resolve(fail('The plan is paused; resume it first.'));
      if (compareDates(e.to, e.from) < 0) return Promise.resolve(fail('The end date is before the start date.'));
      if (compareDates(e.from, today()) < 0) return Promise.resolve(fail('Days already lived cannot change; pick today or a later day.'));
      const g = goalDates(plan);
      const span = e.from === e.to ? fmtDay(e.from) : fmtDateRange(e.from, e.to);
      const card: ChangeCardModel = {
        id: nextId('chg-event'),
        class: 'edit',
        title: `Proposal · ${EVENT_TITLE[e.kind]} ${span}`,
        source: { label: 'you · busy or away' },
        createdAt: nowIso(),
        note: EVENT_NOTE[e.kind],
        items: [{ label: span, before: 'as planned', after: EVENT_AFTER[e.kind] }],
        impact: g ? { goalDates: [{ label: 'goal date', before: g.realistic, after: e.kind === 'socialMeal' ? g.realistic : [addDays(g.realistic[0], 1), addDays(g.realistic[1], 2)] }], metrics: [] } : { goalDates: [], metrics: [] },
        state: 'pending',
      };
      st.changes = [card, ...st.changes];
      bump();
      return Promise.resolve({ ok: true, message: `${EVENT_NOTE[e.kind]} A proposal is waiting on Today.`, proposalId: card.id });
    },
    shift: (x) => {
      const plan = plans.get();
      if (!plan) return Promise.resolve(fail('There is no plan running.'));
      if (plan.status !== 'active' && plan.status !== 'scheduled') return Promise.resolve(fail('The plan is paused; resume it first.'));
      if (compareDates(x.from, today()) < 0) return Promise.resolve(fail('Days already lived cannot change; pick today or a later day.'));
      const to = addDays(x.from, x.days - 1);
      const span = x.days === 1 ? fmtDay(x.from) : fmtDateRange(x.from, to);
      const back = x.mode === 'pushBack';
      const card: ChangeCardModel = {
        id: nextId('chg-shift'),
        class: 'edit',
        title: back ? `Proposal · push the plan back ${x.days} day${x.days === 1 ? '' : 's'}` : `Proposal · change ${span}`,
        source: { label: 'you · busy or away' },
        createdAt: nowIso(),
        note: back ? 'Your usual days on those dates; the rest of the plan moves later.' : 'Those days change; the rest is fitted around them.',
        items: back ? [{ label: 'plan end', before: fmtDay(addDays(plan.plannedEndDate, -1)), after: fmtDay(addDays(plan.plannedEndDate, x.days - 1)) }] : [{ label: span, before: 'as planned', after: x.mode === 'habitual' ? 'your usual day' : 'no training' }],
        impact: { goalDates: [], metrics: [] },
        state: 'pending',
      };
      st.changes = [card, ...st.changes];
      bump();
      return Promise.resolve({ ok: true, message: 'A proposal is waiting on Today.', proposalId: card.id });
    },
    swapExercise: (date, s) => {
      const plan = plans.get();
      if (!plan) return Promise.resolve(fail('There is no plan running.'));
      // the stand-in keeps a day's swap on the Train screen only; every week leaves a proposal card
      if (!s.everyWeek) return Promise.resolve(ok());
      const card: ChangeCardModel = {
        id: nextId('chg-swap'),
        class: 'edit',
        title: `Proposal · use this swap every ${fmtWeekday(date)}`,
        source: { label: 'you · Train' },
        createdAt: nowIso(),
        note: 'Your sessions on that weekday use the swapped exercise from then on.',
        items: [{ label: `${fmtWeekday(date)} sessions`, before: 'as prescribed', after: 'with your swap' }],
        impact: { goalDates: [], metrics: [] },
        state: 'pending',
      };
      st.changes = [card, ...st.changes];
      bump();
      return Promise.resolve({ ok: true, message: 'A proposal is waiting on Today.', proposalId: card.id });
    },
    checkIn: () => Promise.resolve(ok()),
    setQuietMode: (on) => {
      st.quietMode = on;
      bump();
      return Promise.resolve(ok());
    },
    setAutoEase: (on) => {
      const plan = plans.get();
      if (plan) plans.patch({ policy: { ...plan.policy, autoApplyLoadLowering: on } });
      st.autoEase = on;
      bump();
      return Promise.resolve(ok());
    },
  };

  return {
    source,
    actions,
    inspect: () => ({ ...st, assumed: [...st.assumed] }),
    reset: () => {
      st = blank();
      rxCache.clear();
      bump();
    },
  };
}
