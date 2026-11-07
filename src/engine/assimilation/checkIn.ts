/**
 * Weekly check-in (docs/SUITE_SPEC.md §3.5 steps 4-7; R11 §3.3; reviewed 2026-10-18: C4, D5-03, D5-04, D5-07): trend
 * filter → balance correction δ → anchor (tissue mass to the filtered trend, residual split by the engine's partition,
 * optionally re-split by body-composition readings at their own time) → confirmed day-stamped engine snapshot. Pure and
 * deterministic: the inputs are the plan's documents (baseline profile, realised schedule, earlier anchors and δ steps,
 * weigh-ins, measurements).
 *
 * Balance correction (D5-03/D5-04): a fixed-prior refit of the window on each eligible decision. The production
 * measurement replays the exact application law over the window from the window-start state (past anchors fixed, actual
 * correction history before the window) and fits one scalar residual plus a free intercept to the weigh-ins under the
 * 'scaleWake' operator with their own variances (`fitReplayResidual`); the numerical response replaces a universal energy
 * density. The linear applied-history algebra is kept as a diagnostic. Controller bounds count from the correction in
 * force a week before (retries earn no step); no new weigh-in since the last decision → no update.
 *
 * Intake evidence (D6-06): per-day energy coverage, amount methods and shared-error groups decide calibration eligibility
 * and are summarised beside the estimate; they never weight the weight residual (no SD is invented for a method or a
 * source), and a shared-error group recurring on several days is one persistent error that δ absorbs, never averaged down
 * as independent daily noise. Partial logs keep the weight trend and the anchor; only the correction waits.
 *
 * Composition (D5-07, `compositionTarget`; re-audit A1-018/A1-019/A1-038): each effective observation — one per raw-scan
 * lineage — is compared ONCE (consumed ids, or for id-less legacy readings any reading on or before the last decision day
 * counts as consumed) with the model at its own time through a method-specific operator — scan FM kg, or % × the same
 * scan's mass, else % of the predicted measured total mass at the reading's instant — and the innovation is carried
 * forward. Readings of one device share a stable bias whose variance never collapses, while earlier decisions are
 * replayed once through the same joint state, so later readings of a known device still carry change information
 * (labelled a scenario). Waist updates fat only through an explicitly supplied personal operator; otherwise it is
 * corroborative. The tissue total is never changed by composition readings. Weigh-ins are residualised with the model
 * water of their own hour (A1-018). A `recompute` run re-derives an existing decision's anchor with its correction fixed.
 *
 * The confirmed snapshot is the state at the START of the check-in day with the new anchor applied; together with δ and the
 * trend it forms PLANNER_V2's `ConfirmedState`. The record that syncs stores only numbers; the snapshot is rebuilt by
 * `runReplay` with the stored anchors and cached locally.
 */
import type { ChannelCoverage, OccurrenceTime, UncertaintyGroup } from '@/lib/bodyContracts';
import type { BodyCompositionMethod } from '@/lib/measurementOperators';
import { fatMassObservation } from '@/lib/measurementOperators';
import {
  estimateEnergyBias,
  fitReplayResidual,
  linearBalanceMeasurement,
  mixDensityInfo,
  type BalanceMeasurement,
  type BiasWindowPoint,
  type EnergyBiasEstimate,
} from './energyBias';
import { ASSIMILATION_DEFAULTS, CORRECTION_STEP_PERIOD_DAYS, estimatorIdentity, type AssimilationParams, type EstimatorIdentity } from './params';
import { reanchorSnapshot } from './reanchor';
import { runReplay, sampleAt, snapshotFatKg, snapshotTissueKg, type ObservationTiming, type OwnTimeSample, type ReplayOutput } from './replay';
import { CORRECTION_MECHANISM } from './runHooks';
import { countWeighIns, estimateDowOffsets, runTrendFilter, type TrendPoint, type WeighInObs } from './trendFilter';
import type { AnchorSpec, EngineSnapshot, IntakeOffset, OffsetApplied } from '../types/result';
import type { PersonProfile } from '../types/profile';
import type { Schedule } from '../types/schedule';

/** One body-composition reading as measured (C4/D5-07); structurally compatible with `BodyCompositionObservation`. */
export interface CompositionReading {
  /** Observation id; with `revision` the consumed key is `id@revision`. */
  observationId?: string;
  revision?: number;
  /** Plan day of the reading (its own occurrence day, never the entry day). */
  day: number;
  method: BodyCompositionMethod;
  /** Reported body fat, % of the device's own measured mass. */
  bodyFatPct?: number;
  /** Scan fat mass and scan total mass, kg (preferred over a percentage). */
  scanFatMassKg?: number;
  scanMassKg?: number;
  device?: string;
  protocol?: string;
  /** Observations this one was derived from (raw scan, impedance record…): one lineage is one effective observation. */
  parents?: readonly string[];
  /** Short-term repeatability and non-vanishing device/method bias SDs, percentage points. */
  repeatabilitySdPct?: number;
  systematicSdPct?: number;
  /** (A1-018) when on `day` it was taken; absent = untimed (the daily wake convention, labelled as such). */
  timing?: ObservationTiming;
  /** (C1/A1-018) the occurrence as recorded (zone, date meaning), carried for provenance. */
  occurrence?: OccurrenceTime;
}

type LegacyExtras = Partial<Pick<CompositionReading, 'observationId' | 'revision' | 'scanFatMassKg' | 'scanMassKg' | 'device' | 'protocol' | 'repeatabilitySdPct' | 'systematicSdPct' | 'parents' | 'timing'>>;

export interface CompositionReadings {
  /** Legacy form: consumer body-fat readings (BIA scales), %. */
  bodyFatBia?: ReadonlyArray<{ day: number; pct: number } & LegacyExtras>;
  /** Legacy form: one DXA or clinical body-fat reading, %, with its total SD (one reading's SD). */
  dxa?: { day: number; pct: number; sdPct?: number } & LegacyExtras;
  /** Readings with method/device/scan metadata (preferred form). */
  readings?: readonly CompositionReading[];
  /** Waist girths (mean of the 2-3 repeats per sitting), cm: an observed outcome, corroborative without `girthOperator`. */
  waist?: ReadonlyArray<{ day: number; cm: number; observationId?: string }>;
  /** A personal waist operator validated on this person's own data (cm per kg fat and its SD); absent = corroborative. */
  girthOperator?: { cmPerKgFat: number; sdCm: number };
}

/** (D6-06/C1) One day's intake evidence as the realised history reports it (`LoggedDayResult`). */
export interface IntakeDayEvidence {
  day: number;
  /** Energy-channel coverage of the day (C1). */
  coverage: ChannelCoverage;
  /** May enter the balance calibration; default: complete quantitative or confirmed zero. */
  calibrationEligible?: boolean;
  /** Logged components by amount method (weighed, labelServing, household, userEstimated, photoEstimated, unknown). */
  amountMethods?: Readonly<Partial<Record<string, number>>>;
  /** Shared-error groups of the day's meal components (C3). */
  uncertaintyGroups?: ReadonlyArray<Pick<UncertaintyGroup, 'id' | 'kind'>>;
}

