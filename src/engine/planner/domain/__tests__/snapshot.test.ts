// @vitest-environment node
/**
 * Burn-in reuse (MODEL_SPEC §10.1 `RunOptions.initialSnapshot`): a planner evaluation restored from the post-burn-in
 * snapshot is bit-identical to one that runs the 14-day burn-in (planner module list with the intake adapter), for the
 * nominal parameters and an ensemble draw.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../optim/rng';
import { compileRequest } from '../context';
import { EnginePlanModel } from '../model';
import { enumerateStructures } from '../skeleton';
import { FAT_LOSS_KEEP_LEAN, MAN_95, request } from './personas';

describe('initial snapshot reuse', () => {
  it('restored evaluations equal full burn-in evaluations bit for bit', () => {
    const ctx = compileRequest(request(MAN_95, FAT_LOSS_KEEP_LEAN, { horizonDays: 42 }));
    const bindings = ctx.goals.map((g) => ({ metric: g.metric, functional: g.functional, useTissueMass: g.useTissueMass }));
    const fast = new EnginePlanModel(ctx, { bindings, ensemble: { seed: 3, size: 2 }, snapshots: true });
    const slow = new EnginePlanModel(ctx, { bindings, ensemble: { seed: 3, size: 2 }, snapshots: false });
    const sts = enumerateStructures(ctx);
    const rng = new Rng(9);
    for (const draw of [-1, 1]) {
      for (const st of [sts[0]!, sts[1]!, sts[5]!]) {
        const x = Float64Array.from({ length: st.dim }, () => rng.float());
        const sch = fast.repair(st, fast.decode(st, x)).schedule;
        const a = fast.simulate(sch, draw);
        const b = slow.simulate(sch, draw);
        expect(Array.from(fast.goals(a))).toEqual(Array.from(slow.goals(b)));
        expect(Array.from(fast.constraints(a, sch))).toEqual(Array.from(slow.constraints(b, sch)));
        for (const id of Object.keys(b.daily) as (keyof typeof b.daily)[]) expect(Array.from(a.daily[id]!)).toEqual(Array.from(b.daily[id]!));
      }
    }
  }, 120_000);
});
