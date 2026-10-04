/**
 * Explicit-Euler reference integrator for O-10 (MODEL_SPEC §9.1: "hourly closed forms vs 5-min Euler references",
 * 05 §4.17, 03 §4.7, 04 §4.10; tolerance 2 % of state / 0.05 mM). Module owners use it in their own unit tests to show
 * that an hourly closed-form update stays within tolerance of a fine Euler integration of the same ODE on the
 * dossier's test case. Independent of the engine: plain functions over Float64Array state vectors.
 */

/** dx/dt = f(t, x); write the derivative into `dx`. Time in hours. */
export type Ode = (tHours: number, x: Float64Array, dx: Float64Array) => void;

/** State at every whole hour 0..hours from explicit Euler with step `dtHours` (default 5 min). Row h = state at t = h. */
export function eulerHourly(f: Ode, x0: ArrayLike<number>, hours: number, dtHours = 5 / 60): Float64Array[] {
  const n = x0.length;
  const x = Float64Array.from(x0);
  const dx = new Float64Array(n);
  const out: Float64Array[] = [Float64Array.from(x)];
  const steps = Math.round(1 / dtHours);
  if (Math.abs(steps * dtHours - 1) > 1e-9) throw new Error('eulerHourly: dtHours must divide 1 h');
  for (let h = 0; h < hours; h++) {
    for (let s = 0; s < steps; s++) {
      f(h + s * dtHours, x, dx);
      for (let i = 0; i < n; i++) x[i] = x[i]! + dtHours * dx[i]!;
    }
    out.push(Float64Array.from(x));
  }
  return out;
}

export interface EulerComparison {
  /** Largest |hourly − euler| / max(|euler|, floor) over hours and states. */
  maxRel: number;
  /** Largest absolute difference. */
  maxAbs: number;
  /** Hour and state index of the largest relative error. */
  worst: { hour: number; state: number };
}

/**
 * Compare an hourly update against the Euler reference. `hourlyStep(x, hour)` advances `x` by one hour in place (the module's
 * closed form on hand-built inputs). `floor` avoids dividing by ~0 for states near zero (default 1e-9).
 */
export function compareHourlyToEuler(f: Ode, hourlyStep: (x: Float64Array, hour: number) => void, x0: ArrayLike<number>, hours: number, opts: { dtHours?: number; floor?: number } = {}): EulerComparison {
  const ref = eulerHourly(f, x0, hours, opts.dtHours);
  const floor = opts.floor ?? 1e-9;
  const x = Float64Array.from(x0);
  let maxRel = 0;
  let maxAbs = 0;
  const worst = { hour: 0, state: 0 };
  for (let h = 1; h <= hours; h++) {
    hourlyStep(x, h - 1);
    const r = ref[h]!;
    for (let i = 0; i < x.length; i++) {
      const abs = Math.abs(x[i]! - r[i]!);
      const rel = abs / Math.max(Math.abs(r[i]!), floor);
      if (abs > maxAbs) maxAbs = abs;
      if (rel > maxRel) {
        maxRel = rel;
        worst.hour = h;
        worst.state = i;
      }
    }
  }
  return { maxRel, maxAbs, worst };
}