/** (D6-06) The window's intake evidence, reported beside the estimate and kept out of the weight likelihood. */
export interface IntakeEvidenceSummary {
  /** Window days with evidence, by energy coverage (a day without evidence is not counted, never assumed complete). */
  byCoverage: Record<ChannelCoverage, number>;
  /** Calibration-eligible days in the last 7 days and the 7 before (the gate's counts). */
  eligibleWeek1: number;
  eligibleWeek2: number;
  /** Logged components in the window by amount method, as reported (no method earns a precision). */
  amountMethods: Record<string, number>;
  /** Shared-error group ids present on two or more window days: one persistent error each, never averaged by repeats. */
  recurringGroups: string[];
  /** Window days whose intake shares one of those groups. */
  daysWithRecurringGroup: number;
  /** Persistent intake error and expenditure error enter δ as one net residual (weight alone cannot separate them). */
  interpretation: 'netResidual';
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
  /** Plan days whose intake may enter the balance estimate (calibration-eligible), for the δ gate. */
  intakeDays: readonly number[];
  /** (D6-06) Per-day intake evidence; when given, the δ gate counts its calibration-eligible days instead of `intakeDays`. */
  intakeEvidence?: readonly IntakeDayEvidence[];
  /** Deprecated (D5-04): ignored; an AI-estimated share never changes the weight of the residual. */
  aiEnergyShare?: number;
  /** Correction in force before this decision (kept when the estimate is gated); its `sd` is not used as a prior. */
  previousBias: { mean: number; sd: number };
  composition?: CompositionReadings;
  /** Observation (revision) ids consumed by earlier decisions (composition readings are assimilated once). */
  consumedObservationIds?: readonly string[];
  /** Id of the decision this check-in records (stamped on the new δ step). */
  decisionId?: string;
  /** Hard re-anchor (event, DXA, ≥ 14 days without weigh-in): skips the weigh-in count gate (needs one weigh-in in 3 days or a DXA). */
  hard?: boolean;
  params?: AssimilationParams;
  /** (A1-038) Earlier decisions, oldest first: anchor day and the ids each consumed (the device-bias recursion). */
  compositionHistory?: ReadonlyArray<{ day: number; consumed: readonly string[] }>;
  /**
   * (A1-017) Recompute the anchor of an existing decision from the current evidence: the correction stays as applied
   * (no δ estimate, no correction step, no new decision) and no confirmed replay is run.
   */
  recompute?: boolean;
}

export type CheckInVerdict = 'confirmed' | 'notEnoughWeighIns';

export type CompositionSkipReason =
  | 'consumed'
  | 'future'
  | 'nonFinite'
  | 'methodUnknown'
  | 'derivedCorroborative'
  | 'noOperatorPrecision'
  | 'outsideReplay'
  | 'noPersonalOperator'
  /** (A1-019) another record of the same raw scan/lineage is the effective observation (kept as an alternative). */
  | 'lineageAlias'
  /** (A1-019) a new alias of a lineage an earlier decision already consumed: no new information. */
  | 'lineageConsumed'
  /** (A1-018) a timed percent-only reading whose own-time model mass is not available: abstains (never the wake value). */
  | 'instantOperatorUnavailable';

/** (A1-038) One stable device/method group of the composition likelihood (shared bias, own repeatability per reading). */
export interface CompositionGroupEvidence {
  groupId: string;
  method: BodyCompositionMethod;
  device?: string;
  /** `stableAssumed` = a named device with a stable bias; `unknownDevice` = identity not recorded (its own segment per method). */
  bias: 'stableAssumed' | 'unknownDevice';
  /** Effective observations (canonical lineage ids) of the group used by this decision, in occurrence order. */
  observationIds: string[];
  /** Earlier decisions that consumed readings of this group (their innovations are never used again). */
  priorDecisions: number;
  /** True when the group has consumed history, so its new readings carry within-device CHANGE information (scenario). */
  changeInformation: boolean;
  /** Device-change sensitivity is not validated for any device: within-device change stays a scenario. */
  longitudinalSensitivity: 'unknown';
  repeatabilitySdPct: number;
  systematicSdPct: number;
  /** Posterior SD of the group's bias after this decision, percentage points (never below its floor). */
  biasSdPct: number;
}

/** Outcome of the composition step (D5-07): numbers and statuses travel separately (C6). */
export interface CompositionUpdate {
  status: 'updated' | 'noNewReadings' | 'corroborativeOnly' | 'deviceBiasFloor' | 'none';
  /** Whole-body tissue fat fraction FM/(FM + FFM_act) for the anchor split (only when updated). */
  fatFrac?: number;
  fatKg?: number;
  source?: 'dxa' | 'bia' | 'girth' | 'bia+girth';
  /**
   * Total gain on the decision's combined fat-mass innovation and that innovation, kg (conditional on the stated SDs):
   * the fat update is gain × innovation. `innovationSdKg` is the SD of the measurement part of that innovation.
   */
  gain?: number;
  innovationKg?: number;
  innovationSdKg?: number;
  /** (A1-038) SD of the absolute fat level after the update, kg (keeps the device-bias floor). */
  levelSdKg?: number;
  /** Ids (with revision) assimilated by this decision, lineage aliases included (each is evidence once). */
  consumedObservationIds: string[];
  used: Array<{ observationId?: string; day: number; method: BodyCompositionMethod | 'waist'; operator: string; innovationKg: number; timing?: ObservationTiming['precision']; at?: 'scanMass' | 'hour' | 'interval' | 'wakeConvention' }>;
  skipped: Array<{ observationId?: string; day: number; reason: CompositionSkipReason }>;
  /** (A1-019) Records of one raw scan collapsed into one effective observation: canonical id, aliases, largest disagreement, kg. */
  lineage: Array<{ canonical: string; aliases: string[]; spreadKg: number }>;
  /** (A1-038) Device groups of the joint likelihood. */
  groups: CompositionGroupEvidence[];
  /** (A1-038) Set when within-device change information was used: it rests on a stable-bias assumption (scenario). */
  longitudinal?: { status: 'scenario'; reasonCode: 'stableDeviceBiasAssumed' };
  uncertaintyKind: 'conditionalResidual';
  coverage: 'unvalidated';
  /** Named assumptions behind the numbers (e.g. the provisional SD used for both error components). */
  assumptions: string[];
}

/** The balance-correction ledger entry of a decision (D5-03), matching `ConfirmedStateRecord.correction`. */
export interface CorrectionEntry {
  requestedKcal: number;
  appliedKcal: number;
  saturated: boolean;
  stepLimited: boolean;
  mechanism: typeof CORRECTION_MECHANISM;
}

export interface CheckInOutput {
  verdict: CheckInVerdict;
  day: number;
  in7: number;
  in14: number;
  /** Filter at the check-in day (morning), kg and kg/d (conditional SDs). */
  trend: { w: number; wSd: number; r: number; rSd: number } | null;
  /** The filtered series up to the check-in (display, drift). */
  points: TrendPoint[];
  dowOffsets: number[] | null;
  bias: EnergyBiasEstimate;
  /** (D5-03) linear applied-history diagnostic and how the production measurement was obtained. */
  biasDiagnostics: {
    linear: BalanceMeasurement | null;
    rhoKcalPerKg: number;
    rhoSource: 'windowMix' | 'forbesFallback';
    /** True when the actually applied correction was the same on every window day (only then is "latest δ" exact). */
    constantApplication: boolean;
    replayRuns: number;
  } | null;
  anchor: AnchorSpec | null;
  /** How the residual was split and what set it. */
  residualSplit: { residualKg: number; fatKg: number; leanKg: number; source: 'engine' | 'bia' | 'girth' | 'bia+girth' | 'dxa' } | null;
  composition: CompositionUpdate | null;
  /** δ step to append (from the check-in day), with its mechanism, request and decision. */
  intakeOffset: IntakeOffset | null;
  /** (D5-03) requested vs applied correction of this decision; null when the estimate was not updated. */
  correction: CorrectionEntry | null;
  /** (D5-03) correction actually applied on each window day before the check-in (realised history). */
  offsetsApplied: OffsetApplied[];
  /** (D6-06) intake evidence of the window, when the caller supplied it. */
  intakeEvidence: IntakeEvidenceSummary | null;
  /** (C7/D5-04) estimator strategy, version and parameter hash of this decision. */
  estimator: EstimatorIdentity;
  /** Observation (revision) ids this decision consumed: window weigh-ins and newly assimilated composition readings. */
  consumedObservationIds: string[];
  /** Confirmed state at the start of `day` (anchor applied), and the replay that produced it. */
  snapshot: EngineSnapshot | null;
  replay: ReplayOutput | null;
}

