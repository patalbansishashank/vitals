/**
 * Body state per simulated day, for the figure over time (AVATAR_SPEC §6; src/engine/body/README.md "Carry the
 * state"). The result records fat mass, lean tissue and skeletal muscle per day but not the regional depots, so the
 * day's `BodyState` is rebuilt the way the composition module builds it (MODEL_SPEC §1.8 step 7):
 *
 *   FFM_d = FFM_0 + (LT_d − LT_0)       tissue fat-free mass (no glycogen/water swings)
 *   regional_d = allocateRegional(regional_{d−1}, { FM_d, SM_d })   (step-size independent, mass-conserving)
 *
 * starting from the t = 0 body estimate. Measured circumferences belong to the baseline only; every state is rendered
 * with `{ baseline }`. When a series is missing the reconstruction degrades: without fat mass only day 0 (and the
 * final state, if `final` has it) exist; without skeletal muscle, muscle scales with lean tissue.
 */
import { allocateRegional, stateToAvatarParams } from '@/engine/body';
import type { AvatarParams, BodyEstimate, BodyState, RegionalComposition } from '@/engine/body';
import type { SimulationResult } from '@/engine';

export interface BodyTimeline {
  days: number;
  /** State at the start of the horizon (the body estimate, without measured anchors). */
  start: BodyState;
  baseline: BodyEstimate;
  /** Series the reconstruction had to do without ('fatMass', 'leanTissue', 'skeletalMuscle'). */
  missing: string[];
  /** true when only the start and final states exist (fat mass not recorded per day). */
  endpointsOnly: boolean;
  stateAt(day: number): BodyState;
  paramsAt(day: number): AvatarParams;
}

function stateFrom(base: BodyEstimate, fm: number, ffm: number, sm: number, reg: RegionalComposition): BodyState {
  return {
    sex: base.sex,
    ageYears: base.ageYears,
    heightCm: base.heightCm,
    weightKg: fm + ffm,
    fatMassKg: fm,
    fatFreeMassKg: ffm,
    skeletalMuscleKg: sm,
    fat: reg.fat,
    muscle: reg.muscle,
    satShares: base.satShares,
    frameZ: base.frameZ,
  };
}

const finite = (v: number | undefined): v is number => v != null && Number.isFinite(v);

/** `frame`: the drawing-only frame (profile.figure.frame) passed to every day's `stateToAvatarParams`. */
export function bodyTimeline(result: SimulationResult, baseline: BodyEstimate, options: { frame?: number } = {}): BodyTimeline {
  const n = result.meta.nDays;
  const d = result.daily;
  const init = result.initial as Partial<Record<string, number>>;
  const fin = result.final as Partial<Record<string, number>>;
  const missing: string[] = [];
  const fmS = d.fatMass;
  const ltS = d.leanTissue;
  const smS = d.skeletalMuscle;
  if (!fmS) missing.push('fatMass');
  if (!ltS) missing.push('leanTissue');
  if (!smS) missing.push('skeletalMuscle');

  const fm0 = baseline.fatMassKg;
  const ffm0 = baseline.fatFreeMassKg;
  const sm0 = baseline.skeletalMuscleKg;
  const lt0 = finite(init.leanTissue) ? init.leanTissue : (ltS?.[0] ?? Number.NaN);
  const reg0: RegionalComposition = { fat: { ...baseline.fat }, muscle: { ...baseline.muscle } };
  const start = stateFrom(baseline, fm0, ffm0, sm0, reg0);

  const ffmAt = (lt: number | undefined) => (finite(lt) && finite(lt0) ? ffm0 + (lt - lt0) : ffm0);
  const smFor = (sm: number | undefined, ffm: number) => (finite(sm) ? sm : sm0 * (ffm / ffm0));

  const states: BodyState[] = new Array(n);
  let endpointsOnly = false;
  if (fmS && fmS.length === n) {
    let reg = reg0;
    let last = start;
    for (let i = 0; i < n; i++) {
      const fm = fmS[i]!;
      if (!finite(fm)) {
        states[i] = last; // a run that stopped early: hold the last valid state
        continue;
      }
      const ffm = ffmAt(ltS?.[i]);
      const sm = smFor(smS?.[i], ffm);
      reg = allocateRegional(reg, { fatMassKg: fm, skeletalMuscleKg: sm });
      last = stateFrom(baseline, fm, ffm, sm, reg);
      states[i] = last;
    }
  } else {
    endpointsOnly = true;
    const fmEnd = finite(fin.fatMass) ? fin.fatMass : fm0;
    const ffmEnd = ffmAt(fin.leanTissue);
    const smEnd = smFor(fin.skeletalMuscle, ffmEnd);
    const end = stateFrom(baseline, fmEnd, ffmEnd, smEnd, allocateRegional(reg0, { fatMassKg: fmEnd, skeletalMuscleKg: smEnd }));
    for (let i = 0; i < n; i++) states[i] = i === n - 1 ? end : start;
  }

  const cache = new Map<number, AvatarParams>();
  const clampDay = (day: number) => Math.max(0, Math.min(n - 1, Math.floor(day)));
  const stateAt = (day: number) => (n > 0 ? states[clampDay(day)]! : start);
  const paramsAt = (day: number): AvatarParams => {
    const k = day < 0 ? -1 : clampDay(day);
    const hit = cache.get(k);
    if (hit) return hit;
    const p = stateToAvatarParams(k < 0 ? start : stateAt(k), { baseline, ...(options.frame !== undefined ? { frame: options.frame } : {}) });
    if (cache.size > 400) cache.clear();
    cache.set(k, p);
    return p;
  };
  return { days: n, start, baseline, missing, endpointsOnly, stateAt, paramsAt };
}
