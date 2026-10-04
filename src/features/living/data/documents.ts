/**
 * The read side of Living mode over the plan and log documents (E4's store, E5's pure functions): every screen reads the
 * same `projectLiving` the commands use (`today.get`, `plan.drift`, `plan.adherence`), so what a command writes is what
 * the next render shows. Installed by `../boot.ts` together with the command-backed actions (`./commands.ts`) whenever
 * the app's mode comes from the plan documents (`installDocumentPlanSource`).
 *
 * Cost: one full projection (with the engine replay) per revision for the current day — Today, the trend lane, drift
 * and the check-in read it; other dates use the fast path (no replay). The revision bumps on changes to the plan and
 * log collections only (not `derived`, which the daily assimilation rewrites), on the store finishing its load and on a
 * storage-engine switch.
 */
import { readLivingDocs } from '@/commands';
import { observationAdapter, sessionCompiler } from '@/commands/livingWiring';
import {
  addDays,
  compareDates,
  daysBetween,
  headAdopted,
  openProposals,
  isLive,
  planDay,
  projectLiving,
  projectEntries,
  summarise,
  weekdayOf,
  type DriftReport,
  type LivingDocs,
  type LivingProjection,
  type LogEntry,
  type MeasurementEntry,
  type LocalDate,
  type PlanItemType,
  type PlanVersionDoc,
  type TodayView,
  type VersionReason,
} from '@/living';
import type { TrendLaneData } from '@/features/charts/living/types';
import type { DocumentStore } from '@/store';
import { getDocumentStore, onDocumentStoreSwitch } from '@/state/runtime';
import { useSafetyStore } from '@/state/safetyStore';
import { useSettingsStore } from '@/state/settingsStore';
import { currentDay, systemClock, type LivingClock } from '../clock';
import { fmtClock, fmtDateRange, fmtWeekday } from '../format';
import type { ChangeCardModel } from '../model/changeCard';
import type { LivingDataSource } from './source';
import type { AdherenceSummary, BodyComposition, CheckInModel, DayGlance, DriftCard, HistoryConflict, HistoryDay, PlanVersionRow } from './types';

/** Collections whose changes move what Living screens show. */
export const LIVING_COLLECTIONS: ReadonlySet<string> = new Set(['activePlan', 'plans', 'planVersions', 'dailyLogs', 'measurements', 'dayStatus', 'anchors', 'settings']);

const REASON_TEXT: Record<VersionReason, string> = {
  start: 'started',
  light: 'small adjustment',
  weekly: 'weekly check-in',
  event: 'event',
  user: 'your change',
  coach: 'Coach change',
  pause: 'paused',
  resume: 'resumed',
  safety: 'safety',
};

const BLOCKS: Array<{ label: string; types: PlanItemType[] }> = [
  { label: 'training', types: ['rtSession', 'cardioSession'] },
  { label: 'protein', types: ['protein'] },
  { label: 'energy', types: ['energy'] },
  { label: 'fasting', types: ['fast', 'window'] },
  { label: 'steps', types: ['steps'] },
];

const EMPTY_ADHERENCE: AdherenceSummary = { a7: null, a28: null, arrow: null, scored28: 0, daysLogged7: 0, blocks: [], costliest: null, learned: [] };

/** Proposal cards carry the plan version they adopt or reject. */
export function proposalCardId(planId: string, version: number): string {
  return `version:${planId}:${version}`;
}
export function parseProposalCardId(id: string): { planId: string; version: number } | null {
  const m = /^version:(.+):(\d+)$/.exec(id);
  return m ? { planId: m[1]!, version: Number(m[2]) } : null;
}

/** Include logged dates outside the active plan so a moved conflict stays reviewable. */
export function historyDates(planDates: readonly LocalDate[], entries: readonly { date: LocalDate }[], measurements: readonly { date: LocalDate }[], from: LocalDate, to: LocalDate): LocalDate[] {
  return [...new Set([...planDates, ...entries.map((e) => e.date), ...measurements.map((m) => m.date)])]
    .filter((date) => compareDates(date, from) >= 0 && compareDates(date, to) <= 0)
    .sort((a, b) => compareDates(b, a));
}

