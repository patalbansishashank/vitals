/**
 * Weekly check-in (docs/SUITE_SPEC.md §3.5 steps 4-7; R11 §3.3): trend filter → energy-balance bias δ → anchor (tissue mass
 * to the filtered trend, residual split by the engine's partition, optionally nudged by body-fat readings or girths, or a
 * hard composition re-anchor from DXA) → confirmed day-stamped engine snapshot. Pure and deterministic: the inputs are the
 * plan's documents (baseline profile, realised schedule, earlier anchors and δ steps, weigh-ins, measurements).
 *
 * The confirmed snapshot is the state at the START of the check-in day with the new anchor applied; together with δ and the
 * trend it forms PLANNER_V2's `ConfirmedState`. The record that syncs (`ConfirmedStateRecord`, living plan) stores only the
 * numbers; the snapshot is rebuilt by `runReplay` with the stored anchors and cached locally.
 */
import { estimateEnergyBias, mixDensity, type EnergyBiasEstimate } from './energyBias';
import { ASSIMILATION_DEFAULTS, type AssimilationParams } from './params';
import { runReplay, snapshotFatKg, snapshotTissueKg, type ReplayOutput } from './replay';
import { countWeighIns, estimateDowOffsets, runTrendFilter, type TrendPoint, type WeighInObs } from './trendFilter';
import type { AnchorSpec, EngineSnapshot, IntakeOffset } from '../types/result';
import type { PersonProfile } from '../types/profile';
import type { Schedule } from '../types/schedule';

export interface CompositionReadings {
  /** Consumer body-fat readings (BIA scales), %; weekly means are formed here. */
  bodyFatBia?: ReadonlyArray<{ day: number; pct: number }>;
  /** DXA or clinical body-fat reading (hard composition re-anchor), %, with its SD. */
  dxa?: { day: number; pct: number; sdPct?: number };
  /** Waist girths (mean of the 2-3 repeats per sitting), cm. */
  waist?: ReadonlyArray<{ day: number; cm: number }>;
}

export interface CheckInInput {
  /** Plan day of the check-in (the anchor day; usually today). */
  day: number;
  profile: PersonProfile;
  /** Realised schedule covering at least days [0, day]. */
  schedule: Schedule;
  /** Anchors and δ steps of earlier confirmed records. */
  anchors: readonly AnchorSpec[];
  intakeOffsets: readonly IntakeOffset[];
  weighIns: readonly WeighInObs[];
  /** Weekday of plan day 0 (0 = Monday) for the day-of-week offset. */
  startWeekday: number;
  /** Plan days with a logged (not assumed) intake, for the δ gate. */
  intakeDays: readonly number[];
  aiEnergyShare?: number;
  previousBias: { mean: number; sd: number };
  composition?: CompositionReadings;
  /** Hard re-anchor (event, DXA, ≥ 14 days without weigh-in): skips the weigh-in count gate (needs one weigh-in in 3 days or a DXA). */
  hard?: boolean;
  params?: AssimilationParams;
}

export type CheckInVerdict = 'confirmed' | 'notEnoughWeighIns';

export interface CheckInOutput {
  verdict: CheckInVerdict;
  day: number;
  in7: number;
  in14: number;
  /** Filter at the check-in day (morning), kg and kg/d. */
  trend: { w: number; wSd: number; r: number; rSd: number } | null;
  /** The filtered series up to the check-in (display, drift). */
  points: TrendPoint[];
  dowOffsets: number[] | null;
  bias: EnergyBiasEstimate;
  anchor: AnchorSpec | null;
  /** How the residual was split and what set it. */
  residualSplit: { residualKg: number; fatKg: number; leanKg: number; source: 'engine' | 'bia' | 'girth' | 'bia+girth' | 'dxa' } | null;
  /** δ step to append (from the check-in day). */
  intakeOffset: IntakeOffset | null;
  /** Confirmed state at the start of `day` (anchor applied), and the replay that produced it. */
  snapshot: EngineSnapshot | null;
  replay: ReplayOutput | null;
}

/** Weekly means of (day, value) pairs within [from, to], keyed by the week index counted back from `to`. */
function weeklyMeans(xs: ReadonlyArray<{ day: number; v: number }>, to: number, weeks: number): Array<{ week: number; mean: number; day: number }> {
  const out: Array<{ week: number; mean: number; day: number }> = [];
  for (let w = 0; w < weeks; w++) {
    const hi = to - 7 * w;
    const lo = hi - 7;
    const sel = xs.filter((x) => x.day > lo && x.day <= hi);
    if (sel.length === 0) continue;
    out.push({ week: w, mean: sel.reduce((s, x) => s + x.v, 0) / sel.length, day: Math.round(sel.reduce((s, x) => s + x.day, 0) / sel.length) });
  }
  return out;
}