const COVERAGES: readonly ChannelCoverage[] = ['unknown', 'partial', 'complete', 'confirmedZero', 'asPlannedEstimate'];
/** Weakest-first order for a day reported more than once. */
const COVERAGE_RANK: Record<ChannelCoverage, number> = { unknown: 0, asPlannedEstimate: 1, partial: 2, complete: 3, confirmedZero: 3 };

/** One record per day: a day is eligible only if every record of it is (two versions are never both counted, C1). */
function mergeIntakeEvidence(ev: readonly IntakeDayEvidence[]): Map<number, { eligible: boolean; records: IntakeDayEvidence[] }> {
  const by = new Map<number, { eligible: boolean; records: IntakeDayEvidence[] }>();
  for (const e of ev) {
    if (!Number.isInteger(e.day)) continue;
    const ok = e.calibrationEligible ?? (e.coverage === 'complete' || e.coverage === 'confirmedZero');
    const cur = by.get(e.day);
    if (cur) {
      cur.eligible = cur.eligible && ok;
      cur.records.push(e);
    } else by.set(e.day, { eligible: ok, records: [e] });
  }
  return by;
}

/** (D6-06) Summary of the evidence on days [from, to): coverage, methods, recurring shared-error groups. */
function summariseIntakeEvidence(by: ReadonlyMap<number, { eligible: boolean; records: readonly IntakeDayEvidence[] }>, from: number, to: number, week: { w1: number; w2: number }): IntakeEvidenceSummary {
  const byCoverage = Object.fromEntries(COVERAGES.map((c) => [c, 0])) as Record<ChannelCoverage, number>;
  const amountMethods: Record<string, number> = {};
  const groupDays = new Map<string, Set<number>>();
  for (const [d, v] of by) {
    if (d < from || d >= to) continue;
    // a day with several records counts under its weakest coverage (eligibility already requires every record)
    const cov = v.records.map((r) => r.coverage).reduce((a, c) => (COVERAGE_RANK[c] < COVERAGE_RANK[a] ? c : a));
    byCoverage[cov] += 1;
    for (const r of v.records) {
      for (const [m, n] of Object.entries(r.amountMethods ?? {})) if (n !== undefined && Number.isFinite(n) && n > 0) amountMethods[m] = (amountMethods[m] ?? 0) + n;
      for (const g of r.uncertaintyGroups ?? []) {
        const s = groupDays.get(g.id) ?? new Set<number>();
        s.add(d);
        groupDays.set(g.id, s);
      }
    }
  }
  const recurring = [...groupDays.entries()].filter(([, s]) => s.size >= 2).map(([id]) => id).sort();
  const shared = new Set<number>();
  for (const id of recurring) for (const d of groupDays.get(id)!) shared.add(d);
  return { byCoverage, eligibleWeek1: week.w1, eligibleWeek2: week.w2, amountMethods, recurringGroups: recurring, daysWithRecurringGroup: shared.size, interpretation: 'netResidual' };
}

const idKey = (o: { observationId?: string; revision?: number }): string | undefined =>
  o.observationId === undefined ? undefined : o.revision !== undefined ? `${o.observationId}@${o.revision}` : o.observationId;

/** Correction in force on `day` from a step list (0 before the first step). */
export function offsetInForce(offsets: readonly IntakeOffset[], day: number): number {
  let v = 0;
  for (const o of [...offsets].sort((a, b) => a.fromDay - b.fromDay)) if (o.fromDay <= day) v = o.kcal;
  return v;
}

/** Legacy fields → readings (an explicit legacy DXA SD is that reading's total SD: all of it treated as persistent). */
function normalizeReadings(r: CompositionReadings): CompositionReading[] {
  const out: CompositionReading[] = [...(r.readings ?? [])];
  for (const b of r.bodyFatBia ?? []) {
    const { pct, ...rest } = b;
    out.push({ ...rest, method: 'bia', bodyFatPct: pct });
  }
  if (r.dxa) {
    const { pct, sdPct, ...rest } = r.dxa;
    out.push({ ...rest, method: 'dxa', bodyFatPct: pct, ...(sdPct !== undefined && rest.systematicSdPct === undefined ? { systematicSdPct: sdPct, repeatabilitySdPct: rest.repeatabilitySdPct ?? 0 } : {}) });
  }
  return out;
}

export interface CompositionTargetInput {
  day: number;
  /** Tissue total the anchor moves to, kg (never changed by composition). */
  targetTissueKg: number;
  /** Fat mass after the engine's own split of the tissue residual, kg. */
  engineFatKg: number;
  /** Fat share (0..1) of a tissue residual under the engine partition. */
  fatShareOfResidual: number;
  readings: CompositionReadings | undefined;
  /** Replay of the realised past BEFORE this anchor (the model path the readings are compared with). */
  replay: ReplayOutput;
  /** Water-adjusted mass trend on a plan day (filter, causal), or null. */
  trendAt: (day: number) => { tissueKg: number; sdKg: number } | null;
  consumed?: ReadonlySet<string>;
  /** Last earlier decision day (−1 = none): id-less readings on or before it were available to it. */
  lastDecisionDay?: number;
  /** (A1-038) Earlier decisions, oldest first (anchor day, ids consumed); absent = rebuilt from the replay's anchor days. */
  history?: ReadonlyArray<{ day: number; consumed: readonly string[] }>;
  params?: AssimilationParams;
}

export { COMPOSITION_ESTIMATOR } from './params';

/** One effective observation in the joint likelihood. */
interface CompObs {
  key?: string;
  o: CompositionReading;
  group: string;
  /** Fat-mass innovation against the current path at the reading's own time, kg (before the bias estimate). */
  innovKg: number;
  /** kg per percentage point of this reading (scan mass, or the own-time predicted mass, / 100). */
  s: number;
  /** Repeatability and mass variance of this reading, kg². */
  r: number;
  rep: number;
  sys: number;
  operator: string;
  at: 'scanMass' | 'hour' | 'interval' | 'wakeConvention';
  /** Lineage rank: explicit scan FM 3, % × the same scan's mass 2, percent only 1. */
  rank: number;
}

/**
 * Joint state of the composition likelihood (A1-038): x = [e, b_1 … b_G] with e the fat error of the current path at the
 * decision (kg) and b_g the bias of device group g (percentage points). Before each decision the path has absorbed the
 * earlier fat corrections (mean of e = 0) and Var(e) is restored to the fixed prior P (the fixed-prior convention as
 * process noise; covariances with the biases are kept); the biases are constant (stable device), so a reading of a
 * group with history carries bias-free CHANGE information while the absolute bias variance keeps its floor.
 */
