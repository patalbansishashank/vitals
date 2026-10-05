/**
 * Measured observations for the living plan (SUITE_SPEC §4.5; docs/LIVING_PLAN.md §9 "E10"): resolved days (one source
 * per metric per day, never averaged) → E5's `DayObservations`, through E10's engine adapter (`toSleepInputs`,
 * `toActivityInputs`, `toVo2Observation`, `toVo2TestObservation`). Tier P, pure.
 *
 * Policy: a value reaches the plan only when the source chosen for that metric has `engine: true` for its stream
 * (resolve first, then gate, so the plan uses exactly what the person sees or nothing). Score-derived observations
 * (VO2max posterior, HRV status, illness flags) use the person's matrix. Vendor numbers never appear here.
 */
import { observationsFromBioRecords, type DayObservations, type ObservedWorkout } from '@/living';
import { effectivePolicy, personMatrix } from './effective';
import { toActivityInputs, toSleepInputs, toVo2Observation, toVo2TestObservation } from './engineAdapter';
import { engineOn, type PolicyMatrix } from './policy';
import { contentRecordId, LUMEN_SOURCE } from './recordIds';
import { resolveDays, type SourcedRecord } from './resolve';
import type { BioCorrection, BioRecord, BioSourceDoc, LocalDate, PolicyStream, ResolvedDay, ScoreResult, StreamPolicy } from './types';

export interface ObservationInputs {
  /** Newest version of every record (any order). */
  records: readonly SourcedRecord[];
  sources: readonly BioSourceDoc[];
  /** The person's stream policies. */
  person: readonly StreamPolicy[];
  /** Score results (every version; the newest per score and day is used). */
  results: readonly ScoreResult[];
  /** IANA zone for clock hours of workouts and weigh-ins. */
  tz: string;
  from?: LocalDate;
  to?: LocalDate;
  /** The person's corrections (SUITE_SPEC §14.6): a corrected value is what the plan sees. */
  corrections?: readonly BioCorrection[];
}

const QUALITY = ['poor', 'fair', 'good'] as const;
const RESISTANCE = /strength|weight|resistance|functional|core|crossfit|calisthenics|kettlebell|pilates/i;
const CARDIO = /run|walk|cycl|bik|swim|row|elliptical|hiit|stair|hike|cardio|dance|ski|jog|spin/i;

