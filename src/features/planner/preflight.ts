/**
 * "Before you run" hints (planner-goals.md §6): feasibility and conflict notes computed from the catalogue, the goals
 * and the limits, before any optimiser work; the full run then confirms with numbers. Hints never block a run (§7: an
 * invalid target updates the hint rather than blocking).
 *
 * Reachability of body-composition targets comes from the planner's own fastest-safe-rate search (ruling R-TTT:
 * `estimateTargetsAsync` → `TargetReach`, the same answer the run attaches to `feasibility[i].reach`), never from a rate
 * formula of the UI's own, so the pre-run "expect about X in this horizon" and the post-run feasibility agree.
 */
import type { TargetReach } from '@/engine/planner/domain/types';
import { servesFasting } from '@/engine/planner/domain/evidenceGraph';
import { HC } from '@/engine/planner/domain/safety';
import { PLANNER_HORIZON_MAX, type ConstraintDraft, type GoalDraft } from '@/state/plannerStore';
import { goalMetric, modeSpec } from './catalogue';
import { fmtMetric } from './format';
import { goalClasses, goalRelations } from './relations';
import { formatNumber } from '@/components';

export type HintSeverity = 'info' | 'caution' | 'danger';

export type HintAction =
  | { kind: 'extend'; weeks: number; label: string }
  | { kind: 'edit-limits'; label: string }
  | { kind: 'allow-fast'; hours: 24; label: string }
  /** Raise the longest-fast limit to the opted-in tier's maximum (PLANNER_V2_SPEC §3.7). */
  | { kind: 'set-longest-fast'; hours: 48 | 72; label: string };

export interface PreflightHint {
  id: string;
  severity: HintSeverity;
  title: string;
  body?: string;
  action?: HintAction;
}

export interface BodyFacts {
  weightKg: number | null;
  bmi: number | null;
  bodyFatPct: number | null;
  sex: 'male' | 'female' | null;
  trainingHistory: 'none' | 'lt1y' | '1to3y' | 'gt3y' | null;
}

export interface PreflightInput {
  goals: readonly GoalDraft[];
  horizonDays: number;
  constraints: ConstraintDraft;
  body: BodyFacts;
  /** Safety: weight-loss goals are locked (screening). */
  noWeightLossGoal?: boolean;
  /** Longest fast the screening allows (h): the effective cap after opt-ins (above 24 h only with a T2+ opt-in). */
  safetyMaxFastH?: number;
  /**
   * The fasting tier the user opted into (T2: fasts up to 48 h, T3: 72 h, T4: expert), or null. When omitted it is read
   * from `safetyMaxFastH` (a cap above 24 h implies the opt-in).
   */
  fastingOptedTier?: 'T2' | 'T3' | 'T4' | null;
  /** Settings › Units: masses in the hints follow it (kg or lb). */
  units?: 'metric' | 'imperial';
  /**
   * The planner's fastest-safe-rate answer per goal (index-aligned with `goals`), or null while it is being computed
   * (the reachability hints then wait for it rather than guessing).
   */
  reach?: ReadonlyArray<TargetReach | undefined> | null;
}

const WEIGHT_METRICS = new Set(['fatMass', 'scaleWeight', 'bodyFatPct', 'waist']);

/**
 * Goal classes a fast can serve — the planner's fasting gate (engine `FASTING_SERVED`, ruling R-FAST-GATE): transient
 * markers, fat loss as a deficit-delivery pattern, glycaemia, triglycerides / blood pressure, hunger and adherence.
 */
const FASTING_SERVED = new Set(['transient', 'fatLoss', 'glycaemia', 'tgBp', 'comfort']);

/**
 * The planner's fasting gate per goal (engine `fastingServes`): a served class, or the evidence graph credits a fast for
 * the goal's direction (LDL and ApoB either way, endurance capacity, glycogen).
 */
