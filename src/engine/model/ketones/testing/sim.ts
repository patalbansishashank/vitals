/**
 * TEST-ONLY: runs a scenario through the 05 reference (5-min Euler, used here as the upstream trajectory generator)
 * and drives the hourly ketones module with the hour aggregates. G50 follows ruling R-KET: g50Frac × the capacity of
 * the liver model that drives the run (05 fallback: 100·FFM/60 g), i.e. 05's calibrated 55·FFM/60 g.
 */
import { runReference05, type RefRun, type RefScenario } from './reference05';
import { hourlyFromReference, runModule, type HourlyInputs, type ModuleRun, type RunOptionsK } from './harness';

export interface Sim {
  sc: RefScenario;
  ref: RefRun;
  inp: HourlyInputs;
  m: ModuleRun;
  /** Module BHB point value at absolute time t (end of the hour ending at t), mmol/L. */
  pt: (t: number) => number;
  /** Module TKB point value at absolute time t, mmol/L. */
  ptTkb: (t: number) => number;
  /** Module hour-mean BHB of the hour starting at t, mmol/L. */
  mean: (t: number) => number;
  /** Reference BHB point value at absolute time t. */
  refPt: (t: number) => number;
  /** Hours from `from` until the point BHB first reaches `thr` (linear interpolation between hour ends). */
  tCross: (from: number, thr: number) => number;
  /** ∫ BHB dt over [from, from + hours) from hour means, mmol·h/L. */
  auc: (from: number, hours: number) => number;
}

export function simulateScenario(sc: RefScenario, opts?: Partial<RunOptionsK>, dtH?: number): Sim {
  const ref = runReference05(sc, dtH);
  const inp = hourlyFromReference(ref, sc);
  const m = runModule(inp, {
    habitualProteinG: sc.habitualProteinG,
    habitualCarbG: sc.habitualCarbG,
    liverCapG: ref.Gmax,
    ...opts,
  });
  const row = (t: number): number => Math.round(t) - inp.h0 - 1;
  const pt = (t: number): number => m.bhbEnd[row(t)]!;
  return {
    sc, ref, inp, m, pt,
    ptTkb: (t) => m.tkbEnd[row(t)]!,
    mean: (t) => m.bhb[Math.round(t) - inp.h0]!,
    refPt: (t) => ref.samples[Math.round((t - sc.tStart) / ref.dtH) - 1]!.BHB,
    tCross: (from, thr) => {
      for (let t = from + 1; t < sc.tEnd; t++) {
        const a = pt(t - 1);
        const b = pt(t);
        if (a < thr && b >= thr) return t - 1 + (thr - a) / (b - a) - from;
      }
      return Number.NaN;
    },
    auc: (from, hours) => {
      let s = 0;
      for (let t = from; t < from + hours; t++) s += m.bhb[t - inp.h0]!;
      return s;
    },
  };
}