class JointCompositionState {
  readonly groups: string[] = [];
  readonly b: number[] = [];
  C: number[][] = [[0]];
  constructor(P0: number) {
    this.C = [[P0]];
  }
  index(group: string, sysPct: number): number {
    const k = this.groups.indexOf(group);
    if (k >= 0) return k + 1;
    this.groups.push(group);
    this.b.push(0);
    const m = this.C.length;
    this.C = this.C.map((row) => [...row, 0]);
    this.C.push([...Array(m).fill(0), sysPct * sysPct]);
    return m;
  }
  /**
   * One decision's batch of rows h·x = ν (+ noise r): the optimal update by sequential scalar steps (exactly the batch
   * GLS for a linear-Gaussian model), its total gain on a common innovation, then the applied gain D·K (D = f·I for a
   * policy cap, or the e-row zeroed when the absolute level carries no positive information) with the exact covariance of
   * that suboptimal gain: C' = C − DA − AD + DAD, A = C − C⁺.
   */
  update(Pk: number, rows: ReadonlyArray<{ h: readonly number[]; nu: number; r: number }>, cap: number | null): { eUpdate: number; gain: number; gainUncapped: number; nuCombined: number; varE: number; measVar: number; floor: boolean } {
    const m = this.C.length;
    this.C[0]![0] = Math.max(Pk, this.C[0]![0]!);
    const C0 = this.C.map((row) => [...row]);
    const C = this.C.map((row) => [...row]);
    const x = Array(m).fill(0) as number[];
    const x1 = Array(m).fill(0) as number[];
    for (const row of rows) {
      const Ch = C.map((ci) => ci.reduce((a, c, j) => a + c * row.h[j]!, 0));
      const sVar = row.h.reduce((a, hj, j) => a + hj * Ch[j]!, 0) + row.r;
      if (!(sVar > 1e-12) || !Number.isFinite(sVar)) continue;
      const k = Ch.map((v) => v / sVar);
      const hx = row.h.reduce((a, hj, j) => a + hj * x[j]!, 0);
      const hx1 = row.h.reduce((a, hj, j) => a + hj * x1[j]!, 0);
      for (let j = 0; j < m; j++) {
        x[j]! += k[j]! * (row.nu - hx);
        x1[j]! += k[j]! * (1 - hx1);
      }
      for (let a = 0; a < m; a++) for (let c = 0; c < m; c++) C[a]![c]! -= k[a]! * Ch[c]!;
    }
    const g = x1[0]!;
    const floor = !(g > 1e-12);
    const f = floor ? 1 : cap !== null && g > cap ? cap / g : 1;
    const d = Array.from({ length: m }, (_, j) => (j === 0 && floor ? 0 : f));
    const A = C0.map((row, a) => row.map((v, c) => v - C[a]![c]!));
    this.C = C0.map((row, a) => row.map((v, c) => v - d[a]! * A[a]![c]! - A[a]![c]! * d[c]! + d[a]! * A[a]![c]! * d[c]!));
    for (let j = 1; j < m; j++) this.b[j - 1]! += d[j]! * x[j]!;
    const eUpdate = d[0]! * x[0]!;
    const gain = d[0]! * g;
    const P = C0[0]![0]!;
    return { eUpdate, gain, gainUncapped: g, nuCombined: gain > 1e-12 ? eUpdate / gain : Number.NaN, varE: this.C[0]![0]!, measVar: g > 1e-12 && g < 1 ? (P * (1 - g)) / g : 0, floor };
  }
}

/**
 * Composition re-split at the anchor (D5-07), or a status without a split.
 *
 * Own time (A1-018): each reading is compared with the model at its own time — FM_pred = FM_model(start of its day) +
 * share·(trend(d) − tissue_model(d)); scan FM kg, or % × that scan's own mass, needs no model mass; a percent-only reading
 * uses the predicted measured mass at its instant (hourly model water; an interval's mean with its spread), and a
 * date-only one the day's wake mass as the declared daily convention. A timed reading whose own-time mass is unavailable
 * abstains.
 *
 * Lineage (A1-019): records sharing an observation id, a parent or any ancestor (transitively, also through records that
 * are themselves skipped) are ONE effective observation; the canonical record is the explicit scan FM, else % × the same
 * scan's mass, else the percentage (then DXA before BIA, then the smallest id). The others are kept as aliases with their
 * disagreement (`lineage`), never averaged in. A lineage an earlier decision consumed (any member, or a consumed id that
 * is an ancestor) gives no new information to a later alias. Distinct raw scans are never merged for equal values.
 *
 * Likelihood (A1-038): readings of a device group share one bias b_g ~ N(0, sys²) (percentage points; kg via each
 * reading's own mass) and carry their own repeatability; the fat error e of the path has the fixed prior P at each
 * decision. Earlier decisions are replayed through the same joint state once each (their innovations against the same
 * path at their own times), so a new reading of a known device carries bias-free change information while the absolute
 * bias variance never collapses. Consumer devices and personal girth operators move the split by at most `biaMaxGain`.
 */
