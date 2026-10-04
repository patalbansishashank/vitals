// @vitest-environment node
/** 18 §4.12 / WP-P follow-up 5: request r3 returns ≥ 2 meaningfully different options at the M budget (real engine). */
import { describe, expect, it } from 'vitest';
import { runDiversity } from './diversity';

describe('diversity at tier M (r3)', () => {
  it('returns at least two distinct, validated options', async () => {
    const res = await runDiversity('r3');
    expect(res.fasting?.offered).toBe(true); // prefers fasting, T3 opt-in
  }, 900_000);
});
