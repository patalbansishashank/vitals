// Regional fat/muscle allocation when total fat mass or skeletal muscle changes during a simulation (dossier 14 sec. M7).
//
//   for each fat change dFM:  K = dFM < 0 ? K_LOSS : K_GAIN
//   w_i = F_i*K_i*(1 + lambda*trainedShare_i);  dF_i = dFM*w_i/sum_j(w_j);  F_i = max(F_i + dF_i, 0)
//
// The rule is applied in internal sub-steps of at most `maxStepKg`, so the result does not depend on whether the
// caller steps hourly, daily or weekly (the dossier integrates it per simulated day with the current depot values).

import type {
  FatDepot,
  MuscleRegion,
  RegionalAllocationOptions,
  RegionalComposition,
  RegionalFat,
  RegionalMuscle,
  RegionalTarget,
} from './types';
import { clamp } from './math';

export const FAT_DEPOTS: readonly FatDepot[] = ['headKg', 'armsKg', 'legsKg', 'trunkSatKg', 'vatKg'];
export const MUSCLE_REGIONS: readonly MuscleRegion[] = ['armsKg', 'legsKg', 'trunkKg'];

/**
 * Loss susceptibilities (dossier 14 M7; PROPOSED FIT): VAT 1.3 = Hallgreen & Hall 2008 allometry dVAT/VAT = 1.3*dFM/FM
 * (k = 1.3 +- 0.1, R2 .73, 37 studies / 1,407 people) [48]; trunk vs limb ~1.3 from CALERIE-2 (Das 2017 [49]);
 * limbs 0.84 solved so that sum(F_i*K_i) = FM at the reference partition.
 */
export const K_LOSS: Readonly<Record<FatDepot, number>> = {
  headKg: 1.0, // PROPOSED
  armsKg: 0.84, // PROPOSED FIT
  legsKg: 0.84, // PROPOSED FIT
  trunkSatKg: 1.1, // PROPOSED FIT
  vatKg: 1.3, // Hallgreen & Hall 2008 [48]
};

/**
 * Gain susceptibilities (dossier 14 M7; PROPOSED FIT to Tchoukalova 2010: 8-wk overfeeding, upper +1.9 kg vs lower
 * +1.6 kg, n = 28 [52]); VAT 1.3 for gain assumed symmetric (UNVERIFIED): a labelled hypothesis (`VAT_ALLOMETRY`), not
 * verified loss evidence.
 */
export const K_GAIN: Readonly<Record<FatDepot, number>> = {
  headKg: 1.0, // PROPOSED
  armsKg: 1.0, // PROPOSED FIT
  legsKg: 1.15, // PROPOSED FIT
  trunkSatKg: 0.95, // PROPOSED FIT
  vatKg: 1.3, // UNVERIFIED (assumed symmetric with loss)
};

/**
 * VAT allometry (D1-02): dVAT/dFM = k·VAT/FM, integrated exactly as VAT_next = clamp(VAT·(FM_next/FM)^k, 0, FM_next).
 * k is dimensionless, masses kg. Loss k = 1.3 is an empirical population prior (Hallgreen & Hall 2008: 37 pooled loss
 * studies, 1 407 people; not individual daily MRI accuracy). Gain reuses 1.3 only as a separately versioned symmetric
 * continuity hypothesis (no gain evidence). Waist stays the practical manual observation; VAT is inferred.
 */
export const VAT_ALLOMETRY = {
  version: 1,
  kLoss: K_LOSS.vatKg,
  kGain: K_GAIN.vatKg,
  lossWarrant: 'empiricalPopulationPrior',
  gainWarrant: 'assumedSymmetricHypothesis',
  source: 'Hallgreen & Hall 2008 doi 10.1038/sj.ijo.0803783 (loss only)',
} as const;

/**
 * One VAT transition (D1-02), the same for every output mask: VAT·(FM_next/FM_prev)^k with k = kLoss on loss, kGain on
 * gain, bounded to [0, FM_next]. FM_prev ≤ 0 or FM_next ≤ 0 is the model limit: VAT = 0 (never a division by zero).
 * Step-split invariant while the change keeps one sign (the power law telescopes). Allocation-free.
 */
export function vatTransition(vatKg: number, fmPrevKg: number, fmNextKg: number, kLoss: number = VAT_ALLOMETRY.kLoss, kGain: number = VAT_ALLOMETRY.kGain): number {
  if (!(fmPrevKg > 0) || !(fmNextKg > 0) || !(vatKg > 0)) return 0;
  const k = fmNextKg < fmPrevKg ? kLoss : kGain;
  const v = fmNextKg === fmPrevKg ? vatKg : vatKg * Math.pow(fmNextKg / fmPrevKg, k);
  return v > fmNextKg ? fmNextKg : v;
}

/** Spot-reduction bias: default 0, capped at 0.10 (dossier 14 M7; grade C-D, "no meaningful spot reduction" grade B). */
export const LAMBDA_MAX = 0.1;
export const DEFAULT_MAX_STEP_KG = 0.05;

