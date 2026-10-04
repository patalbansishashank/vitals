/**
 * Ring views (R16 §6 "Ranked small gaps" 1–7): the models the night view, the day charts, the steps readout and the
 * workouts list draw, built from stored records by kind (SUITE_SPEC §4), never from import batches. The model builders
 * are pure; the hooks read the biometrics index (records the person brought in, per the stream policy) and the
 * `bio.series` read command (samples). Nothing is filled in: a missing day stays missing, a stage the ring could not
 * classify stays "unknown", a gap between readings stays a gap.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import '@/commands'; // the registry: registers the commands sent here
import { sendCommand } from '@/features/lib/sendCommand';
import { getDocumentStore } from '@/state/runtime';
import { sharedBioIndex, type BioDocIndex } from '@/biometrics/store/docIndex';
import { effectivePolicy } from '@/biometrics/core/effective';
import { resolveDays } from '@/biometrics/core/resolve';
import { policyStreamOf } from '@/biometrics/core/source';
import type { BioRecord, ResolvedDay, SleepRecord, SleepStageName, WorkoutRecord } from '@/biometrics/core/types';
import { addDays } from '@/living/dates';
import type { LocalDate } from '@/living';

/* ------------------------------------------------------------------------------------------------ models */

export type NightStage = 'deep' | 'light' | 'rem' | 'awake' | 'unknown';
export const NIGHT_STAGES: readonly NightStage[] = ['awake', 'rem', 'light', 'deep', 'unknown'];

export interface NightModel {
  /** Wake date. */
  date: LocalDate;
  start: number;
  end: number;
  /** Offset used for clock times, seconds east of UTC. */
  offsetS: number;
  segments: Array<{ start: number; end: number; stage: NightStage }>;
  /** Minutes per stage; time no stage covers is `uncovered`, never added to a stage. */
  minutes: Record<NightStage, number>;
  uncovered: number;
  asleepMin: number;
  provisional: boolean;
}

const STAGE_OF: Record<SleepStageName, NightStage> = {
  deep: 'deep', light: 'light', rem: 'rem', awake: 'awake', awake_in_bed: 'awake', out_of_bed: 'awake', unknown: 'unknown',
  // "asleep" without a stage: the ring knew you slept but not how deeply; shown as unknown, not as light
  asleep_unspecified: 'unknown',
};

