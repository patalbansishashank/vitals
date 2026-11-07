/** Concrete, equipment-aware RT proposals beside a supplied baseline. No model coefficients are changed here. */
import type { PlannerRequestV2 } from './types';
import type { DayTemplate, ResistanceSession, Schedule, TrainingRegion } from '../../types/schedule';
import { compileRequest } from './context';
import { mergeDay } from './dayMath';
import { equipmentFor } from './equipment';
import { HC } from './safety';
import type { ConcreteSession } from '@/catalogues';
import { SEED_CATALOGUE } from '@/content/catalogues';

const REGIONS: readonly TrainingRegion[] = ['chest', 'upperBack', 'shoulders', 'arms', 'core', 'glutes', 'quads', 'hamstrings', 'calves'];

export interface BaselineTrainingVariant {
  id: 'balanced-rt' | 'progressed-rt';
  schedule: Schedule;
  provenance: 'proposedEquipmentComposedTraining';
  /** Actual resistance minutes from the materialized session, not the abstract request. */
  trainingMinutesByDay: number[];
  /** Actual materialized counted sets, including compound spill, for each calendar week. */
  countedSetsByRegionByWeek: Array<Partial<Record<TrainingRegion, number>>>;
  /** Targets left unfilled by available equipment, time or the novice ramp; never counted as delivered. */
  unfulfilledTargets: Array<{ week: number; region: TrainingRegion; target: number; delivered: number }>;
  /** Regions whose delivered dose falls when asking for the higher target; a tradeoff, not hidden improvement. */
  doseTradeoffsVsBalanced: Array<{ week: number; region: TrainingRegion; balanced: number; delivered: number }>;
  unavailableReason: null;
}

export interface BaselineTrainingSearch {
  variants: BaselineTrainingVariant[];
  unavailableReason: string | null;
}

const day = (s: Schedule, d: number): DayTemplate => mergeDay(s.programs[s.days[d]!.program]!, s.days[d]!.override);
const rt = (t: DayTemplate): ResistanceSession[] => (t.exercise ?? []).filter((x): x is ResistanceSession => x.kind === 'resistance');
const rounded = (x: number): number => Math.round(x * 1000) / 1000;

/** One proposed dose per session. Week one respects the novice ten-set cap; later weeks may add two. */
function requestedTargets(week: number, sessionsInWeek: number, progressed: boolean, novice: boolean): Partial<Record<TrainingRegion, number>> {
  const cap = novice ? HC.rtNovice.startSetsMax + HC.rtNovice.setsIncreasePerWeek * week : Number.POSITIVE_INFINITY;
  const weekly = progressed ? Math.min(12, cap) : Math.min(9, cap);
  const per = weekly / sessionsInWeek;
  // Whole-body work with hamstrings and calves explicit. Compounds can spill into arms/core/glutes;
  // these are targets for the composer, not claims that nine separate exercises fit the clock.
  return Object.fromEntries(REGIONS.map((r) => [r, rounded(per)])) as Partial<Record<TrainingRegion, number>>;
}