export function compositionTarget(i: CompositionTargetInput): CompositionUpdate {
  const prm = i.params ?? ASSIMILATION_DEFAULTS;
  const consumed = i.consumed ?? new Set<string>();
  const lastDecision = i.lastDecisionDay ?? -1;
  const out: CompositionUpdate = { status: 'none', consumedObservationIds: [], used: [], skipped: [], lineage: [], groups: [], uncertaintyKind: 'conditionalResidual', coverage: 'unvalidated', assumptions: [] };
  if (!i.readings) return out;
  const r0 = i.replay;
  const fin = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x);
  const fatModelAt = (d: number): number | null => {
    const k = Math.max(d - 1, r0.startDay);
    const v = r0.fatKg[k];
    return fin(v) ? v : null;
  };
  /** Predicted fat mass (start of the reading's day, trend-corrected) and the predicted measured mass at its own time. */
  const predictedAt = (d: number, timing: ObservationTiming | undefined): { fmKg: number; mass: OwnTimeSample | null; massSdKg: number } | null => {
    const fm = fatModelAt(d);
    const tModel = r0.tissueWakeKg[d];
    if (fm === null || !fin(tModel)) return null;
    const tr = i.trendAt(d);
    const tissue = tr ? tr.tissueKg : tModel;
    const water = sampleAt(r0.waterHourKg ?? null, r0.waterWakeKg, d, timing);
    return { fmKg: fm + i.fatShareOfResidual * (tissue - tModel), mass: water ? { ...water, kg: tissue + water.kg } : null, massSdKg: tr ? tr.sdKg : 0 };
  };

  // ---- 1. per-reading operator (own time)
  const all = normalizeReadings(i.readings);
  const cands: CompObs[] = [];
  let anyReading = false;
  let corroborative = false;
  const skip = (o: CompositionReading, reason: CompositionSkipReason) => {
    const k = idKey(o);
    out.skipped.push({ ...(k ? { observationId: k } : {}), day: o.day, reason });
  };
  for (const o of all) {
    anyReading = true;
    if (!Number.isInteger(o.day) || o.day > i.day) {
      skip(o, 'future');
      continue;
    }
    if (o.method === 'navy' || o.method === 'rfm') {
      // derived from girths/anthropometry: never independent evidence about the same source (C4)
      corroborative = true;
      skip(o, 'derivedCorroborative');
      continue;
    }
    if (o.method === 'unknown') {
      skip(o, 'methodUnknown');
      continue;
    }
    if (o.method !== 'dxa' && o.method !== 'bia') {
      corroborative = true;
      skip(o, 'noOperatorPrecision');
      continue;
    }
    const fo = fatMassObservation({ method: o.method, ...(fin(o.bodyFatPct) ? { bodyFatPct: o.bodyFatPct } : {}), ...(fin(o.scanFatMassKg) ? { scanFatMassKg: o.scanFatMassKg } : {}), ...(fin(o.scanMassKg) ? { scanMassKg: o.scanMassKg } : {}) });
    if (!fo) {
      skip(o, 'nonFinite');
      continue;
    }
    const pred = predictedAt(o.day, o.timing);
    if (!pred) {
      skip(o, 'outsideReplay');
      continue;
    }
    let innovKg: number;
    let sKg: number;
    let massVarKg2 = 0;
    let at: CompObs['at'] = 'scanMass';
    const scanMass = fin(o.scanMassKg) && o.scanMassKg > 0 ? o.scanMassKg : null;
    if (fo.kind === 'fatMassKg') {
      innovKg = fo.valueKg - pred.fmKg;
      if (scanMass === null && !(pred.mass && pred.mass.kg > 0)) {
        skip(o, o.timing?.precision === 'instant' || o.timing?.precision === 'interval' ? 'instantOperatorUnavailable' : 'outsideReplay');
        continue;
      }
      sKg = (scanMass ?? pred.mass!.kg) / 100;
    } else {
      if (!pred.mass || !(pred.mass.kg > 0)) {
        skip(o, o.timing?.precision === 'instant' || o.timing?.precision === 'interval' ? 'instantOperatorUnavailable' : 'outsideReplay');
        continue;
      }
      // percent of the predicted measured total mass at the reading's own time: FM_obs ≈ p·M, Var ≈ M²Var(p) + p²Var(M)
      at = pred.mass.at;
      innovKg = (fo.pct * pred.mass.kg) / 100 - pred.fmKg;
      sKg = pred.mass.kg / 100;
      massVarKg2 = (fo.pct / 100) ** 2 * (pred.massSdKg ** 2 + pred.mass.spreadSdKg ** 2);
      if (!out.assumptions.includes('percentOfPredictedMass')) out.assumptions.push('percentOfPredictedMass');
      if (at === 'hour' || at === 'interval') {
        if (!out.assumptions.includes('hourlyModelMass')) out.assumptions.push('hourlyModelMass');
      } else if (!out.assumptions.includes('dailyWakeConvention')) out.assumptions.push('dailyWakeConvention');
    }
    const def = o.method === 'dxa' ? prm.dxaSdPct : prm.biaSdPct;
    const rep = fin(o.repeatabilitySdPct) && o.repeatabilitySdPct >= 0 ? o.repeatabilitySdPct : def;
    const sys = fin(o.systematicSdPct) && o.systematicSdPct >= 0 ? o.systematicSdPct : def;
    if ((!fin(o.repeatabilitySdPct) || !fin(o.systematicSdPct)) && !out.assumptions.includes('provisionalSdForBothComponents')) out.assumptions.push('provisionalSdForBothComponents');
    const k = idKey(o);
    const rank = fin(o.scanFatMassKg) && o.scanFatMassKg >= 0 ? 3 : scanMass !== null ? 2 : 1;
    // a device with no recorded identity is its own segment per method (no stable bias across unknown devices is claimed)
    const group = `${o.method}:${o.device ?? 'unknownDevice'}`;
    cands.push({ ...(k ? { key: k } : {}), o, group, innovKg, s: sKg, r: sKg * sKg * rep * rep + massVarKg2, rep, sys, operator: fo.operator, at, rank });
  }

  // ---- 2. lineage: one effective observation per raw scan / revision chain (A1-019)
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== undefined && parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    if (!parent.has(r)) parent.set(r, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  const node = (o: CompositionReading, idx: number): string => (o.observationId !== undefined ? `o:${o.observationId}` : `anon:${idx}`);
  all.forEach((o, idx) => {
    const n = node(o, idx);
    find(n);
    for (const p of o.parents ?? []) union(n, `o:${p}`);
  });
  const consumedRoots = new Set<string>();
  for (const c of consumed) {
    const at = c.lastIndexOf('@');
    const id = at > 0 && /^\d+$/.test(c.slice(at + 1)) ? c.slice(0, at) : c;
    if (parent.has(`o:${id}`)) consumedRoots.add(find(`o:${id}`));
  }
  const isConsumed = (o: CompositionReading): boolean => {
    const k = idKey(o);
    return k !== undefined ? consumed.has(k) : o.day <= lastDecision;
  };
  const lineages = new Map<string, CompObs[]>();
  for (const c of cands) {
    const r = find(node(c.o, all.indexOf(c.o)));
    const l = lineages.get(r) ?? [];
    l.push(c);
    lineages.set(r, l);
  }
  interface Lineage { root: string; canon: CompObs; members: CompObs[]; consumed: boolean }
  const effective: Lineage[] = [];
  const byKey = (a: CompObs, b: CompObs): number => ((a.key ?? '\uffff') < (b.key ?? '\uffff') ? -1 : (a.key ?? '\uffff') > (b.key ?? '\uffff') ? 1 : 0);
  for (const [root, members] of lineages) {
    // an older revision of an observation id is superseded by its newest one (kept only as an alias)
    const newest = new Map<string, number>();
    for (const m of members) if (m.o.observationId !== undefined) newest.set(m.o.observationId, Math.max(newest.get(m.o.observationId) ?? -Infinity, m.o.revision ?? 0));
    const current = (m: CompObs): boolean => m.o.observationId === undefined || (m.o.revision ?? 0) === newest.get(m.o.observationId);
    const sorted = [...members].sort((a, b) => Number(current(b)) - Number(current(a)) || b.rank - a.rank || (a.o.method === b.o.method ? 0 : a.o.method === 'dxa' ? -1 : 1) || byKey(a, b));
    const canon = sorted[0]!;
    const wasConsumed = consumedRoots.has(root) || members.some((m) => isConsumed(m.o));
    effective.push({ root, canon, members: sorted, consumed: wasConsumed });
    const aliases = sorted.slice(1);
    if (aliases.length > 0) out.lineage.push({ canonical: canon.key ?? `day ${canon.o.day}`, aliases: aliases.map((x) => x.key ?? `day ${x.o.day}`), spreadKg: Math.max(...aliases.map((x) => Math.abs(x.innovKg - canon.innovKg))) });
    for (const m of sorted) {
      const fresh = !isConsumed(m.o);
      if (m === canon) {
        if (wasConsumed) skip(m.o, fresh ? 'lineageConsumed' : 'consumed');
      } else skip(m.o, wasConsumed && fresh ? 'lineageConsumed' : 'lineageAlias');
      // every fresh member of the lineage is evidence once: recorded as consumed by this decision
      if (fresh && m.key && (m !== canon || wasConsumed)) out.consumedObservationIds.push(m.key);
    }
  }
  effective.sort((a, b) => a.canon.o.day - b.canon.o.day || ((a.canon.key ?? '') < (b.canon.key ?? '') ? -1 : 1));

  // ---- 3. earlier decisions (once each), then this one, through one joint state (A1-038)
  const sysOf = new Map<string, number>();
  for (const l of effective) sysOf.set(l.canon.group, Math.max(sysOf.get(l.canon.group) ?? 0, ...l.members.map((m) => m.sys)));
  const massAt = (d: number): number | null => {
    const a = (r0.anchorsApplied ?? []).find((x) => x.day === d);
    const w = r0.waterWakeKg[d];
    const t = a ? a.tissueAfterKg : r0.tissueWakeKg[d];
    return fin(t) && fin(w) ? t + w : null;
  };
  const massNow = i.targetTissueKg + (fin(r0.waterWakeKg[i.day]) ? r0.waterWakeKg[i.day]! : 0);
  const Pof = (mass: number): number => ((prm.modelBfSdPct / 100) * mass) ** 2;
  const prior = effective.filter((l) => l.consumed);
  const fresh = effective.filter((l) => !l.consumed);
  const histDays = (i.history ? i.history.map((h) => h.day) : (r0.anchorsApplied ?? []).map((a) => a.day)).filter((d) => d < i.day);
  const decisions = [...new Set(histDays)].sort((a, b) => a - b).map((day) => ({ day, items: [] as Lineage[] }));
  for (const l of prior) {
    const keys = new Set(l.members.map((m) => m.key).filter((k): k is string => k !== undefined));
    let target = i.history ? decisions.find((d) => i.history!.some((h) => h.day === d.day && h.consumed.some((c) => keys.has(c)))) : undefined;
    target ??= decisions.find((d) => d.day >= l.canon.o.day) ?? decisions[decisions.length - 1];
    if (!target) {
      target = { day: Math.max(lastDecision, l.canon.o.day), items: [] };
      decisions.push(target);
    }
    target.items.push(l);
  }
  const st = new JointCompositionState(0);
  const rowsOf = (items: readonly Lineage[]) =>
    items.map((l) => {
      const gi = st.index(l.canon.group, sysOf.get(l.canon.group) ?? l.canon.sys);
      const h = Array(st.C.length).fill(0) as number[];
      h[0] = 1;
      h[gi] = l.canon.s;
      return { l, gi, h, nu: l.canon.innovKg - l.canon.s * st.b[gi - 1]!, r: l.canon.r };
    });
  const priorDecisions = new Map<string, number>();
  for (const d of decisions.sort((a, b) => a.day - b.day)) {
    if (d.items.length === 0) continue;
    const rows = rowsOf(d.items);
    const width = st.C.length;
    st.update(Pof(massAt(d.day) ?? massNow), rows.map((x) => ({ h: [...x.h, ...Array(width - x.h.length).fill(0)], nu: x.nu, r: x.r })), d.items.some((l) => l.canon.o.method === 'dxa') ? null : prm.biaMaxGain);
    for (const g of new Set(d.items.map((l) => l.canon.group))) priorDecisions.set(g, (priorDecisions.get(g) ?? 0) + 1);
  }

  // waist: an observed outcome; it moves fat only through a personal operator supplied by the caller
  const waist = (i.readings.waist ?? []).filter((w) => Number.isInteger(w.day) && w.day <= i.day && Number.isFinite(w.cm));
  const op = i.readings.girthOperator;
  const engWaist = r0.result.daily.waist;
  let girth: { innovKg: number; varKg2: number; n: number; keys: string[]; items: typeof waist } | null = null;
  if (waist.length > 0) {
    anyReading = true;
    if (!op || !(op.cmPerKgFat > 0) || !(op.sdCm > 0) || !engWaist) {
      corroborative = true;
      for (const w of waist) out.skipped.push({ ...(w.observationId ? { observationId: w.observationId } : {}), day: w.day, reason: 'noPersonalOperator' });
    } else {
      const freshW = waist.filter((w) => !(w.observationId !== undefined ? consumed.has(w.observationId) : w.day <= lastDecision));
      const weeks = new Set(freshW.map((w) => Math.floor((i.day - w.day) / 7)));
      const vals = freshW
        .map((w) => ({ w, e: engWaist[Math.min(Math.max(w.day, r0.startDay), engWaist.length - 1)] }))
        .filter((x) => x.e !== undefined && Number.isFinite(x.e));
      if (vals.length > 0 && weeks.size >= prm.girthMinWeeks) {
        const innov = vals.reduce((s, x) => s + (x.w.cm - x.e!) / op.cmPerKgFat, 0) / vals.length;
        girth = { innovKg: innov, varKg2: (op.sdCm / op.cmPerKgFat) ** 2 / vals.length, n: vals.length, keys: vals.map((x) => x.w.observationId).filter((x): x is string => x !== undefined), items: vals.map((x) => x.w) };
      }
    }
  }

  const freshRows = rowsOf(fresh);
  const width = st.C.length;
  const rows = freshRows.map((x) => ({ h: [...x.h, ...Array(width - x.h.length).fill(0)], nu: x.nu, r: x.r }));
  if (girth) rows.push({ h: [1, ...Array(width - 1).fill(0)], nu: girth.innovKg, r: girth.varKg2 });
  const hasDxa = fresh.some((l) => l.canon.o.method === 'dxa');
  const hasDevice = fresh.some((l) => l.canon.o.method !== 'dxa');
  for (const l of fresh) if (l.canon.key) out.consumedObservationIds.push(l.canon.key);
  if (girth) out.consumedObservationIds.push(...girth.keys);
  out.consumedObservationIds = [...new Set(out.consumedObservationIds)].sort();
  if (rows.length === 0) {
    out.status = prior.length > 0 ? 'noNewReadings' : corroborative ? 'corroborativeOnly' : anyReading ? 'noNewReadings' : 'none';
    return out;
  }
  // consumer readings and personal girth operators only nudge (never override); a DXA re-anchors without a cap
  const u = st.update(Pof(massNow), rows, hasDxa ? null : prm.biaMaxGain);
  for (const g of new Set(fresh.map((l) => l.canon.group))) {
    const ls = fresh.filter((l) => l.canon.group === g);
    const gi = st.groups.indexOf(g) + 1;
    const c = ls[0]!.canon;
    const n = priorDecisions.get(g) ?? 0;
    out.groups.push({
      groupId: g,
      method: c.o.method,
      ...(c.o.device ? { device: c.o.device } : {}),
      bias: c.o.device ? 'stableAssumed' : 'unknownDevice',
      observationIds: ls.map((l) => l.canon.key ?? `day ${l.canon.o.day}`),
      priorDecisions: n,
      changeInformation: n > 0,
      longitudinalSensitivity: 'unknown',
      repeatabilitySdPct: Math.max(...ls.map((l) => l.canon.rep)),
      systematicSdPct: sysOf.get(g) ?? c.sys,
      biasSdPct: Math.sqrt(Math.max(0, st.C[gi]![gi]!)),
    });
  }
  if (out.groups.some((g) => g.changeInformation)) {
    out.longitudinal = { status: 'scenario', reasonCode: 'stableDeviceBiasAssumed' };
    if (!out.assumptions.includes('stableDeviceBias')) out.assumptions.push('stableDeviceBias');
  }
  for (const x of freshRows) out.used.push({ ...(x.l.canon.key ? { observationId: x.l.canon.key } : {}), day: x.l.canon.o.day, method: x.l.canon.o.method, operator: x.l.canon.operator, innovationKg: x.l.canon.innovKg, timing: x.l.canon.o.timing?.precision ?? 'dateOnly', at: x.l.canon.at });
  if (girth) for (const w of girth.items) out.used.push({ ...(w.observationId ? { observationId: w.observationId } : {}), day: w.day, method: 'waist', operator: 'waist', innovationKg: girth.innovKg });
  if (u.floor) {
    // the readings inform only the device bias: the absolute level stays at the device-bias floor this decision
    out.status = 'deviceBiasFloor';
    out.levelSdKg = Math.sqrt(Math.max(0, u.varE));
    return out;
  }
  const fatKg = i.engineFatKg + u.eUpdate;
  out.status = 'updated';
  out.fatKg = fatKg;
  out.fatFrac = fatKg / i.targetTissueKg;
  out.gain = u.gain;
  out.innovationKg = u.nuCombined;
  out.innovationSdKg = Math.sqrt(u.measVar);
  out.levelSdKg = Math.sqrt(Math.max(0, u.varE));
  out.source = hasDxa ? 'dxa' : hasDevice && girth ? 'bia+girth' : girth ? 'girth' : 'bia';
  return out;
}

