/**
 * Where the Ring page's today rows and every Body signals chart get their data: one `SignalsSource` behind a React
 * context. The default reads the biometrics index (records the person brought in, per the stream policy, resolved one
 * value per metric per day) and the `bio.series` / `bio.baselines` read commands. Tests and the screenshot fixtures
 * pass their own source to `SignalsSourceProvider`; in a dev build `window.__VITALS_PAGES_FIXTURE__` may name one (the
 * Playwright screenshots use it; a production build never reads it).
 *
 * Nothing is filled in here: a day with no record is absent from `days()` (the charts draw it as missing), a series
 * gap stays a gap, a stage the ring could not classify stays "unknown".
 */
import { createContext, createElement, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { readLivingDocs } from '@/commands'; // the registry: registers the commands sent here
import { sendCommand } from '@/features/lib/sendCommand';
import { getDocumentStore } from '@/state/runtime';
import { useProfileStore } from '@/state/profileStore';
import { useSettingsStore } from '@/state/settingsStore';
import { isLive, planDay, templateOfDay, versionInForce, type LivingDocs } from '@/living';
import { sharedBioIndex, type BioDocIndex } from '@/biometrics/store/docIndex';
import { effectivePolicy } from '@/biometrics/core/effective';
import { resolveDays } from '@/biometrics/core/resolve';
import { policyStreamOf } from '@/biometrics/core/source';
import type { BioRecord, ResolvedDay } from '@/biometrics/core/types';
import type { LocalDate } from '@/living';
import type { SeriesPoint } from './charts/ringData';

export type SeriesMetric = 'hr' | 'hrv' | 'spo2' | 'skin_temp' | 'steps' | 'battery';

/** A personal normal (bio.baselines): mean and likely range, forming until 14 nights. */
export interface SignalBaseline {
  metric: string;
  unit: string;
  mean: number;
  lo: number;
  hi: number;
  nights: number;
  forming: boolean;
}

/** What the person told Vitals that the charts need. Absent = not set (never invented). */
export interface SignalsPerson {
  ageYears?: number;
  /** Their own measured maximum heart rate, if they set one. */
  maxHr?: number;
  goals: { steps?: number; activeMin?: number; activeKcal?: number; sleepH?: number };
  /** Ring-maker scores are shown as "Your ring says …" (Settings › Devices, stream `vendor_scores`). */
  vendorScores: boolean;
  /** 'C' or 'F' for skin temperature. */
  tempUnit: 'C' | 'F';
}

export interface SignalsSourceInfo {
  /** Labels of the sources that fed records in [from, to] ("J-Style 2301", "an Apple Health import"). */
  labels: string[];
  /** Newest read of any ring source (ms), if known. */
  lastReadAt: number | null;
}

export interface SignalsSource {
  /** Bumps whenever stored records change (charts update in place). */
  subscribe(fn: () => void): () => void;
  revision(): number;
  /** Resolved days in [from, to] (inclusive), oldest first; days without any record are absent. */
  days(from: LocalDate, to: LocalDate): ResolvedDay[];
  /** Raw samples of one stream in [fromMs, toMs]. `dates` are the local dates the window touches. */
  series(metric: SeriesMetric, fromMs: number, toMs: number, dates: readonly LocalDate[]): Promise<SeriesPoint[]>;
  baselines(): Promise<SignalBaseline[]>;
  /** The first date with any ring or import record (‹ stops there); null when nothing is stored. */
  firstDate(): LocalDate | null;
  /** Dates with any record (the calendar popover's dots). */
  datesWithData(): LocalDate[];
  person(): SignalsPerson;
  sourceInfo(from: LocalDate, to: LocalDate): SignalsSourceInfo;
}

/* ------------------------------------------------------------------------------------------------ store source */

const index = (): BioDocIndex => sharedBioIndex(getDocumentStore());

function broughtIn(ix: BioDocIndex, from: LocalDate, to: LocalDate): Array<{ sourceKey: string; record: BioRecord }> {
  return ix
    .latestRecords(from, to)
    .filter((e) => effectivePolicy(ix.source(e.sourceKey) ?? { policies: [] }, ix.personPolicies, policyStreamOf(e.record)).imported)
    .map((e) => ({ sourceKey: e.sourceKey, record: e.record }));
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const calendarToday = (): LocalDate => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/**
 * The plan's goals on `date` (Plan/Goals): steps and sleep hours from the day's frozen prescription, else from the
 * version in force. Nothing on a paused day, before the plan starts or without a live plan. The plan has no active
 * minutes or active energy target, so those stay absent: no default is ever invented.
 */
export function planGoalsOn(docs: Pick<LivingDocs, 'plan' | 'versions' | 'dayStatus'>, date: LocalDate): SignalsPerson['goals'] {
  const plan = docs.plan;
  if (!plan || !isLive(plan) || date < plan.startDate) return {};
  const out: SignalsPerson['goals'] = {};
  const put = (k: 'steps' | 'sleepH', v: number | undefined) => {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
  };
  const frozen = docs.dayStatus.find((s) => s.date === date && (s.planId === undefined || s.planId === plan.id))?.prescribed;
  if (frozen) {
    if (frozen.paused) return {};
    put('steps', frozen.items.find((i) => i.itemId === 'steps')?.target.steps ?? frozen.steps);
    put('sleepH', frozen.items.find((i) => i.itemId === 'sleep')?.target.hours);
    return out;
  }
  if (plan.pauses.some((p) => date >= p.from && (p.to === null || date < p.to))) return {};
  const d = planDay(plan, date);
  const v = versionInForce(docs.versions, d);
  if (!v) return {};
  const t = templateOfDay(v.schedule, d);
  put('steps', t.steps);
  const s = t.sleep;
  put('sleepH', s?.hours ?? (s?.bedH !== undefined && s?.wakeH !== undefined ? (s.wakeH - s.bedH + 24) % 24 : undefined));
  return out;
}

/** Ring-maker scores are shown when the stream `vendor_scores` is brought in for any source (Settings › Devices). */
function vendorScoresOn(ix: BioDocIndex): boolean {
  return ix.sources().some((s) => effectivePolicy(s, ix.personPolicies, 'vendor_scores').imported);
}

/** The default source: the person's stored records. */
export function storeSignalsSource(): SignalsSource {
  return {
    subscribe: (fn) => index().subscribe(fn),
    revision: () => index().revision(),
    days(from, to) {
      const ix = index();
      return resolveDays(broughtIn(ix, from, to), ix.sources(), { from, to }).filter(
        (d) => d.daily || d.mainSleep || d.sleeps.length || d.workouts.length || d.spots.length,
      );
    },
    async series(metric, fromMs, toMs, dates) {
      if (!dates.length) return [];
      // bio.series keeps only the newest 5 000 raw samples of one answer, so a window of several days (a week or a
      // month of heart rate) is read one local date at a time: the earlier days would otherwise silently drop out
      const answers = await Promise.all(
        [...new Set(dates)].sort().map((d) => sendCommand('bio.series', { metric, from: d, to: d, resolution: 'raw' }, { silent: true })),
      );
      const out: SeriesPoint[] = [];
      for (const r of answers) {
        if (!r.ok || !('output' in r)) throw new Error('series unavailable');
        for (const p of (r.output as { points?: Array<{ t: string; value: number }> }).points ?? []) {
          const t = Date.parse(p.t);
          if (Number.isFinite(t) && Number.isFinite(p.value) && t >= fromMs && t <= toMs) out.push({ t, v: p.value });
        }
      }
      return out.sort((a, b) => a.t - b.t);
    },
    async baselines() {
      const r = await sendCommand('bio.baselines', {}, { silent: true });
      if (!r.ok || !('output' in r)) return [];
      return (r.output as { baselines: SignalBaseline[] }).baselines;
    },
    firstDate() {
      const ds = index().dates();
      return ds.length ? [...ds].sort()[0]! : null;
    },
    datesWithData: () => index().dates(),
    person() {
      const age = useProfileStore.getState().ageYears;
      let goals: SignalsPerson['goals'] = {};
      try {
        goals = planGoalsOn(readLivingDocs(), calendarToday());
      } catch {
        // no plan documents readable yet: no goals (the meters say "No goal set")
      }
      // Your body has no maximum heart rate field yet: zones use the age formula (§7.4.1)
      return {
        ...(typeof age === 'number' && Number.isFinite(age) ? { ageYears: age } : {}),
        goals,
        vendorScores: vendorScoresOn(index()),
        tempUnit: useSettingsStore.getState().units === 'imperial' ? 'F' : 'C',
      };
    },
    sourceInfo(from, to) {
      const ix = index();
      const keys = new Set(broughtIn(ix, from, to).map((e) => e.sourceKey));
      const labels = [...keys].map((k) => ix.source(k)?.label ?? k);
      const reads = ix
        .sources()
        .map((s) => (s.ble?.lastSyncAt ? Date.parse(s.ble.lastSyncAt) : NaN))
        .filter(Number.isFinite);
      return { labels, lastReadAt: reads.length ? Math.max(...reads) : null };
    },
  };
}

/* ------------------------------------------------------------------------------------------------ context + hooks */

declare global {
  interface Window {
    /** Dev builds only: the screenshot fixtures (qa/scripts/L-PAGES). */
    __VITALS_PAGES_FIXTURE__?: { ring?: string; signals?: string };
  }
}

let devSource: SignalsSource | null = null;
/** Dev builds only: the fixture source the screenshot harness named (set by ./fixtures at load). */
export function setDevSignalsSource(s: SignalsSource | null): void {
  devSource = s;
}

let defaultSource: SignalsSource | null = null;
const SignalsSourceContext = createContext<SignalsSource | null>(null);

export function SignalsSourceProvider({ source, children }: { source: SignalsSource; children: ReactNode }) {
  return createElement(SignalsSourceContext.Provider, { value: source }, children);
}

export function useSignalsSource(): SignalsSource {
  const ctx = useContext(SignalsSourceContext);
  if (ctx) return ctx;
  if (import.meta.env.DEV && devSource) return devSource;
  return (defaultSource ??= storeSignalsSource());
}

/** Re-renders when stored records change. */
export function useSignalsRevision(src: SignalsSource): number {
  return useSyncExternalStore(src.subscribe, src.revision, () => 0);
}

/** Resolved days in [from, to]. */
export function useDays(from: LocalDate, to: LocalDate): ResolvedDay[] {
  const src = useSignalsSource();
  const rev = useSignalsRevision(src);
  return useMemo(() => {
    void rev;
    return src.days(from, to);
  }, [src, rev, from, to]);
}

export interface SeriesState {
  status: 'loading' | 'ready' | 'failed';
  points: SeriesPoint[];
  /** Points of the previous window while a new one loads (the frame stays at 40 %). */
  stale?: boolean;
  /** Load again after a failure ("Try again"). */
  retry?: () => void;
}

/** Raw samples of one stream in [fromMs, toMs]; `null` bounds mean "nothing to load". */
export function useSeries(metric: SeriesMetric, fromMs: number | null, toMs: number | null, dates: readonly LocalDate[]): SeriesState {
  const src = useSignalsSource();
  const rev = useSignalsRevision(src);
  const idle = fromMs === null || toMs === null || dates.length === 0;
  const key = `${metric}|${fromMs}|${toMs}|${dates.join(',')}|${rev}`;
  const [got, setGot] = useState<SeriesState & { key: string }>({ key: '', status: 'loading', points: [] });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (idle) return;
    let live = true;
    src.series(metric, fromMs!, toMs!, dates).then(
      (points) => live && setGot({ key, status: 'ready', points }),
      () => live && setGot({ key, status: 'failed', points: [] }),
    );
    return () => {
      live = false;
    };
    // `key` carries every input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, idle, src, retry]);
  if (idle) return { status: 'ready', points: [] };
  if (got.key === key) return got.status === 'failed' ? { ...got, retry: () => setRetry((n) => n + 1) } : got;
  // previous window's points stay (at 40 %) while the new one loads
  return { status: 'loading', points: got.points, stale: got.points.length > 0 };
}

export function useBaselines(): SignalBaseline[] | null {
  const src = useSignalsSource();
  const rev = useSignalsRevision(src);
  const [b, setB] = useState<{ rev: number; src: SignalsSource; list: SignalBaseline[] } | null>(null);
  useEffect(() => {
    let live = true;
    src.baselines().then(
      (list) => live && setB({ rev, src, list }),
      () => live && setB({ rev, src, list: [] }),
    );
    return () => {
      live = false;
    };
  }, [src, rev]);
  return b && b.src === src ? b.list : null;
}

export function useSignalsPerson(): SignalsPerson {
  const src = useSignalsSource();
  const rev = useSignalsRevision(src);
  // re-read when records change, or when the age (zones) or the unit setting (°C / °F) changes on another screen
  const age = useProfileStore((s) => (s as unknown as { ageYears?: number }).ageYears);
  const units = useSettingsStore((s) => s.units);
  return useMemo(() => {
    void rev;
    void age;
    void units;
    return src.person();
  }, [src, rev, age, units]);
}