function proposedSchedule(baseline: Schedule, progressed: boolean, novice: boolean, maxMinutes: number): { schedule: Schedule; targets: Array<Partial<Record<TrainingRegion, number>>> } | null {
  const programs = baseline.programs.map((p) => ({ ...p, exercise: rt(p) }));
  const days = baseline.days.map((d) => ({ ...d, override: d.override ? { ...d.override, ...(d.override.exercise ? { exercise: d.override.exercise.filter((s) => s.kind === 'resistance') } : {}) } : undefined }));
  const targets: Array<Partial<Record<TrainingRegion, number>>> = [];
  let found = false;
  const referenceSessions = Math.max(1, Array.from({ length: Math.min(7, baseline.horizonDays) }, (_, d) => d).filter((d) => rt(day(baseline, d)).length > 0).length);
  for (let w = 0; w < Math.ceil(baseline.horizonDays / 7); w++) {
    const indices = Array.from({ length: Math.min(7, baseline.horizonDays - 7 * w) }, (_, j) => 7 * w + j).filter((d) => rt(day(baseline, d)).length > 0);
    if (!indices.length) { targets.push({}); continue; }
    found = true;
    // An incomplete final calendar week keeps the ordinary per-session dose;
    // it must not cram seven days of work into its one remaining RT day.
    const perSession = requestedTargets(w, Math.max(referenceSessions, indices.length), progressed, novice);
    targets.push(Object.fromEntries(REGIONS.map((r) => [r, rounded((perSession[r] ?? 0) * indices.length)])) as Partial<Record<TrainingRegion, number>>);
    for (const d of indices) {
      const original = day(baseline, d);
      // Compose RT only; the separate existing cardio is carried through unchanged below.
      const proposedExercise = (original.exercise ?? []).flatMap((s) => {
        if (s.kind !== 'resistance') return [];
        return [{
          ...s,
          durationMin: maxMinutes,
          setsByRegion: perSession,
          groups: undefined,
          volume: undefined,
          rir: 2,
          // Preserve a stated load; otherwise let the existing composer choose
          // exercise-specific prescription loads without inventing a measured 1RM.
          loadPct1RM: s.loadPct1RM,
        } satisfies ResistanceSession];
      });
      days[d] = { ...days[d]!, override: { ...days[d]!.override, exercise: proposedExercise } };
    }
  }
  return found ? { schedule: { ...baseline, programs, days }, targets } : null;
}

function actualDose(s: Schedule): { minutes: number[]; weeks: Array<Partial<Record<TrainingRegion, number>>> } {
  const minutes: number[] = [];
  const weeks: Array<Partial<Record<TrainingRegion, number>>> = Array.from({ length: Math.ceil(s.horizonDays / 7) }, () => ({}));
  for (let d = 0; d < s.horizonDays; d++) {
    const sessions = rt(day(s, d));
    minutes.push(rounded(sessions.reduce((a, x) => a + (x.durationMin ?? 0), 0)));
    for (const x of sessions) for (const r of REGIONS) {
      const v = x.setsByRegion?.[r] ?? 0;
      if (v > 0) weeks[Math.floor(d / 7)]![r] = rounded((weeks[Math.floor(d / 7)]![r] ?? 0) + v);
    }
  }
  return { minutes, weeks };
}

function composedMinutes(sessions: readonly ConcreteSession[], startDate: string, days: number): number[] {
  const out = new Array<number>(days).fill(0);
  const first = Date.parse(`${startDate}T00:00:00Z`);
  for (const s of sessions) {
    if (s.prescription.kind !== 'resistance') continue;
    const date = s.prescription.date;
    const index = date ? Math.round((Date.parse(`${date}T00:00:00Z`) - first) / 86_400_000) : -1;
    if (index >= 0 && index < days) out[index] = rounded(out[index]! + s.minutes);
  }
  return out;
}

/** Use the catalogue's resistance result while preserving every non-RT baseline session byte for byte. */
function preserveNonRt(baseline: Schedule, materialized: Schedule): Schedule | null {
  const days = baseline.days.map((d) => ({ ...d, override: d.override ? { ...d.override } : undefined }));
  for (let d = 0; d < baseline.horizonDays; d++) {
    const original = day(baseline, d);
    const delivered = rt(day(materialized, d));
    let i = 0;
    const exercise = (original.exercise ?? []).map((s) => {
      if (s.kind !== 'resistance') return s;
      const replacement = delivered[i++];
      return replacement ? { ...replacement, startH: s.startH } : s;
    });
    if (i !== delivered.length) return null;
    days[d] = { ...days[d]!, override: { ...days[d]!.override, exercise } };
  }
  return { ...baseline, days };
}

/**
 * Build at most two diagnostics. Only materialized sessions returned by the catalogue composer reach the schedule.
 * A missing equipment profile or baseline RT clock gives an explicit unavailable reason.
 */
