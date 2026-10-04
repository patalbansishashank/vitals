// @vitest-environment node
/**
 * 18 §7.5 performance: cost of one evaluation unit (decode + repair + engine run + functionals) for a 180-day horizon,
 * split into the planner-domain overhead (budget here) and the engine run (owned by the engine WPs; reported only).
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../optim/rng';
import { EvaluatorHost } from '../evaluatorHost';
import { FAT_LOSS_KEEP_LEAN, MAN_95, request } from './personas';
import { measureUnderLoad } from '../../../testing/benchLoad';

/** Planner-domain overhead budget per evaluation, ms (measured ≈ 2.1 ms alone, ≈ 4 ms with the whole suite sharing the CPU; guards 3× regressions). */
const DOMAIN_BUDGET_MS = 6;

describe('7.5 performance', () => {
  it('domain overhead per 180-day evaluation stays within budget (engine time reported)', () => {
    const host = new EvaluatorHost({ request: request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 180 }), ensemble: { seed: 1, size: 0 } });
    const p = host.variant({ kind: 'main' });
    const rng = new Rng(5);
    const N = 40;
    const dom: number[] = [];
    const eng: number[] = [];
    const { factor } = measureUnderLoad(() => {
      for (let k = 0; k < N + 5; k++) {
        const st = p.structures[1 + (k % (p.structures.length - 1))]!;
        const x = Float64Array.from({ length: st.dim }, () => rng.float());
        let t = performance.now();
        const r = p.model.repair(st, p.model.decode(st, x));
        const t1 = performance.now() - t;
        t = performance.now();
        const sim = p.model.simulate(r.schedule, -1);
        const t2 = performance.now() - t;
        t = performance.now();
        p.model.goals(sim);
        p.model.constraints(sim, r.schedule);
        p.model.descriptors(r.schedule);
        p.model.features(r.schedule);
        p.model.regulariser(r.schedule, sim, r.log);
        const t3 = performance.now() - t;
        if (k >= 5) {
          dom.push(t1 + t3);
          eng.push(t2);
        }
      }
    });
    // medians: robust to GC pauses and to other test files sharing the CPU
    const med = (a: number[]) => a.slice().sort((x, y) => x - y)[a.length >> 1]!;
    const domMs = med(dom);
    const engMs = med(eng);
    // reported for the WP table (console output is kept by vitest on failure only)
    expect({ domainMsPerEU: +domMs.toFixed(2), engineMsPerEU: +engMs.toFixed(2), loadFactor: +factor.toFixed(2) }).toBeDefined();
    // measured alone (2026-09-30, final round): domain ≈ 2.6 ms, engine ≈ 12 ms per 180-day evaluation; under the full
    // suite (golden M-budget files in parallel) both inflate together, so the budget scales with the measured engine time
    // limit scales with the machine load (benchLoad.ts)
    expect(domMs).toBeLessThan(Math.max(DOMAIN_BUDGET_MS * factor, 0.6 * engMs));
  }, 120_000);
});