/**
 * Whole-body fat fraction to anchor to, or null to keep the engine partition. DXA within 7 days: precision-weighted with
 * the engine's own estimate (no cap: a hard re-anchor). Consumer BIA (weekly means, SD ≥ 2 points) and waist girths (≥ 3
 * weekly means; converted to fat mass through the engine's own waist-per-fat sensitivity over the window) only nudge the
 * split, each by at most `biaMaxGain` of the gap. The tissue total is never changed by these readings.
 */
export function compositionTarget(
  day: number,
  engineFatFrac: number,
  targetTissueKg: number,
  readings: CompositionReadings | undefined,
  replay: ReplayOutput,
  prm: AssimilationParams,
): { fatFrac: number; source: 'bia' | 'girth' | 'bia+girth' | 'dxa' } | null {
  if (!readings) return null;
  const mVar = (prm.modelBfSdPct / 100) ** 2;
  const dxa = readings.dxa;
  if (dxa && dxa.day <= day && dxa.day > day - 7 && Number.isFinite(dxa.pct)) {
    const oVar = ((dxa.sdPct ?? prm.dxaSdPct) / 100) ** 2;
    const k = mVar / (mVar + oVar);
    return { fatFrac: engineFatFrac + k * (dxa.pct / 100 - engineFatFrac), source: 'dxa' };
  }
  let frac = engineFatFrac;
  let used: Array<'bia' | 'girth'> = [];
  const bia = weeklyMeans((readings.bodyFatBia ?? []).filter((b) => Number.isFinite(b.pct)).map((b) => ({ day: b.day, v: b.pct / 100 })), day, 4);
  if (bia.length > 0) {
    const oVar = (prm.biaSdPct / 100) ** 2 / bia.length;
    const k = Math.min(prm.biaMaxGain, mVar / (mVar + oVar));
    const obs = bia.reduce((s, b) => s + b.mean, 0) / bia.length;
    frac += k * (obs - frac);
    used = [...used, 'bia'];
  }
  const waist = weeklyMeans((readings.waist ?? []).map((w) => ({ day: w.day, v: w.cm })), day, 6);
  const engWaist = replay.result.daily.waist;
  if (waist.length >= prm.girthMinWeeks && engWaist) {
    // engine sensitivity: waist change per kg fat over the replayed window
    const d0 = Math.max(replay.startDay, day - 7 * waist.length);
    const d1 = Math.min(day - 1, engWaist.length - 1);
    const dFat = replay.fatKg[d1]! - replay.fatKg[d0]!;
    const dWaist = engWaist[d1]! - engWaist[d0]!;
    if (Math.abs(dFat) >= 0.5 && Number.isFinite(dWaist) && dWaist / dFat > 0.1) {
      const sens = dWaist / dFat; // cm per kg fat
      let resid = 0;
      for (const w of waist) {
        const e = engWaist[Math.min(Math.max(w.day, replay.startDay), engWaist.length - 1)]!;
        resid += w.mean - e;
      }
      resid /= waist.length;
      const fatResidKg = resid / sens;
      const oVar = ((prm.girthSdCm / Math.sqrt(waist.length)) / sens / targetTissueKg) ** 2;
      const k = Math.min(prm.biaMaxGain, mVar / (mVar + oVar));
      frac += k * (fatResidKg / targetTissueKg);
      used = [...used, 'girth'];
    }
  }
  if (used.length === 0) return null;
  return { fatFrac: frac, source: used.length === 2 ? 'bia+girth' : used[0]! };
}