/**
 * Production measurement of δ (D5-03): replay the exact application law over the window from the window-start state
 * (`r0.snapshots[s0]`, i.e. past anchors and the actual correction history fixed), with a constant trial δ on every window
 * day; fit δ and a free intercept to the weigh-ins under 'scaleWake' (jump-free path) by weighted robust least squares on
 * the numerical response; one secant refinement for the nonlinear response (TEF, macro-scaled channels). Null when the
 * window cannot be replayed or the response has no spread.
 */
function replayResidualMeasurement(
  i: CheckInInput,
  schedule: Schedule,
  r0: ReplayOutput,
  s0: number,
  day: number,
  pts: ReadonlyArray<{ day: number; scaleKg: number; varKg2: number }>,
  prm: AssimilationParams,
): { measurement: BalanceMeasurement; runs: number } | null {
  const from = s0 > 0 ? r0.snapshots[s0] : undefined;
  if (s0 > 0 && !from) return null;
  const shortSchedule = day + 1 < schedule.horizonDays ? { ...schedule, horizonDays: day + 1 } : schedule;
  const before = i.intakeOffsets.filter((o) => o.fromDay < s0);
  let runs = 0;
  const pathAt = (delta: number): number[] | null => {
    runs++;
    const r = runReplay({ profile: i.profile, schedule: shortSchedule, anchors: i.anchors, intakeOffsets: [...before, { fromDay: s0, kcal: delta }], ...(from ? { from } : {}) });
    const p = pts.map((x) => r.scalePathKg[x.day]!);
    return p.every((x) => Number.isFinite(x)) ? p : null;
  };
  const obs = pts.map((p) => p.scaleKg);
  const vars = pts.map((p) => p.varKg2);
  const h = 100;
  const p0 = pathAt(0);
  const ph = p0 ? pathAt(h) : null;
  if (!p0 || !ph) return null;
  const m1 = fitReplayResidual(obs.map((y, k) => y - p0[k]!), ph.map((y, k) => (y - p0[k]!) / h), vars, prm);
  if (!m1) return null;
  let delta = m1.value;
  let meas: BalanceMeasurement = m1;
  if (Math.abs(delta) > 1 && Math.abs(delta - h) > 1) {
    const pd = pathAt(delta);
    if (pd) {
      const ref = Math.abs(delta) <= Math.abs(delta - h) ? { d: 0, p: p0 } : { d: h, p: ph };
      const m2 = fitReplayResidual(obs.map((y, k) => y - pd[k]!), pd.map((y, k) => (y - ref.p[k]!) / (delta - ref.d)), vars, prm);
      if (m2) {
        delta += m2.value;
        meas = m2;
      }
    }
  }
  return { measurement: { ...meas, value: delta, method: 'replayResidual' }, runs };
}