function totalFat(f: RegionalFat): number {
  return f.headKg + f.armsKg + f.legsKg + f.trunkSatKg + f.vatKg;
}

function totalMuscle(m: RegionalMuscle): number {
  return m.armsKg + m.legsKg + m.trunkKg;
}

/** One sub-step of the M7 rule over the given depots. */
function fatStep(f: RegionalFat, depots: readonly FatDepot[], dFM: number, bias: Readonly<Record<FatDepot, number>>): void {
  const K = dFM < 0 ? K_LOSS : K_GAIN;
  let wSum = 0;
  for (const d of depots) wSum += f[d] * K[d] * bias[d];
  if (wSum <= 0) {
    // all listed depots empty (only possible on gain from zero): fall back to the susceptibilities alone
    let kSum = 0;
    for (const d of depots) kSum += K[d] * bias[d];
    for (const d of depots) f[d] = Math.max(f[d] + (dFM * K[d] * bias[d]) / kSum, 0);
    return;
  }
  for (const d of depots) f[d] = Math.max(f[d] + (dFM * f[d] * K[d] * bias[d]) / wSum, 0);
}

/** Move the fat depots to `targetKg` total with the M7 rule (sub-stepped), then remove any rounding residue proportionally. */
function allocateFat(
  prev: RegionalFat,
  depots: readonly FatDepot[],
  targetKg: number,
  bias: Readonly<Record<FatDepot, number>>,
  maxStepKg: number,
): RegionalFat {
  const f: RegionalFat = { ...prev };
  const sumDepots = () => depots.reduce((s, d) => s + f[d], 0);
  const target = Math.max(targetKg, 0);
  const dTotal = target - sumDepots();
  const steps = Math.max(1, Math.ceil(Math.abs(dTotal) / maxStepKg));
  for (let k = 0; k < steps; k++) {
    // re-aim each sub-step at the target so that clamping at 0 cannot leave a residue
    const remaining = target - sumDepots();
    fatStep(f, depots, remaining / (steps - k), bias);
  }
  const s = sumDepots();
  if (s > 0) for (const d of depots) f[d] *= target / s;
  return f;
}

/**
 * Update regional fat and muscle after the simulation has changed total fat mass (and optionally VAT) and total
 * skeletal muscle. Pure: returns new objects; `prev` is not mutated. Mass is conserved exactly:
 * sum(fat) = target.fatMassKg and sum(muscle) = target.skeletalMuscleKg.
 *
 * Muscle: the dossier gives no regional loss/gain exponents, so a change is shared in proportion to current regional
 * mass times optional `muscleWeights` (e.g. trained regions from dossier 09) - PROPOSED.
 */
export function allocateRegional(
  prev: RegionalComposition,
  target: RegionalTarget,
  options: RegionalAllocationOptions = {},
): RegionalComposition {
  const lambda = clamp(options.lambda ?? 0, 0, LAMBDA_MAX);
  const maxStep = options.maxStepKg !== undefined && options.maxStepKg > 0 ? options.maxStepKg : DEFAULT_MAX_STEP_KG;
  const bias = {} as Record<FatDepot, number>;
  for (const d of FAT_DEPOTS) bias[d] = 1 + lambda * clamp(options.trainedShare?.[d] ?? 0, 0, 1);

  const fatTarget = Math.max(target.fatMassKg, 0);
  let fat: RegionalFat;
  if (target.vatKg !== undefined) {
    const vat = clamp(target.vatKg, 0, fatTarget);
    const others = FAT_DEPOTS.filter((d) => d !== 'vatKg');
    fat = allocateFat({ ...prev.fat, vatKg: vat }, others, fatTarget - vat, bias, maxStep);
    fat.vatKg = vat;
  } else {
    fat = allocateFat(prev.fat, FAT_DEPOTS, fatTarget, bias, maxStep);
  }

  const muscle = allocateMuscle(prev.muscle, Math.max(target.skeletalMuscleKg, 0), options.muscleWeights);
  return { fat, muscle };
}

function allocateMuscle(prev: RegionalMuscle, targetKg: number, weights?: Partial<Record<MuscleRegion, number>>): RegionalMuscle {
  const m: RegionalMuscle = { ...prev };
  const d = targetKg - totalMuscle(prev);
  const w = (r: MuscleRegion) => Math.max(weights?.[r] ?? 1, 0);
  let wSum = 0;
  for (const r of MUSCLE_REGIONS) wSum += prev[r] * w(r);
  if (wSum <= 0) {
    for (const r of MUSCLE_REGIONS) m[r] = targetKg / MUSCLE_REGIONS.length;
    return m;
  }
  for (const r of MUSCLE_REGIONS) m[r] = Math.max(prev[r] + (d * prev[r] * w(r)) / wSum, 0);
  const s = totalMuscle(m);
  if (s > 0) for (const r of MUSCLE_REGIONS) m[r] *= targetKg / s;
  return m;
}

/** Convenience: sums for tests and callers. */
export function regionalTotals(c: RegionalComposition): { fatKg: number; muscleKg: number } {
  return { fatKg: totalFat(c.fat), muscleKg: totalMuscle(c.muscle) };
}
