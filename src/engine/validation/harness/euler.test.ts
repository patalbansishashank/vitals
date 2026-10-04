// @vitest-environment node
/** Self-test of the O-10 Euler reference helper (runs for real). */
import { compareHourlyToEuler, eulerHourly, type Ode } from './euler';

describe('Euler reference for O-10', () => {
  const tau = 2; // h
  const target = 3;
  const relax: Ode = (_t, x, dx) => {
    dx[0] = (target - x[0]!) / tau;
  };
  const f = Math.exp(-1 / tau);

  it('5-min Euler tracks the exact exponential closely (sanity of the reference itself)', () => {
    const ref = eulerHourly(relax, [0], 12);
    for (let h = 0; h <= 12; h++) expect(Math.abs(ref[h]![0]! - target * (1 - Math.exp(-h / tau))) / target).toBeLessThan(0.01);
  });

  it('the hourly closed form x ← x* + (x − x*)·exp(−Δt/τ) is within 2 % of the 5-min Euler reference', () => {
    const r = compareHourlyToEuler(relax, (x) => (x[0] = target + (x[0]! - target) * f), [0], 24, { floor: 0.05 });
    expect(r.maxRel).toBeLessThan(0.02);
  });

  it('flags a wrong update rule (forward hourly Euler with a large step)', () => {
    const r = compareHourlyToEuler(relax, (x) => (x[0] = x[0]! + (target - x[0]!) / (0.5 * tau)), [0], 24, { floor: 0.05 });
    expect(r.maxRel).toBeGreaterThan(0.02);
  });

  it('rejects a step that does not divide one hour', () => {
    expect(() => eulerHourly(relax, [0], 2, 0.3)).toThrow();
  });
});
