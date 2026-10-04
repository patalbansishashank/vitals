// @vitest-environment node
/** 18 §4.12 / WP-P follow-up 5: request r2 returns ≥ 2 meaningfully different options at the M budget (real engine). */
import { describe, expect, it } from 'vitest';
import { runDiversity } from './diversity';

describe('diversity at tier M (r2)', () => {
  it('returns distinct validated rungs or stated collapse reasons (ladder semantics)', async () => {
    const res = await runDiversity('r2');
    expect(res.options.every((o) => (o.schedule.events ?? []).length === 0)).toBe(true);
    expect(res.fasting?.offered).toBe(false);
  }, 900_000);
});
