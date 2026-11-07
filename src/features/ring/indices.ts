/**
 * The day's experimental wellness indices for the Ring screens (SPEC §V2.8, A.1.2 #37-41, D17): V2's `sleep-index/5`,
 * `recovery-index/6`, `activity-index/4` and the `day-index/1` Day score, fed from S2's night metrics and baselines,
 * the day's steps and the A.1.4 goals. Pure: no React, no IO.
 *
 * Until S2 serves the night metrics (an older server), the Ring shows Gauge's own `insights/*` values labelled
 * "Gauge (legacy)" (A.1.2 #37-39); the Day score is then worked out over those, under the same label.
 */
import { activityIndex, dayIndex, localClockMin, recoveryIndex, sleepIndex, type DayIndex, type IndexContributor, type IndexResult } from '@/living/sensors';
import type { DayArc } from '@/components';
import type { GaugeBaselines, GaugeScore, GaugeSleepSession } from './types';

export type IndexId = 'recovery' | 'sleep' | 'activity';

export interface RingIndex {
  id: IndexId;
  label: string;
  value: number | null;
  confidence: 'low' | 'medium' | null;
  contributors: IndexContributor[];
  /** Why it is missing ("needs 3 more nights"). */
  needs: string | null;
  version: string | null;
}

export interface RingScores {
  /** `vitals`: V2's indices; `legacy`: Gauge's `insights/*` values (an older server). */
  source: 'vitals' | 'legacy';
  recovery: RingIndex;
  sleep: RingIndex;
  activity: RingIndex;
  day: Pick<DayIndex, 'value' | 'confidence' | 'basedOn' | 'effectiveSleepShare' | 'contributors' | 'version' | 'reason'>;
  /** S2's baselines are still forming. */
  learning: { nights: number; needed: number } | null;
}

export interface ScoreInputs {
  night: GaugeSleepSession | null;
  baselines: GaugeBaselines | null;
  steps: number | null;
  stepGoal: number;
  sleepGoalMin: number;
  /** Gauge's legacy values for the day (`daily.scores`), the fallback. */
  legacy?: Record<string, GaugeScore> | null;
  /** (0.6.3 S22/A17) The week's Heart Points pace (`weekPointsPace`: points so far scaled to 7 days); null = unknown. */
  weekPointsPace?: number | null;
  /** Prescribed sessions of the day (after the eligibility overlay) and the credit of those done; null without a plan. */
  plannedSessions?: { planned: number; done: number } | null;
  /** `priorDayTrimpBalance(...).score` when eligible (TRIMP known, a record yesterday, 7 days of history); else null. */
  loadBalance?: number | null;
}

const LABEL: Record<IndexId, string> = { recovery: 'Recovery', sleep: 'Sleep', activity: 'Activity' };

const pack = (id: IndexId, r: IndexResult<string>, needs: string | null): RingIndex => ({
  id,
  label: LABEL[id],
  value: r.value === null ? null : Math.round(r.value),
  confidence: r.confidence,
  contributors: r.contributors,
  needs: r.value === null ? needs : null,
  version: r.version,
});

const more = (n: number, one: string, many: string) => `needs ${n} more ${n === 1 ? one : many}`;

export function ringScores(i: ScoreInputs): RingScores {
  const m = i.night?.metrics;
  const b = i.baselines;
  const learning = b?.learning.learning ? { nights: b.learning.nights, needed: b.learning.needed } : null;
  if (!m) return legacyScores(i, learning);
  const usual = b?.usualMidpoint && !b.usualMidpoint.suppressed ? b.usualMidpoint.minutes : null;
  const sleep = sleepIndex({
    tstLowerMin: m.tstLowerMin,
    windowContinuityPct: m.windowContinuityPct,
    midpointMin: localClockMin(m.midpoint),
    usualMidpointMin: usual,
    targetMin: i.sleepGoalMin,
  });
  // personal parts wait for the baseline: a forming baseline is never read as a usual level
  const settled = b && !b.learning.learning ? b : null;
  const recovery = recoveryIndex({
    hrvNightlyMs: m.hrvNightlyMs,
    nightlyLowHrP10: m.nightlyLowHrP10,
    baselines: settled,
    sleepIndex: sleep.value,
    loadBalance: i.loadBalance ?? null,
    tempDeltaC: settled?.tempBaseline?.deltaT ?? null,
  });
  const ps = i.plannedSessions && i.plannedSessions.planned > 0 ? i.plannedSessions : null;
  const activity = activityIndex({ steps: i.steps, stepTarget: i.stepGoal, weekPointsPace: i.weekPointsPace ?? null, plannedSessionsDone: ps ? ps.done : null, plannedSessions: ps ? ps.planned : null });
  const day = dayIndex({ recovery, sleep, activity });
  const recNeeds = learning ? more(learning.needed - learning.nights, 'night', 'nights') : 'needs HRV and sleeping heart rate';
  return {
    source: 'vitals',
    recovery: pack('recovery', recovery, recNeeds),
    sleep: pack('sleep', sleep, 'needs a night'),
    activity: pack('activity', activity, 'needs steps'),
    day,
    learning,
  };
}

function legacyScores(i: ScoreInputs, learning: RingScores['learning']): RingScores {
  const one = (id: IndexId, key: string): RingIndex => {
    const e = i.legacy?.[key];
    const v = e?.value ?? null;
    return { id, label: LABEL[id], value: v === null ? null : Math.round(v), confidence: e?.confidence === 'low' ? 'low' : v === null ? null : 'medium', contributors: [], needs: v === null ? 'not worked out yet' : null, version: e?.algorithmVersion ?? null };
  };
  const recovery = one('recovery', 'recovery_score');
  const sleep = one('sleep', 'sleep_score');
  const activity = one('activity', 'activity_score');
  const asIndex = (x: RingIndex) => ({ value: x.value, confidence: x.confidence, contributors: [] as IndexContributor[] });
  const day = dayIndex({ recovery: asIndex(recovery), sleep: asIndex(sleep), activity: asIndex(activity) });
  return { source: 'legacy', recovery, sleep, activity, day, learning };
}

/** The three arcs of the `DayDisc`. */
export function dayArcs(s: RingScores): DayArc[] {
  return [s.recovery, s.activity, s.sleep].map((x) => ({ id: x.id, label: x.label, score: x.value, ...(x.confidence ? { confidence: x.confidence } : {}), ...(x.needs ? { needs: x.needs } : {}) }));
}