export interface DocumentLivingOptions {
  clock?: LivingClock;
  getStore?: () => DocumentStore;
  onSwitch?: (fn: (s: DocumentStore) => void) => () => void;
  /** The documents (tests); default `readLivingDocs` over the app's store. */
  read?: (range: { from: LocalDate; to: LocalDate }) => LivingDocs;
}

export function createDocumentLivingSource(opts: DocumentLivingOptions = {}): LivingDataSource {
  const clock = opts.clock ?? systemClock;
  const getStore = opts.getStore ?? getDocumentStore;
  const read = opts.read ?? ((range) => readLivingDocs(observationAdapter, range));
  const listeners = new Set<() => void>();
  let rev = 0;
  let attached: DocumentStore | null = null;
  let off: (() => void) | null = null;
  // per revision: the documents and the projections by date
  let cacheRev = -1;
  let docsCache: LivingDocs | null = null;
  const projections = new Map<string, LivingProjection>();

  const bump = () => {
    rev++;
    listeners.forEach((l) => l());
  };
  const attach = (store: DocumentStore) => {
    off?.();
    attached = store;
    off = store.subscribe((c) => {
      if (LIVING_COLLECTIONS.has(c.col)) bump();
    });
    const loaded = () => attached === store && bump();
    store.ready.then(loaded, loaded);
  };
  const current = () => {
    const s = getStore();
    if (s !== attached) attach(s);
  };
  current();
  (opts.onSwitch ?? onDocumentStoreSwitch)((s) => {
    attach(s);
    bump();
  });
  // the projection reads quiet mode from the settings store, which loads after the documents (and changes from
  // Settings): a change there is a new revision too (Q4-17)
  useSettingsStore.subscribe((s, p) => {
    if (s.quietMode !== p.quietMode || s.quietModeSet !== p.quietModeSet) bump();
  });
  // quiet mode is on by default in safety mode R1, so new safety answers can change it too
  useSafetyStore.subscribe((s, p) => {
    if (s.answers !== p.answers) bump();
  });

  const today = () => currentDay(clock);
  const fresh = () => {
    current();
    if (cacheRev !== rev) {
      cacheRev = rev;
      docsCache = null;
      projections.clear();
    }
  };
  const docs = (): LivingDocs => {
    fresh();
    const t = today();
    docsCache ??= read({ from: addDays(t, -60), to: t });
    return docsCache;
  };
  const livePlan = () => {
    const p = docs().plan;
    return p && isLive(p) ? p : null;
  };
  /** The projection "as of" a date; the full one (replay, drift) only for the current day. */
  const project = (date: LocalDate = today()): LivingProjection => {
    fresh();
    const full = date === today();
    const key = `${date}|${full}`;
    let p = projections.get(key);
    if (!p) {
      p = projectLiving({ docs: docs(), today: date, tz: clock.tz, now: clock.now().toISOString(), sessionCompiler, ...(full ? {} : { skipAssimilation: true }) });
      projections.set(key, p);
    }
    return p;
  };

  const isPaused = (date: LocalDate) => {
    const plan = livePlan();
    return !!plan && plan.pauses.some((p) => compareDates(date, p.from) >= 0 && (p.to === null || compareDates(date, p.to) < 0));
  };
  const loggedOn = (date: LocalDate) => {
    const d = docs();
    return d.entries.some((e) => e.date === date && e.kind !== 'retract') || d.measurements.some((m) => m.date === date) || d.dayStatus.some((s) => s.date === date && s.marks !== undefined && !s.assumed);
  };
  const weighIns = (from: LocalDate, to: LocalDate) =>
    projectEntries(docs().measurements)
      .filter((m) => m.metric === 'weightKg' && compareDates(m.date, from) >= 0 && compareDates(m.date, to) <= 0)
      .sort((a, b) => ((a.at ?? '') < (b.at ?? '') ? -1 : 1));

  function driftReport(): DriftReport | null {
    return livePlan() ? project().drift : null;
  }

  function trend(from: LocalDate, to: LocalDate): TrendLaneData | null {
    const plan = livePlan();
    if (!plan) return null;
    const t = today();
    const p = project();
    const head = p.head;
    const n = daysBetween(from, to) + 1;
    const byDay = new Map((p.assimilation?.points ?? []).map((x) => [x.day, x] as const));
    const series = (which: 'asPrescribed' | 'realistic', k: number) => {
      const f = head?.forecast;
      const s = f ? (f[which].scaleWeight ?? f.asPrescribed.scaleWeight) : undefined;
      const i = k - (f?.fromDay ?? 0);
      return s && i >= 0 && i < s.p50.length ? { p10: s.p10[i]!, p50: s.p50[i]!, p90: s.p90[i]! } : null;
    };
    const data: TrendLaneData = {
      startDate: from,
      days: n,
      todayIndex: compareDates(t, from) >= 0 && compareDates(t, to) <= 0 ? daysBetween(from, t) : null,
      unit: 'kg',
      decimals: 1,
      weighIns: weighIns(from, compareDates(to, t) < 0 ? to : t).map((w) => ({ day: daysBetween(from, w.date), value: w.value })),
      trend: [],
      trendSd: [],
      realistic: { p10: [], p50: [], p90: [] },
      asPrescribed: { p10: [], p90: [] },
    };
    for (let i = 0; i < n; i++) {
      const k = planDay(plan, addDays(from, i));
      const pt = byDay.get(k);
      data.trend.push(pt ? pt.w : NaN);
      data.trendSd!.push(pt ? pt.wSd : NaN);
      const r = k >= 0 ? series('realistic', k) : null;
      const a = k >= 0 ? series('asPrescribed', k) : null;
      data.realistic!.p10.push(r?.p10 ?? NaN);
      data.realistic!.p50!.push(r?.p50 ?? NaN);
      data.realistic!.p90.push(r?.p90 ?? NaN);
      data.asPrescribed!.p10.push(a?.p10 ?? NaN);
      data.asPrescribed!.p90.push(a?.p90 ?? NaN);
    }
    const goal = plan.request.goals.find((g) => g.metric === 'scaleWeight' && g.target !== undefined);
    if (goal?.target !== undefined) data.goal = { value: goal.target, label: `goal ${goal.target} kg` };
    const range = head?.forecast.goals.find((g) => g.dateRange)?.dateRange;
    if (range) data.goalDateRange = { from: range[0], to: range[1], label: `likely ${fmtDateRange(range[0], range[1])}` };
    const events: NonNullable<TrendLaneData['events']> = [];
    for (const v of versionRows()) if (v.version > 1 && v.status !== 'proposed' && v.status !== 'rejected') events.push({ day: daysBetween(from, v.date), kind: 'version', label: `v${v.version}` });
    for (const pz of plan.pauses) events.push({ day: daysBetween(from, pz.from), kind: 'pause', label: 'paused', endDay: daysBetween(from, pz.to ?? t) });
    data.events = events.filter((e) => e.day >= 0 && e.day < n);
    return data;
  }

  function adherence(asOf: LocalDate): AdherenceSummary {
    if (!livePlan()) return EMPTY_ADHERENCE;
    const p = project(compareDates(asOf, today()) > 0 ? today() : asOf);
    const week = p.days.filter((d) => daysBetween(d.date, asOf) >= 0 && daysBetween(d.date, asOf) < 7);
    let worst: { label: string; cost: number; date: LocalDate; weight: number } | null = null;
    const sums = BLOCKS.map(() => ({ s: 0, n: 0 }));
    for (const d of week) {
      for (const it of d.result.score.items) {
        if (it.credit === null) continue;
        const b = BLOCKS.findIndex((x) => x.types.includes(it.type));
        if (b >= 0) {
          sums[b]!.s += it.credit;
          sums[b]!.n += 1;
        }
        const cost = it.weight * (1 - it.credit);
        if (!worst || cost > worst.cost) worst = { label: it.why || it.type, cost, date: d.date, weight: it.weight };
      }
    }
    const w = worst as { label: string; cost: number; date: LocalDate; weight: number } | null;
    return {
      a7: p.trend.a7,
      a28: p.trend.a28,
      arrow: p.trend.arrow,
      scored28: p.trend.scored28,
      daysLogged7: p.trend.daysLogged7,
      blocks: BLOCKS.map((b, i) => ({ type: b.types[0]!, label: b.label, mean: sums[i]!.n > 0 ? Math.round((100 * sums[i]!.s) / sums[i]!.n) : null, n: sums[i]!.n })),
      costliest: w && w.cost > 0 ? `${fmtWeekday(w.date)}’s ${w.label} carried ${Math.round(w.weight * 100)} % of the day and was the costliest item this week.` : null,
      learned: [],
    };
  }

  function checkIn(asOf: LocalDate): CheckInModel | null {
    const plan = livePlan();
    if (!plan) return null;
    const p = project();
    const w7 = weighIns(addDays(asOf, -6), asOf).length;
    const enough = w7 >= 4;
    const g = p.drift?.goals[0];
    const pts = p.assimilation?.points ?? [];
    const at = (date: LocalDate) => pts.find((x) => x.day === planDay(plan, date))?.w;
    const now = at(asOf);
    const before = at(addDays(asOf, -7));
    const wk = now !== undefined && before !== undefined ? now - before : null;
    const sign = (v: number) => (v < 0 ? '−' : '+');
    const from = addDays(asOf, -13);
    const proposal = changes('all').find((c) => c.state === 'pending');
    return {
      due: p.checkInDue,
      weekday: fmtWeekday(addDays(plan.startDate, (plan.policy.checkInWeekday - weekdayOf(plan.startDate) + 7) % 7)),
      weighIns7: w7,
      verdict:
        enough && g
          ? {
              state: g.state,
              goalDate: g.goalDate.range,
              shiftText: g.goalDate.shiftDays !== null && Math.abs(g.goalDate.shiftDays) >= 3 ? `moved by ${sign(g.goalDate.shiftDays)}${Math.abs(g.goalDate.shiftDays)} days (±${g.goalDate.shiftSd ?? 0})` : null,
              cause: g.causes[0]?.text ?? '',
            }
          : null,
      trendText: wk !== null ? `trend ${sign(wk)}${Math.abs(wk).toFixed(1)} kg this week` : 'Not enough weigh-ins for a weekly trend yet.',
      missingText: enough ? null : `We need at least 4 weigh-ins in 7 days, or 10 in 14 days, to read your trend (you have ${w7}). Adherence is below. Weigh in on ${4 - w7} more morning${4 - w7 === 1 ? '' : 's'}.`,
      adherence: adherence(asOf),
      proposalId: proposal?.id ?? null,
      nextDate: addDays(asOf, 7),
      trend: trend(compareDates(from, plan.startDate) < 0 ? plan.startDate : from, asOf),
    };
  }

  function history(from: LocalDate, to: LocalDate): HistoryDay[] {
    const t = today();
    const d = docs();
    const entries = projectEntries(d.entries).filter((e) => e.kind !== 'retract');
    const measurements = projectEntries(d.measurements);
    const assumed = new Set(d.dayStatus.filter((s) => s.assumed).map((s) => s.date));
    const versionLabel = (e: LogEntry): string => {
      const parts = [e.date, summarise(e).label];
      if ('clockH' in e && typeof e.clockH === 'number') parts.push(fmtClock(e.clockH));
      if (e.kind === 'meal') {
        if (e.slot) parts.push(e.slot.replace(/([a-z])(\d)/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()));
        if (e.complete !== undefined) parts.push(e.complete ? 'meal complete' : 'meal unfinished');
      }
      if (e.kind === 'session') {
        if (e.startH !== undefined) parts.push(fmtClock(e.startH));
        if (e.durationMin !== undefined) parts.push(`${e.durationMin} min`);
        if (e.rpe !== undefined) parts.push(`effort ${e.rpe}`);
        if (e.performed.length) parts.push(e.performed.map((p) => [p.freeText ?? p.exerciseId, p.setCount ? `${p.setCount} sets` : undefined, p.loadKg !== undefined ? `${p.loadKg} kg` : undefined].filter(Boolean).join(' ')).join(', '));
      }
      if (e.kind === 'sleep') parts.push(`${e.bedAt}–${e.wakeAt}${e.quality ? ` · ${e.quality}` : ''}`);
      if (e.kind === 'fast') {
        parts.push(`${e.lastIntakeAt}–${e.firstIntakeAt ?? 'ongoing'}`);
        if (e.electrolytes !== undefined) parts.push(e.electrolytes ? 'with electrolytes' : 'without electrolytes');
      }
      if (e.kind === 'substance') parts.push(`${e.amount} ${e.unit}`);
      if (e.kind === 'supplement') parts.push(`${e.dose} ${e.unit}`);
      if (e.kind === 'subjective') {
        for (const field of ['difficulty', 'hunger', 'energy', 'mood', 'stress'] as const) {
          if (e[field] !== undefined) parts.push(`${field} ${e[field]}`);
        }
        if (e.illness !== undefined) parts.push(e.illness ? 'feeling ill' : 'not feeling ill');
      }
      if (e.kind === 'event' && e.to) parts.push(`through ${e.to}`);
      if (e.text) parts.push(e.text);
      return parts.join(' · ');
    };
    const measurementLabel = (m: MeasurementEntry): string => {
      const units: Record<string, string> = { Kg: 'kg', Cm: 'cm', Pct: '%', MmHg: 'mmHg', MmolL: 'mmol/L', MgL: 'mg/L', gL: 'g/L' };
      const suffix = Object.keys(units).find((u) => m.metric.endsWith(u));
      const metric = (suffix ? m.metric.slice(0, -suffix.length) : m.metric).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      return [
        m.date,
        `${metric} ${m.value}${suffix ? ` ${units[suffix]}` : ''}`,
        m.method,
        m.context?.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(),
        m.repeats?.length ? `${m.repeats.length} readings` : undefined,
      ].filter(Boolean).join(' · ');
    };
    const conflictsOn = (date: LocalDate): HistoryConflict[] => [
      ...entries.filter((e) => e.date === date && e.conflict).map((e): HistoryConflict => ({
        parentId: e.conflict!.parentId,
        kind: e.kind === 'meal' ? 'meal' : e.kind === 'session' ? 'workout' : 'entry',
        versions: e.conflict!.versions.map((v) => {
          const summary = summarise(v);
          return { id: v.id, label: versionLabel(v), ...(v.at ? { at: v.at } : {}), source: summary.source, ...(v.kind === 'meal' ? { energyKcal: v.totals.energyKcal.value } : {}) };
        }),
      })),
      ...measurements.filter((m) => m.date === date && m.conflict).map((m): HistoryConflict => ({
        parentId: m.conflict!.parentId,
        kind: 'measurement',
        versions: m.conflict!.versions.map((v) => ({
          id: v.id,
          label: measurementLabel(v),
          ...(v.at ? { at: v.at } : {}),
          source: v.source.by,
        })),
      })),
    ];
    const entriesOn = (date: LocalDate) => entries.filter((e) => e.date === date).map((e) => ({
      ...summarise(e),
      ...(e.conflict ? { conflict: { parentId: e.conflict.parentId, versions: e.conflict.versions.map(summarise) } } : {}),
    }));
    const planDays = livePlan() ? project().days : [];
    const byDate = new Map(planDays.map((x) => [x.date, x] as const));
    return historyDates(planDays.map((x) => x.date), entries, measurements, from, to).map((date) => {
      const x = byDate.get(date);
      return {
        date,
        score: x?.result.score ?? null,
        final: compareDates(date, t) < 0 || !!x?.result.score.final,
        assumed: assumed.has(date),
        paused: !!x?.prescription.paused,
        entries: entriesOn(date),
        conflicts: conflictsOn(date),
      };
    });
  }

  function composition(): BodyComposition | null {
    const plan = livePlan();
    if (!plan) return null;
    const d = docs();
    const label: Record<string, string> = { waistCm: 'waist', hipCm: 'hip', neckCm: 'neck', chestCm: 'chest', armCm: 'arm', thighCm: 'thigh' };
    const girths = projectEntries(d.measurements)
      .filter((m) => label[m.metric])
      .map((m) => ({ label: label[m.metric]!, value: m.value, method: m.method ?? 'tape', date: m.date, repeats: m.repeats?.length ?? 1 }));
    const records = [...d.records].sort((a, b) => a.anchorDay - b.anchorDay);
    const last = records[records.length - 1];
    if (!last && girths.length === 0) return null;
    const first = records[0];
    const rows: BodyComposition['rows'] = [];
    if (last) {
      const sd = last.trendWeight.sd;
      const fat = last.residualSplit.fatKg;
      const lean = last.residualSplit.leanKg;
      const total = last.trendWeight.kg;
      rows.push({ label: 'fat mass', value: fat, lo: fat - sd, hi: fat + sd, unit: 'kg', decimals: 1, sinceStart: first && first !== last ? fat - first.residualSplit.fatKg : null });
      rows.push({ label: 'lean mass', value: lean, lo: lean - sd, hi: lean + sd, unit: 'kg', decimals: 1, sinceStart: first && first !== last ? lean - first.residualSplit.leanKg : null });
      if (total > 0) rows.push({ label: 'body fat', value: (100 * fat) / total, lo: (100 * (fat - sd)) / total, hi: (100 * (fat + sd)) / total, unit: '%', decimals: 1, sinceStart: null });
    }
    return { asOf: last?.anchorDate ?? today(), rows, girths };
  }

  function versionDocs(): PlanVersionDoc[] {
    return [...docs().versions].sort((a, b) => a.version - b.version);
  }

  function versionRows(): PlanVersionRow[] {
    const plan = livePlan();
    if (!plan) return [];
    const head = headAdopted(docs().versions);
    return versionDocs()
      .map((v): PlanVersionRow => ({
        version: v.version,
        reason: v.reason,
        reasonText: REASON_TEXT[v.reason] ?? v.reason,
        date: v.effectiveFromDay > 0 ? addDays(plan.startDate, v.effectiveFromDay) : (v.createdAt.slice(0, 10) < plan.startDate ? plan.startDate : v.createdAt.slice(0, 10)),
        status: v.status === 'adopted' && head && v.version !== head.version ? 'superseded' : v.status,
        summary: v.explanation[0] ?? (v.reason === 'start' ? 'The plan as chosen.' : ''),
        diff: (v.diff ?? []).map((r) => ({ date: r.date, field: r.field, before: r.before, after: r.after, why: r.why })),
        goalDates: v.forecast.goals.map((g) => ({ label: g.metric === 'scaleWeight' ? 'body weight' : g.metric, range: g.dateRange })),
      }))
      .reverse();
  }

  function changes(scope: 'today' | 'all'): ChangeCardModel[] {
    const plan = livePlan();
    if (!plan) return [];
    void scope; // proposals show on Today and in the Coach alike
    const head = headAdopted(docs().versions);
    const before = head?.forecast.goals.find((g) => g.dateRange)?.dateRange ?? null;
    return openProposals(versionDocs())
      .reverse()
      .map((v): ChangeCardModel => {
        const after = v.forecast.goals.find((g) => g.dateRange)?.dateRange ?? null;
        return {
          id: proposalCardId(plan.id, v.version),
          class: 'edit',
          title: `Proposal · ${v.explanation[0] ?? REASON_TEXT[v.reason]}`,
          source: { label: `the plan · ${REASON_TEXT[v.reason]}` },
          createdAt: v.createdAt,
          items: (v.diff ?? []).map((r) => ({ label: `${r.date} ${r.field}`, before: r.before, after: r.after })),
          ...(before || after ? { impact: { goalDates: [{ label: 'goal date', before, after }], metrics: [] } } : {}),
          ...(v.explanation.length > 1 ? { note: v.explanation.slice(1).join(' ') } : {}),
          state: 'pending',
        };
      });
  }

  return {
    today: (date): TodayView | null => (livePlan() ? project(date).today : null),
    days: (dates) => {
      const plan = livePlan();
      const byDate = plan ? new Map(project().days.map((x) => [x.date, x] as const)) : new Map();
      const assumed = new Set(docs().dayStatus.filter((s) => s.assumed).map((s) => s.date));
      return dates.map((date): DayGlance => {
        const inPlan = !!plan && compareDates(date, plan.startDate) >= 0 && compareDates(date, plan.plannedEndDate) < 0;
        return {
          date,
          inPlan,
          isStart: !!plan && date === plan.startDate,
          isEnd: !!plan && date === addDays(plan.plannedEndDate, -1),
          paused: isPaused(date),
          assumed: assumed.has(date),
          logged: inPlan && loggedOn(date),
          score: inPlan ? (byDate.get(date)?.result.score ?? null) : null,
        };
      });
    },
    trend,
    drift: driftReport,
    driftCards: (): DriftCard[] => (driftReport()?.goals ?? []).map((g) => ({ goal: g.goal, metric: g.metric, state: g.state, goalDate: g.goalDate, causes: g.causes, action: g.action, text: g.text, label: g.metric === 'scaleWeight' ? 'Body weight' : g.metric })),
    adherence,
    checkIn,
    history,
    composition,
    versions: versionRows,
    changes,
    subscribe: (l) => {
      current();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    revision: () => {
      current();
      return rev;
    },
  };
}