export function nightModel(rec: SleepRecord): NightModel | null {
  if (!rec.time.start || !rec.time.end) return null;
  const start = Date.parse(rec.time.start), end = Date.parse(rec.time.end);
  if (!(end > start)) return null;
  const minutes: Record<NightStage, number> = { deep: 0, light: 0, rem: 0, awake: 0, unknown: 0 };
  const segments = (rec.stages ?? [])
    .map((s) => ({ start: Date.parse(s.start), end: Date.parse(s.end), stage: STAGE_OF[s.stage] ?? 'unknown' }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  let covered = 0;
  for (const s of segments) {
    const m = (s.end - s.start) / 60_000;
    minutes[s.stage] += m;
    covered += m;
  }
  for (const k of NIGHT_STAGES) minutes[k] = Math.round(minutes[k]);
  return {
    date: rec.time.local_date, start, end, offsetS: rec.time.tz_offset_s, segments, minutes,
    uncovered: Math.max(0, Math.round((end - start) / 60_000 - covered)),
    asleepMin: Math.round(rec.asleep_s / 60),
    provisional: rec.quality.flags.includes('provisional_stages'),
  };
}

export interface StepsDay {
  date: LocalDate;
  steps: number | null;
  activeMin: number | null;
}

/** One entry per calendar day of the window, oldest first; days without a record carry nulls. */
export function stepsDays(days: readonly ResolvedDay[], today: LocalDate, n: number): StepsDay[] {
  const by = new Map(days.map((d) => [d.localDate, d]));
  const out: StepsDay[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const d = by.get(date)?.daily;
    const am = d?.active_min;
    out.push({
      date,
      steps: typeof d?.steps === 'number' ? d.steps : null,
      activeMin: am ? Math.round(am.light + am.moderate + am.vigorous) : null,
    });
  }
  return out;
}

export interface WorkoutRow {
  id: string;
  date: LocalDate;
  start: number;
  offsetS: number;
  type: string;
  durationS: number;
  avgHr: number | null;
  maxHr: number | null;
  distanceM: number | null;
}

export function workoutRows(ws: readonly WorkoutRecord[]): WorkoutRow[] {
  return ws
    .filter((w) => w.time.start)
    .map((w) => ({
      id: w.record_id,
      date: w.time.local_date,
      start: Date.parse(w.time.start!),
      offsetS: w.time.tz_offset_s,
      type: w.exercise_type,
      durationS: w.active_duration_s,
      avgHr: w.hr_avg_bpm ?? null,
      maxHr: w.hr_max_bpm ?? null,
      distanceM: w.distance_m ?? null,
    }))
    .sort((a, b) => b.start - a.start);
}

export interface SeriesPoint {
  t: number;
  v: number;
}

/** Splits samples into runs; a gap longer than `maxGapMs` starts a new run, so a line never bridges missing readings. */
export function runsOf(points: readonly SeriesPoint[], maxGapMs: number): SeriesPoint[][] {
  const runs: SeriesPoint[][] = [];
  let cur: SeriesPoint[] = [];
  for (const p of points) {
    if (cur.length && p.t - cur[cur.length - 1]!.t > maxGapMs) {
      runs.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** HH:MM at a fixed UTC offset (the record's own), so the clock is the one the person slept in. */
export function clockAt(t: number, offsetS: number): string {
  const d = new Date(t + offsetS * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** The browser's offset at `t` (for samples without a record offset). */
export const localOffsetS = (t: number): number => -new Date(t).getTimezoneOffset() * 60;

/* ------------------------------------------------------------------------------------------------ hooks */

const index = (): BioDocIndex => sharedBioIndex(getDocumentStore());

function useIndexRevision(): number {
  return useSyncExternalStore(
    (fn) => index().subscribe(fn),
    () => index().revision(),
    () => 0,
  );
}

/** Latest records the person brought in (policy `imported` on), in a date window. */
function broughtIn(ix: BioDocIndex, from: LocalDate, to: LocalDate): Array<{ sourceKey: string; record: BioRecord }> {
  return ix
    .latestRecords(from, to)
    .filter((e) => effectivePolicy(ix.source(e.sourceKey) ?? { policies: [] }, ix.personPolicies, policyStreamOf(e.record)).imported)
    .map((e) => ({ sourceKey: e.sourceKey, record: e.record }));
}

/** Resolved days (one value per metric per day, by source priority) for the window ending `to`. */
export function useResolvedDays(to: LocalDate, n: number): ResolvedDay[] {
  const rev = useIndexRevision();
  return useMemo(() => {
    void rev;
    const ix = index();
    const from = addDays(to, -(n - 1));
    return resolveDays(broughtIn(ix, from, to), ix.sources(), { from, to });
  }, [rev, to, n]);
}

/** Wake dates (newest first) that have a main night with a start and end, within the last `n` days. */
export function nightDates(days: readonly ResolvedDay[]): LocalDate[] {
  return days.filter((d) => d.mainSleep?.time.start && d.mainSleep.time.end).map((d) => d.localDate).sort().reverse();
}

export function useWorkouts(to: LocalDate, n: number): WorkoutRow[] {
  const days = useResolvedDays(to, n);
  return useMemo(() => workoutRows(days.flatMap((d) => d.workouts)), [days]);
}

export interface SeriesState {
  status: 'loading' | 'ready' | 'failed';
  points: SeriesPoint[];
}

/** Raw samples of one stream between two instants (via `bio.series`, which picks one source per day). */
export function useSeriesWindow(metric: 'hr' | 'spo2' | 'skin_temp' | 'steps', from: number | null, to: number | null, dates: readonly LocalDate[]): SeriesState {
  const rev = useIndexRevision();
  const [got, setGot] = useState<SeriesState & { key: string }>({ key: '', status: 'loading', points: [] });
  const idle = from === null || to === null || dates.length === 0;
  const key = `${metric}|${from}|${to}|${dates.join(',')}|${rev}`;
  useEffect(() => {
    if (idle) return;
    let live = true;
    const sorted = [...dates].sort();
    void sendCommand('bio.series', { metric, from: sorted[0], to: sorted[sorted.length - 1], resolution: 'raw' }, { silent: true }).then(
      (r) => {
        if (!live) return;
        if (!r.ok || !('output' in r)) {
          setGot({ key, status: 'failed', points: [] });
          return;
        }
        const pts = ((r.output as { points?: Array<{ t: string; value: number }> }).points ?? [])
          .map((p) => ({ t: Date.parse(p.t), v: p.value }))
          .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.t >= from && p.t <= to)
          .sort((a, b) => a.t - b.t);
        setGot({ key, status: 'ready', points: pts });
      },
      () => live && setGot({ key, status: 'failed', points: [] }),
    );
    return () => {
      live = false;
    };
    // `key` carries every input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, idle]);
  if (idle) return { status: 'ready', points: [] };
  return got.key === key ? got : { status: 'loading', points: [] };
}