export function runCheckIn(i: CheckInInput): CheckInOutput {
  const prm = i.params ?? ASSIMILATION_DEFAULTS;
  const day = i.day;
  const wDays = i.weighIns.map((o) => o.day);
  const in7 = countWeighIns(wDays, day, 7);
  const in14 = countWeighIns(wDays, day, 14);
  const keep: EnergyBiasEstimate = { mean: i.previousBias.mean, sd: i.previousBias.sd, updated: false };
  const estimator = estimatorIdentity(prm);
  const gateOk = in7 >= prm.checkInMin7 || in14 >= prm.checkInMin14 || (i.hard === true && (countWeighIns(wDays, day, 3) >= 1 || !!i.composition?.dxa || (i.composition?.readings ?? []).some((r) => r.method === 'dxa' && r.day <= day && r.day > day - 3)));
  const none: CheckInOutput = {
    verdict: 'notEnoughWeighIns', day, in7, in14, trend: null, points: [], dowOffsets: null, bias: keep, biasDiagnostics: null, anchor: null, residualSplit: null,
    composition: null, intakeOffset: null, correction: null, offsetsApplied: [], intakeEvidence: null, estimator, consumedObservationIds: [], snapshot: null, replay: null,
  };
  if (!gateOk) return none;

  // 1. replay with what is known so far, through the check-in morning (window-start state captured for the refit); the
  // hourly scale/water paths are kept when a reading has its own clock time (A1-018)
  const horizon = Math.max(i.schedule.horizonDays, day + 1);
  const schedule = horizon === i.schedule.horizonDays ? i.schedule : { ...i.schedule, horizonDays: horizon };
  const winLo = day - prm.biasWindowDays;
  const s0 = Math.max(0, winLo + 1);
  const timed = (t: ObservationTiming | undefined): boolean => t?.precision === 'instant' || t?.precision === 'interval';
  const hourly = i.weighIns.some((o) => timed(o.timing)) || (i.composition?.readings ?? []).some((r) => timed(r.timing)) || (i.composition?.bodyFatBia ?? []).some((r) => timed(r.timing)) || timed(i.composition?.dxa?.timing);
  // a recomputation needs the path only through the anchor morning (no correction fit, no forecast)
  const replaySchedule = i.recompute && day + 1 < schedule.horizonDays ? { ...schedule, horizonDays: day + 1 } : schedule;
  const r0 = runReplay({ profile: i.profile, schedule: replaySchedule, anchors: i.anchors, intakeOffsets: i.intakeOffsets, captureAt: s0 > 0 && s0 < day && !i.recompute ? [s0, day] : [day], ...(hourly ? { hourly: true } : {}) });
  const snap0 = r0.snapshots[day];
  if (!snap0) throw new Error(`check-in day ${day} is outside the realised schedule`);

  // 2. residualised weigh-ins (engine water at each reading's own time: the hour of an exact instant, the mean over an
  // interval with its spread as water SD, the wake water for a date-only reading), day-of-week offset, filter
  const obs: WeighInObs[] = [];
  for (const o of i.weighIns) {
    if (o.day > day || o.day < 0) continue;
    const w = sampleAt(r0.waterHourKg, r0.waterWakeKg, o.day, o.timing);
    if (!w) continue;
    const sd = o.waterSdKg !== undefined && Number.isFinite(o.waterSdKg) ? Math.hypot(o.waterSdKg, w.spreadSdKg) : w.spreadSdKg;
    obs.push({ ...o, waterKg: w.kg, ...(sd > 0 ? { waterSdKg: sd } : {}) });
  }
  const dow = estimateDowOffsets(obs, i.startWeekday, prm);
  const firstObs = obs.length > 0 ? Math.min(...obs.map((o) => o.day)) : day;
  const rateGuess = Number.isFinite(r0.tissuePathKg[firstObs + 1]!) && Number.isFinite(r0.tissuePathKg[firstObs]!) ? r0.tissuePathKg[firstObs + 1]! - r0.tissuePathKg[firstObs]! : 0;
  const filt = runTrendFilter(obs, { params: prm, untilDay: day, rateGuess, ...(dow ? { dow: { offsets: dow, startWeekday: i.startWeekday } } : {}) });
  const last = filt.points[filt.points.length - 1];
  if (!last) return none;
  const trend = { w: last.w, wSd: last.wSd, r: last.r, rSd: last.rSd };

  // 3. δ: fixed-prior refit of the window against the realised application history
  const inForce = i.intakeOffsets.length > 0 ? offsetInForce(i.intakeOffsets, day) : i.previousBias.mean;
  const stepRef = i.intakeOffsets.length > 0 ? offsetInForce(i.intakeOffsets, day - CORRECTION_STEP_PERIOD_DAYS) : i.previousBias.mean;
  const lastDecisionDay = i.anchors.reduce((m, a) => (a.day < day && a.day > m ? a.day : m), -1);
  const appliedByDay = new Map<number, number>();
  for (const a of r0.offsetsApplied) appliedByDay.set(a.day, a.appliedKcal);
  const offsetsApplied = r0.offsetsApplied.filter((a) => a.day >= s0 && a.day < day);
  const winPts = filt.points.filter((p) => p.observed && p.day > winLo && p.day <= day && p.y !== undefined && Number.isFinite(r0.tissuePathKg[p.day]!) && Number.isFinite(r0.scalePathKg[p.day]!));
  let cum = 0;
  let cumDay = s0;
  const biasPts: BiasWindowPoint[] = winPts.map((p) => {
    for (; cumDay < p.day; cumDay++) cum += appliedByDay.get(cumDay) ?? 0;
    return { day: p.day, y: p.y!, engineKg: r0.tissuePathKg[p.day]!, ...(p.rKg2 !== undefined ? { varKg2: p.rKg2 } : {}), appliedCumKcal: cum };
  });
  const dLo = Math.max(r0.startDay, winLo, 0);
  const dHi = Math.max(dLo, day - 1);
  let aF = 0;
  let aL = 0;
  for (const a of r0.anchorsApplied) if (a.day > dLo && a.day <= dHi) {
    aF += a.dFatKg;
    aL += a.dLeanKg;
  }
  const rho = mixDensityInfo(r0.fatKg[dHi]! - r0.fatKg[dLo]! - aF, r0.leanKg[dHi]! - r0.leanKg[dLo]! - aL, snapshotFatKg(snap0));
  const sigmaKg = prm.sigmaRelUnstd * trend.w;
  const evidence = i.intakeEvidence ? mergeIntakeEvidence(i.intakeEvidence) : null;
  const intakeSet = evidence ? new Set([...evidence].filter(([, v]) => v.eligible).map(([d]) => d)) : new Set(i.intakeDays);
  let wk1 = 0;
  let wk2 = 0;
  for (const d of intakeSet) {
    if (d < day && d >= day - 7) wk1++;
    else if (d < day - 7 && d >= day - 14) wk2++;
  }
  const intakeEvidence = evidence ? summariseIntakeEvidence(evidence, s0, day, { w1: wk1, w2: wk2 }) : null;
  const newEvidence = lastDecisionDay < 0 || obs.some((o) => o.day > lastDecisionDay);
  const eligible = !i.recompute && biasPts.length >= prm.biasMinWeighIns && wk1 >= prm.biasMinIntakeDays && wk2 >= prm.biasMinIntakeDays && newEvidence;
  const fit = eligible
    ? replayResidualMeasurement(i, schedule, r0, s0, day, winPts.map((p) => ({ day: p.day, scaleKg: p.y! + r0.waterWakeKg[p.day]!, varKg2: p.rKg2 ?? sigmaKg * sigmaKg })), prm)
    : null;
  const linear = linearBalanceMeasurement(biasPts, rho.rhoKcalPerKg, sigmaKg, inForce);
  const windowApplied = Array.from({ length: Math.max(0, day - s0) }, (_, k) => appliedByDay.get(s0 + k) ?? 0);
  const constantApplication = windowApplied.every((a) => Math.abs(a - (windowApplied[0] ?? 0)) < 1e-9);
  const bias: EnergyBiasEstimate = i.recompute
    ? keep
    : !newEvidence && biasPts.length >= prm.biasMinWeighIns
    ? { mean: i.previousBias.mean, sd: i.previousBias.sd, updated: false, reason: 'noNewEvidence', strategy: estimator.strategy, uncertaintyKind: 'conditionalResidual', coverage: 'unvalidated' }
    : estimateEnergyBias({
      points: biasPts,
      rhoKcalPerKg: rho.rhoKcalPerKg,
      sigmaKg,
      deltaApplied: inForce,
      previous: i.previousBias,
      stepReferenceKcal: stepRef,
      ...(fit ? { measurement: fit.measurement } : {}),
      intakeDaysWeek1: wk1,
      intakeDaysWeek2: wk2,
      params: prm,
    });

  // 4. anchor: midnight tissue + (filtered morning trend − engine morning tissue); split by partition or readings
  const tissueMidnight = snapshotTissueKg(snap0);
  const engineMorning = r0.tissueWakeKg[day]!;
  const target = tissueMidnight + (trend.w - (Number.isFinite(engineMorning) ? engineMorning : tissueMidnight));
  let composition: CompositionUpdate | null = null;
  if (i.composition) {
    const fm0 = snapshotFatKg(snap0);
    const engineSplit = reanchorSnapshot(snap0, { tissueMassKg: target }).applied;
    const resid = target - tissueMidnight;
    const byDay = new Map(filt.points.map((p) => [p.day, p] as const));
    composition = compositionTarget({
      day,
      targetTissueKg: target,
      engineFatKg: fm0 + engineSplit.dFatKg,
      fatShareOfResidual: Math.abs(resid) > 1e-6 ? engineSplit.dFatKg / resid : fm0 / tissueMidnight,
      readings: i.composition,
      replay: r0,
      trendAt: (d) => {
        const p = byDay.get(d);
        return p ? { tissueKg: p.w, sdKg: p.wSd } : null;
      },
      consumed: new Set(i.consumedObservationIds ?? []),
      lastDecisionDay,
      ...(i.compositionHistory ? { history: i.compositionHistory } : {}),
      params: prm,
    });
  }
  const comp = composition && composition.status === 'updated' && composition.fatFrac !== undefined ? composition : null;
  const anchor: AnchorSpec = { day, tissueMassKg: target, ...(comp ? { split: { fatFrac: comp.fatFrac! } } : {}) };
  const anchors = [...i.anchors.filter((a) => a.day !== day), anchor].sort((a, b) => a.day - b.day);
  const intakeOffset: IntakeOffset | null = bias.updated && bias.mean !== inForce
    ? { fromDay: day, kcal: bias.mean, mechanism: CORRECTION_MECHANISM, ...(bias.requestedKcal !== undefined ? { requestedKcal: bias.requestedKcal } : {}), ...(i.decisionId ? { decisionId: i.decisionId } : {}) }
    : null;
  const offsets = intakeOffset ? [...i.intakeOffsets.filter((o) => o.fromDay !== day), intakeOffset] : [...i.intakeOffsets];
  const correction: CorrectionEntry | null = bias.updated
    ? { requestedKcal: bias.requestedKcal ?? bias.mean, appliedKcal: bias.mean, saturated: bias.saturated === true, stepLimited: bias.stepLimited === true, mechanism: CORRECTION_MECHANISM }
    : null;

  // 5. confirmed replay: from the cached state of the anchor day (identical past), anchor applied at its start (a
  // recomputation applies the anchor to the captured state instead: same state, no confirmed replay)
  const windowIds = i.weighIns.filter((o) => o.day > winLo && o.day <= day).map(idKey).filter((x): x is string => x !== undefined);
  const consumedObservationIds = [...new Set([...windowIds, ...(composition?.consumedObservationIds ?? [])])].sort();
  if (i.recompute) {
    const re = reanchorSnapshot(snap0, { tissueMassKg: target, ...(anchor.split ? { split: anchor.split } : {}) });
    return {
      verdict: 'confirmed', day, in7, in14, trend, points: filt.points, dowOffsets: dow, bias, biasDiagnostics: null, anchor,
      residualSplit: { residualKg: re.applied.tissueAfterKg - re.applied.tissueBeforeKg, fatKg: re.applied.dFatKg, leanKg: re.applied.dLeanKg, source: comp?.source ?? 'engine' },
      composition, intakeOffset: null, correction: null, offsetsApplied, intakeEvidence, estimator, consumedObservationIds, snapshot: re.snapshot, replay: null,
    };
  }
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
    biasDiagnostics: { linear, rhoKcalPerKg: rho.rhoKcalPerKg, rhoSource: rho.source, constantApplication, replayRuns: fit?.runs ?? 0 },
    anchor,
    residualSplit: applied
      ? { residualKg: applied.tissueAfterKg - applied.tissueBeforeKg, fatKg: applied.dFatKg, leanKg: applied.dLeanKg, source: comp?.source ?? 'engine' }
      : null,
    composition,
    intakeOffset,
    correction,
    offsetsApplied,
    intakeEvidence,
    estimator,
    consumedObservationIds,
    snapshot,
    replay: r1,
  };
}