export function runCheckIn(i: CheckInInput): CheckInOutput {
  const prm = i.params ?? ASSIMILATION_DEFAULTS;
  const day = i.day;
  const wDays = i.weighIns.map((o) => o.day);
  const in7 = countWeighIns(wDays, day, 7);
  const in14 = countWeighIns(wDays, day, 14);
  const keep: EnergyBiasEstimate = { mean: i.previousBias.mean, sd: i.previousBias.sd, updated: false };
  const gateOk = in7 >= prm.checkInMin7 || in14 >= prm.checkInMin14 || (i.hard === true && (countWeighIns(wDays, day, 3) >= 1 || !!i.composition?.dxa));
  const none: CheckInOutput = { verdict: 'notEnoughWeighIns', day, in7, in14, trend: null, points: [], dowOffsets: null, bias: keep, anchor: null, residualSplit: null, intakeOffset: null, snapshot: null, replay: null };
  if (!gateOk) return none;

  // 1. replay with what is known so far, through the check-in morning
  const horizon = Math.max(i.schedule.horizonDays, day + 1);
  const schedule = horizon === i.schedule.horizonDays ? i.schedule : { ...i.schedule, horizonDays: horizon };
  const r0 = runReplay({ profile: i.profile, schedule, anchors: i.anchors, intakeOffsets: i.intakeOffsets, captureAt: [day] });
  const snap0 = r0.snapshots[day];
  if (!snap0) throw new Error(`check-in day ${day} is outside the realised schedule`);

  // 2. residualised weigh-ins (engine water that morning), day-of-week offset, filter
  const obs: WeighInObs[] = i.weighIns
    .filter((o) => o.day <= day && o.day >= 0 && Number.isFinite(r0.waterWakeKg[o.day]!))
    .map((o) => ({ ...o, waterKg: r0.waterWakeKg[o.day]! }));
  const dow = estimateDowOffsets(obs, i.startWeekday, prm);
  const firstObs = obs.length > 0 ? Math.min(...obs.map((o) => o.day)) : day;
  const rateGuess = Number.isFinite(r0.tissuePathKg[firstObs + 1]!) && Number.isFinite(r0.tissuePathKg[firstObs]!) ? r0.tissuePathKg[firstObs + 1]! - r0.tissuePathKg[firstObs]! : 0;
  const filt = runTrendFilter(obs, { params: prm, untilDay: day, rateGuess, ...(dow ? { dow: { offsets: dow, startWeekday: i.startWeekday } } : {}) });
  const last = filt.points[filt.points.length - 1];
  if (!last) return none;
  const trend = { w: last.w, wSd: last.wSd, r: last.r, rSd: last.rSd };

  // 3. δ over the window (jump-free engine path of r0, which already carried the δ in force)
  const deltaApplied = (() => {
    let v = 0;
    for (const o of [...i.intakeOffsets].sort((a, b) => a.fromDay - b.fromDay)) if (o.fromDay <= day) v = o.kcal;
    return v;
  })();
  const winLo = day - prm.biasWindowDays;
  const winPts = filt.points
    .filter((p) => p.observed && !p.flagged && p.day > winLo && p.day <= day && p.y !== undefined && Number.isFinite(r0.tissuePathKg[p.day]!))
    .map((p) => ({ day: p.day, y: p.y!, engineKg: r0.tissuePathKg[p.day]! }));
  const dLo = Math.max(r0.startDay, winLo, 0);
  const dHi = Math.max(dLo, day - 1);
  let aF = 0;
  let aL = 0;
  for (const a of r0.anchorsApplied) if (a.day > dLo && a.day <= dHi) {
    aF += a.dFatKg;
    aL += a.dLeanKg;
  }
  const rho = mixDensity(r0.fatKg[dHi]! - r0.fatKg[dLo]! - aF, r0.leanKg[dHi]! - r0.leanKg[dLo]! - aL, snapshotFatKg(snap0));
  const intakeSet = new Set(i.intakeDays);
  let wk1 = 0;
  let wk2 = 0;
  for (const d of intakeSet) {
    if (d < day && d >= day - 7) wk1++;
    else if (d < day - 7 && d >= day - 14) wk2++;
  }
  const bias = estimateEnergyBias({
    points: winPts,
    rhoKcalPerKg: rho,
    sigmaKg: prm.sigmaRel * trend.w,
    deltaApplied,
    previous: i.previousBias,
    intakeDaysWeek1: wk1,
    intakeDaysWeek2: wk2,
    ...(i.aiEnergyShare !== undefined ? { aiEnergyShare: i.aiEnergyShare } : {}),
    params: prm,
  });

  // 4. anchor: midnight tissue + (filtered morning trend − engine morning tissue); split by partition or readings
  const tissueMidnight = snapshotTissueKg(snap0);
  const engineMorning = r0.tissueWakeKg[day]!;
  const target = tissueMidnight + (trend.w - (Number.isFinite(engineMorning) ? engineMorning : tissueMidnight));
  const engineFatFrac = snapshotFatKg(snap0) / tissueMidnight;
  const comp = compositionTarget(day, engineFatFrac, target, i.composition, r0, prm);
  const anchor: AnchorSpec = { day, tissueMassKg: target, ...(comp ? { split: { fatFrac: comp.fatFrac } } : {}) };
  const anchors = [...i.anchors.filter((a) => a.day !== day), anchor].sort((a, b) => a.day - b.day);
  const intakeOffset: IntakeOffset | null = bias.updated && bias.mean !== deltaApplied ? { fromDay: day, kcal: bias.mean } : null;
  const offsets = intakeOffset ? [...i.intakeOffsets.filter((o) => o.fromDay !== day), intakeOffset] : [...i.intakeOffsets];

  // 5. confirmed replay: from the cached state of the anchor day (identical past), anchor applied at its start
  const r1 = runReplay({ profile: i.profile, schedule, anchors, intakeOffsets: offsets, from: snap0, captureAt: [day] });
  const snapshot = r1.snapshots[day] ?? null;
  const applied = r1.anchorsApplied.find((a) => a.day === day);
  return {
    verdict: 'confirmed',
    day,
    in7,
    in14,
    trend,
    points: filt.points,
    dowOffsets: dow,
    bias,
    anchor,
    residualSplit: applied
      ? { residualKg: applied.tissueAfterKg - applied.tissueBeforeKg, fatKg: applied.dFatKg, leanKg: applied.dLeanKg, source: comp ? comp.source : 'engine' }
      : null,
    intakeOffset,
    snapshot,
    replay: r1,
  };
}