function newest(results: readonly ScoreResult[]): Map<string, ScoreResult> {
  const out = new Map<string, ScoreResult>();
  const vnum = (v: string) => v.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const newer = (a: string, b: string) => {
    const pa = vnum(a);
    const pb = vnum(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
    return false;
  };
  for (const r of results) {
    if (r.scope.kind === 'workout') continue;
    const k = `${r.scoreId}|${r.scope.localDate}`;
    const prev = out.get(k);
    if (!prev || newer(r.version, prev.version)) out.set(k, r);
  }
  return out;
}

/** One `DayObservations` per date that has anything the plan may use. */
export function buildObservations(i: ObservationInputs): DayObservations[] {
  const sources = new Map(i.sources.map((s) => [s.sourceKey, s] as const));
  const label = (sk: string | undefined): string => (sk ? (sources.get(sk)?.label ?? sk) : 'device');
  const days = resolveDays(i.records, i.sources, { ...(i.from ? { from: i.from } : {}), ...(i.to ? { to: i.to } : {}) }, i.corrections ?? []);
  const results = newest(i.results);
  const person = personMatrix(i.person);
  const resultOn = (id: string, d: LocalDate) => results.get(`${id}|${d}`);
  const out: DayObservations[] = [];

  for (const day of days) {
    const src = (metric: string) => day.sourceByMetric[metric];
    const pol = (metric: string, stream: PolicyStream): StreamPolicy => effectivePolicy(sources.get(src(metric) ?? '') ?? (src(metric) ? { policies: [] } : null), i.person, stream);
    const m = (entries: Array<[PolicyStream, StreamPolicy]>): PolicyMatrix => Object.fromEntries(entries);
    const dayResults = [...results.values()].filter((r) => r.scope.localDate === day.localDate);
    const o: DayObservations = { date: day.localDate };

    // sleep: the main sleep of the chosen source
    const sleep = toSleepInputs(day, dayResults, m([['sleep_sessions', pol('sleep', 'sleep_sessions')]]));
    if (sleep && day.mainSleep) {
      o.sleep = {
        bedH: sleep.sleepBedH,
        wakeH: sleep.sleepWakeH,
        hours: sleep.sleepHours,
        ...(day.mainSleep.efficiency_pct !== undefined ? { efficiencyPct: day.mainSleep.efficiency_pct } : {}),
        ...(sleep.assumedVsMeasured.sleepQuality !== 'assumed' ? { quality: QUALITY[sleep.sleepQualityClass] } : {}),
        source: label(src('sleep')),
        recordId: sleep.source.recordId,
      };
    }

    // steps and workouts
    const act = toActivityInputs(day, m([['steps', pol('steps', 'steps')], ['workouts', pol('workouts', 'workouts')]]), dayResults);
    if (act?.steps !== null && act?.steps !== undefined) o.steps = { value: act.steps, source: label(src('steps')), ...(day.daily ? { recordId: day.daily.record_id } : {}) };
    if (act && act.workouts.length > 0) {
      const byId = new Map(day.workouts.map((w) => [w.record_id, w] as const));
      o.workouts = act.workouts
        .filter((w) => w.startH !== null)
        .map((w): ObservedWorkout => {
          const rec = byId.get(w.recordId);
          const t = w.exerciseType || 'other';
          // the id the workout had under Lumen's rule before the ring fold re-id'd it: entries logged under it are its
          const was = rec ? contentRecordId(rec, LUMEN_SOURCE) : w.recordId;
          return {
            recordId: w.recordId,
            ...(was !== w.recordId ? { aliases: [was] } : {}),
            startH: w.startH!,
            durationMin: w.durationMin,
            exerciseType: t,
            kind: RESISTANCE.test(t) ? 'resistance' : CARDIO.test(t) ? 'cardio' : 'other',
            ...(rec?.active_kcal !== undefined ? { activeKcal: rec.active_kcal } : {}),
            ...(rec?.hr_avg_bpm !== undefined ? { avgHrBpm: rec.hr_avg_bpm } : {}),
            ...(w.load ? { load: w.load } : {}),
            ...(rec?.rpe_0_10 !== undefined ? { rpe010: rec.rpe_0_10 } : {}),
            source: label(src('workouts')),
          };
        });
      if (o.workouts.length === 0) delete o.workouts;
    }

    // weight and body fat (spot values of the chosen source, `body` stream)
    const bodySpots = day.spots.filter((s) => (s.metric === 'weight_kg' || s.metric === 'body_fat_pct') && engineOn(m([['body', pol(`spot:${s.metric}`, 'body')]]), 'body'));
    if (bodySpots.length > 0) {
      const mapped = observationsFromBioRecords(bodySpots as unknown as Parameters<typeof observationsFromBioRecords>[0], i.tz).find((x) => x.date === day.localDate);
      if (mapped?.weights?.length) o.weights = mapped.weights.map((w) => ({ ...w, source: label(src('spot:weight_kg')) }));
      if (mapped?.bodyFat?.length) o.bodyFat = mapped.bodyFat.map((b) => ({ ...b, source: label(src('spot:body_fat_pct')) }));
    }

    // VO2max: an entered lab or field test, else Vitals' own posterior (vendor estimates never)
    const test = toVo2TestObservation(day, m([['daily_summary', pol('vo2max', 'daily_summary')]]));
    const vo2r = resultOn('fitness.vo2max', day.localDate);
    const post = vo2r ? toVo2Observation(vo2r, person) : null;
    if (test) o.vo2max = { mlKgMin: test.valueMlKgMin, sd: test.sdMlKgMin, method: test.method === 'posterior' ? 'derived' : test.method, source: label(src('vo2max')) };
    else if (post) o.vo2max = { mlKgMin: post.valueMlKgMin, sd: post.sdMlKgMin, method: 'derived', source: 'Vitals' };

    // resting heart rate: Vitals' overnight score, else the device's daily value
    if (engineOn(m([['hr', pol('resting_hr_bpm', 'hr')]]), 'hr')) {
      const rhr = resultOn('hr.rhr_night', day.localDate);
      const delta = typeof rhr?.detail?.['delta_bpm'] === 'number' ? (rhr.detail['delta_bpm'] as number) : undefined;
      if (rhr?.status === 'ok' && rhr.value !== null) o.restingHr = { bpm: rhr.value, ...(delta !== undefined ? { vsBaseline: delta } : {}), source: label(typeof rhr.detail?.['sourceKey'] === 'string' ? (rhr.detail['sourceKey'] as string) : src('resting_hr_bpm')) };
      else if (day.daily?.resting_hr_bpm !== undefined && src('resting_hr_bpm')) o.restingHr = { bpm: day.daily.resting_hr_bpm, source: label(src('resting_hr_bpm')) };
    }

    // HRV status (Vitals' own; rmssd-based)
    const hrv = resultOn('hrv.status', day.localDate);
    if (hrv && engineOn(person, 'hrv') && (hrv.status === 'ok' || hrv.status === 'borderline')) {
      const st = hrv.status === 'borderline' ? String(hrv.detail?.['point_state'] ?? 'within') : hrv.state;
      if (st === 'below' || st === 'within' || st === 'above') o.hrv = { state: st === 'within' ? 'normal' : st, metric: 'rmssd' };
    }

    // illness watch flags (never a diagnosis)
    const ill = resultOn('illness.nightsignal', day.localDate);
    if (ill && engineOn(person, 'hr') && (ill.state === 'yellow' || ill.state === 'amber' || ill.state === 'red')) {
      const text = ill.state === 'red' ? 'Strong signs of strain' : ill.state === 'amber' ? 'Signs of strain' : 'Worth watching';
      o.flags = [{ id: 'illness.nightsignal', level: ill.state, text }];
    }

    if (Object.keys(o).length > 1) out.push(o);
  }
  return out;
}

/** The newest version of each record (helper for callers holding every stored version). */
export function newestRecords(all: Iterable<{ sourceKey: string; record: BioRecord }>): SourcedRecord[] {
  const best = new Map<string, SourcedRecord>();
  for (const e of all) {
    const p = best.get(e.record.record_id);
    if (!p || e.record.version > p.record.version) best.set(e.record.record_id, e);
  }
  return [...best.values()];
}

export type { ResolvedDay };