function servedByFasting(g: GoalDraft): boolean {
  if (goalClasses(g).some((k) => FASTING_SERVED.has(k))) return true;
  const down = g.mode === 'lose' || g.mode === 'lower';
  const up = g.mode === 'gain' || g.mode === 'raise' || g.mode === 'reach';
  return (up && servesFasting(g.metric, 'up')) || (down && servesFasting(g.metric, 'down'));
}

/** Longest fast the opted-in tier allows that the limits slider offers (h): T2 48, T3 and T4 72 (the slider's maximum). */
function optedTierMaxH(i: Pick<PreflightInput, 'fastingOptedTier' | 'safetyMaxFastH'>): 0 | 48 | 72 {
  const t = i.fastingOptedTier;
  if (t === 'T3' || t === 'T4') return 72;
  if (t === 'T2') return 48;
  if (t === null) return 0;
  const cap = i.safetyMaxFastH ?? 24;
  return cap > 48 ? 72 : cap > 24 ? 48 : 0;
}

/** Rate cap, % body weight a week (17 §2.3 shape, as the planner applies it). */
export function rateCapPct(b: BodyFacts): number {
  const floor = b.sex === 'female' ? HC.bfFloorPct.female : HC.bfFloorPct.male;
  if (b.bodyFatPct !== null && b.bodyFatPct <= floor + 6) return HC.rateCapPct.leanWithin6;
  if ((b.bmi ?? 0) >= 30 || (b.bodyFatPct ?? 0) >= (b.sex === 'female' ? 40 : 30)) return HC.rateCapPct.highAdiposity;
  return HC.rateCapPct.default;
}

const fmt1 = (x: number) => formatNumber(x, 1);
const LB_PER_KG = 2.2046226218;