export async function generateBaselineTrainingVariants(request: PlannerRequestV2, baseline: Schedule): Promise<BaselineTrainingSearch> {
  if (!request.training) return { variants: [], unavailableReason: 'Training equipment/profile is absent; concrete exercise delivery cannot be established.' };
  if (baseline.days.length !== baseline.horizonDays || !baseline.horizonDays) return { variants: [], unavailableReason: 'Baseline days are incomplete.' };
  const withoutPurchases: PlannerRequestV2 = {
    ...request,
    horizonDays: baseline.horizonDays,
    startDate: baseline.startDate,
    training: {
      ...request.training,
      // A hybrid item adds training cardio; keep the baseline cardio dose fixed.
      refused: [...new Set([...request.training.refused, ...SEED_CATALOGUE.exercises.filter((x) => x.hybridCardioShare > 0).map((x) => x.id)])],
      purchaseAllowance: { maxPriceTier: 0, maxItems: 0 },
    },
  };
  const ctx = compileRequest(withoutPurchases);
  const maxMinutes = Math.min(60, ctx.practical.maxSessionMin);
  if (maxMinutes < 45) return { variants: [], unavailableReason: `Session limit ${maxMinutes} min is below the supplied 45-minute RT baseline.` };
  const variants: BaselineTrainingVariant[] = [];
  for (const [id, progressed] of [['balanced-rt', false], ['progressed-rt', true]] as const) {
    const proposal = proposedSchedule(baseline, progressed, ctx.caps.rtNovice, maxMinutes);
    if (!proposal) return { variants: [], unavailableReason: 'Baseline contains no RT sessions to progress.' };
    const composed = await equipmentFor(ctx, proposal.schedule, { ideal: false, benefitTop: 0 });
    // A hybrid item would add cardio beyond the fixed baseline; do not silently
    // drop its work or change the user's existing cardio prescription.
    if (composed.sessions.some((s) => s.prescription.kind === 'resistance' && s.engine.cardio.length > 0)) continue;
    if (composed.required.length || composed.sessions.some((x) => x.purchasesUsed.length > 0)) continue;
    const schedule = preserveNonRt(baseline, composed.schedule);
    if (!schedule) continue;
    const actual = actualDose(schedule);
    const minutes = composedMinutes(composed.sessions, baseline.startDate, baseline.horizonDays);
    if (minutes.some((m, d) => m > maxMinutes + 1e-6 || (rt(day(baseline, d)).length === 0 && m > 0))) continue;
    if (Array.from({ length: baseline.horizonDays }, (_, d) => d).some((d) => rt(day(baseline, d)).length > 0 && minutes[d]! <= 0)) continue;
    const unfulfilledTargets: BaselineTrainingVariant['unfulfilledTargets'] = [];
    proposal.targets.forEach((want, week) => REGIONS.forEach((region) => {
      const target = want[region] ?? 0;
      const delivered = actual.weeks[week]?.[region] ?? 0;
      if (target - delivered > 0.5) unfulfilledTargets.push({ week, region, target, delivered });
    }));
    const doseTradeoffsVsBalanced: BaselineTrainingVariant['doseTradeoffsVsBalanced'] = [];
    if (progressed && variants.length) {
      const prior = variants[0]!.countedSetsByRegionByWeek;
      actual.weeks.forEach((week, wi) => REGIONS.forEach((region) => {
        const balanced = prior[wi]?.[region] ?? 0;
        const delivered = week[region] ?? 0;
        if (delivered + 0.25 < balanced) doseTradeoffsVsBalanced.push({ week: wi, region, balanced, delivered });
      }));
    }
    variants.push({ id, schedule, provenance: 'proposedEquipmentComposedTraining', trainingMinutesByDay: minutes, countedSetsByRegionByWeek: actual.weeks, unfulfilledTargets, doseTradeoffsVsBalanced, unavailableReason: null });
  }
  return { variants, unavailableReason: variants.length ? null : 'Available exercises could not produce a materialized RT session inside the time and no-purchase limits.' };
}
