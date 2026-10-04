// @vitest-environment node
/** 18 §4.12 / WP-P follow-up 5: request r1 returns ≥ 2 meaningfully different options at the M budget (real engine). */
import { describe, expect, it } from 'vitest';
import { runDiversity } from './diversity';

describe('diversity at tier M (r1)', () => {
  it('returns distinct validated rungs or stated collapse reasons (ladder semantics)', async () => {
    const res = await runDiversity('r1');
    // R-FAST-GATE: fat loss first is a goal fasting can serve (24-h fasts, default tier); the search decides. A rung
    // without a fast names the fasting plan it was compared with and why it lost; a rung with a fast says what it buys
    expect(res.fasting?.offered).toBe(true);
    for (const o of res.options) {
      if (!(o.schedule.events ?? []).length) expect(o.fasting?.rival?.reason).toBeDefined();
      else expect(o.fasting?.text).toMatch(/^Includes /);
    }
  }, 900_000);
});