export function preflightHints(i: PreflightInput): PreflightHint[] {
  const hints: PreflightHint[] = [];
  const mass = (kg: number) => (i.units === 'imperial' ? `${fmt1(kg * LB_PER_KG)} lb` : `${fmt1(kg)} kg`);
  const { goals, constraints: c, body: b } = i;
  const weeks = i.horizonDays / 7;

  // --- safety locks on goal types
  if (i.noWeightLossGoal) {
    const locked = goals.filter((g) => WEIGHT_METRICS.has(g.metric) && (g.mode === 'lose' || g.mode === 'lower'));
    if (locked.length)
      hints.push({
        id: 'no-weight-loss',
        severity: 'caution',
        title: 'Weight-loss goals aren’t available with your safety answers.',
        body: `Plans will ignore ${locked.map((g) => goalMetric(g.metric)?.label.toLowerCase() ?? g.metric).join(', ')}. You can explore any change in the Simulator.`,
      });
  }

  // --- reachability of body-composition targets: the planner's fastest-safe-rate search (R-TTT), one answer for the
  // pre-run hint and the post-run time-to-target
  const amount = (g: GoalDraft, v: number) => fmtMetric(g.metric, Math.abs(v), i.units ?? 'metric');
  const reachFor = (rank: number) => (i.reach ? i.reach[rank] : undefined);
  goals.forEach((g, rank) => {
    const r = reachFor(rank);
    if (!r || !r.supported || r.target === null || g.amount === null) return;
    if (i.noWeightLossGoal && WEIGHT_METRICS.has(g.metric) && (g.mode === 'lose' || g.mode === 'lower')) return;
    const label = goalMetric(g.metric)?.label.toLowerCase() ?? g.metric;
    const verb = r.kind === 'gain' ? 'Gaining' : 'Losing';
    const what = `${amount(g, g.amount)} of ${label}`;
    const expect = `Expect goal ${rank + 1} to reach about ${amount(g, r.changeAtHorizon)} in this horizon.`;
    if (r.beyondSafetyLimits) {
      hints.push({
        id: `rate-${g.key}`,
        severity: 'caution',
        title: `${verb} ${what} goes past a safety floor.`,
        body: `No safe plan reaches it: the safety floors (body fat, BMI 19, 20 % total loss) stop first. ${expect}`,
      });
      return;
    }
    if (r.reachableInHorizon === false) {
      const extendTo = r.weeks !== null && r.weeks * 7 <= PLANNER_HORIZON_MAX ? Math.max(r.weeks, Math.round(weeks) + 1) : null;
      hints.push({
        id: `rate-${g.key}`,
        severity: 'caution',
        title: `${verb} ${what} in ${Math.round(weeks)} weeks is faster than Vitals’ safe rate.`,
        body: `${expect} ${r.text}`.trim(),
        action: extendTo !== null ? { kind: 'extend', weeks: extendTo, label: `Extend to ${extendTo} weeks` } : undefined,
      });
    } else if (r.reachableInHorizon === true && r.weeks !== null && r.weeks > 0.85 * weeks) {
      hints.push({
        id: `rate-edge-${g.key}`,
        severity: 'caution',
        title: `${amount(g, g.amount)} in ${Math.round(weeks)} weeks is at the edge of a safe rate.`,
        body: `${r.text} Plans may land a little short.`.trim(),
      });
    }
  });

  // --- rate of muscle gain, for metrics the reach search does not cover (typical rates; the run reports the value)
  goals.forEach((g, rank) => {
    if (!(g.metric === 'leanTissue' || g.metric === 'skeletalMuscle') || g.mode !== 'gain' || g.amount === null) return;
    if (i.reach === null || i.reach?.[rank]?.supported) return;
    const perMonth = g.amount / (weeks / 4.345);
    const trained = b.trainingHistory === '1to3y' || b.trainingHistory === 'gt3y';
    const typical = trained ? 0.5 : 1;
    if (perMonth > typical * 1.2)
      hints.push({
        id: `gain-${g.key}`,
        severity: 'info',
        title: `${mass(g.amount)} of ${goalMetric(g.metric)?.label.toLowerCase()} in ${Math.round(weeks)} weeks is faster than typical.`,
        body: `${trained ? 'Trained lifters' : 'Newer lifters'} usually add about ${mass(typical)} a month at best. Plans will report the nearest reachable value.`,
      });
  });

  // --- conflicts between goals
  for (const r of goalRelations(goals)) {
    if (r.kind !== 'conflict') continue;
    const a = goalMetric(goals[r.from]!.metric)?.label ?? '';
    const bb = goalMetric(goals[r.to]!.metric)?.label.toLowerCase() ?? '';
    hints.push({ id: `conflict-${r.from}-${r.to}`, severity: 'info', title: `${a} and ${bb} pull apart.`, body: `${r.text} (#${r.from + 1} ranks above #${r.to + 1}.)` });
  }

  // --- limits
  const allowedDays = new Set(c.trainingWeekdays).size;
  const trainMax = Math.max(c.trainingDays[0], c.trainingDays[1]);
  if (trainMax > allowedDays)
    hints.push({
      id: 'train-days',
      severity: 'caution',
      title: `Up to ${trainMax} training days, but only ${allowedDays} day${allowedDays === 1 ? '' : 's'} allowed.`,
      body: `Plans will train at most ${allowedDays} day${allowedDays === 1 ? '' : 's'} a week.`,
      action: { kind: 'edit-limits', label: 'Edit limits' },
    });
  const needsTraining = goals.some((g) => goalClasses(g).includes('muscle') || g.metric === 'strength');
  if (needsTraining && trainMax === 0)
    hints.push({
      id: 'no-training',
      severity: 'caution',
      title: 'Muscle and strength goals need resistance training.',
      body: 'You’ve allowed no training days, so these goals can barely move.',
      action: { kind: 'edit-limits', label: 'Edit limits' },
    });
  const windowH = c.latestH - c.earliestH;
  if (windowH < HC.window.defaultMin)
    hints.push({
      id: 'window',
      severity: 'caution',
      title: `Eating between these hours leaves ${formatNumber(windowH, 1)} h, under the 6 h minimum.`,
      body: 'Plans will widen the window to at least 6 hours unless shorter windows are switched on in your safety settings.',
      action: { kind: 'edit-limits', label: 'Edit limits' },
    });
  const transientTop = goals.findIndex((g) => goalClasses(g).includes('transient'));
  if (transientTop >= 0 && c.longestFastH < 24) {
    const label = goalMetric(goals[transientTop]!.metric)?.label.toLowerCase();
    hints.push({
      id: 'transient-no-fast',
      severity: 'info',
      title: `Without fasts of 24 h, ${label} can move only a little.`,
      body: `Your longest fast is ${c.longestFastH} h, so plans rely on daily eating windows.`,
      action: (i.safetyMaxFastH ?? 24) >= 24 ? { kind: 'allow-fast', hours: 24, label: 'Allow 24 h fasts' } : undefined,
    });
  }
  // fasting (ruling R-FAST-GATE): the gate offers fasts when a tier is held (the default 24-h tier counts), the longest
  // fast is at least 24 h, and no muscle goal ranks above the goal fasting serves (with "I prefer fasting": the top goal)
  const tierMax = optedTierMaxH(i);
  const muscleRank = goals.findIndex((g) => goalClasses(g).includes('muscle'));
  const servedRank = goals.findIndex(servedByFasting);
  if (tierMax !== 0 && c.longestFastH < tierMax)
    hints.push({
      id: 'fasting-short-longest',
      severity: 'info',
      title: `You’ve opted in to fasts up to ${tierMax} h, but your longest fast is set to ${c.longestFastH} h.`,
      body: tierMax === 72 ? 'Plans can’t use 48- or 72-hour fasts.' : 'Plans can’t use 48-hour fasts.',
      action: { kind: 'set-longest-fast', hours: tierMax, label: `Allow ${tierMax} h fasts` },
    });
  if (tierMax > 0 && !c.prefersFasting && servedRank >= 0 && muscleRank >= 0 && muscleRank < servedRank) {
    const served = goalMetric(goals[servedRank]!.metric)?.label.toLowerCase() ?? 'that goal';
    hints.push({
      id: 'fasting-muscle-above',
      severity: 'info',
      title: `With muscle ranked above ${served}, plans won’t use fasting.`,
      body: 'Long gaps without protein slow muscle gain.',
    });
  }
  if (tierMax > 0 && !c.prefersFasting && servedRank < 0 && goals.length)
    hints.push({ id: 'fasting-no-goal', severity: 'info', title: 'None of your goals gains from fasting, so plans won’t include fasts.' });
  if (c.prefersFasting && c.longestFastH < 24)
    hints.push({
      id: 'fasting-pref',
      severity: 'info',
      title: `You’d like fasting, but your longest fast is ${c.longestFastH} h.`,
      body: 'Plans can use daily eating windows only.',
      action: (i.safetyMaxFastH ?? 24) >= 24 ? { kind: 'allow-fast', hours: 24, label: 'Allow 24 h fasts' } : undefined,
    });

  // --- evidence grade of the first goal
  const first = goals[0] ? goalMetric(goals[0].metric) : undefined;
  if (first && first.grade === 'D')
    hints.push({
      id: 'grade-d-first',
      severity: 'info',
      title: `Your first goal is exploratory (grade D).`,
      body: 'Plans still honour it, but read its curve as a direction, not a number.',
    });

  // --- target modes without amount (defensive)
  goals.forEach((g) => {
    const m = goalMetric(g.metric);
    if (!m) return;
    const spec = modeSpec(m, g.mode);
    if ((spec.target === 'change' || spec.target === 'absolute') && (g.amount === null || !Number.isFinite(g.amount)))
      hints.push({ id: `target-${g.key}`, severity: 'caution', title: `${m.label}: set a target amount.` });
  });

  const order: Record<HintSeverity, number> = { danger: 0, caution: 1, info: 2 };
  return hints.sort((x, y) => order[x.severity] - order[y.severity]);
}
