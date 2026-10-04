// @vitest-environment node
/**
 * Ruling R-T4CAP and HC-F2 alignment with the engine's safety module. The planner's spacing check (repair) and the
 * independent validator follow the engine's `spacingViolation` (eating gap 24 h / 7 d for T3 / 28 d for T4, counts by
 * resume time) and apply the 108 h / 7 d cumulative cap to tiers T0-T3 only: a single expert-tier fast (72-168 h) is
 * governed by its own tier rule (alone in its 28-day window, mandatory refeed days).
 */
import { describe, expect, it } from 'vitest';
import { spacingViolation } from '../../../model/safety/derived';
import { defaultSafetyConstants } from '../../../model/safety/params';
import { Rng } from '../../optim/rng';
import { firstSpacingViolation, type ZeroSpan } from '../repair';
import { eatingGapNeedH } from '../fastMath';

const span = (start: number, hours: number): ZeroSpan => ({ start, end: start + hours, hours });

/** Engine verdict for a chronological list of fasts (> T0): any fast violating HC-F2 spacing / counts. */
function engineViolates(spans: readonly ZeroSpan[]): boolean {
  const k = defaultSafetyConstants();
  const log = new Float64Array(3 * spans.length);
  for (let i = 0; i < spans.length; i++) {
    const z = spans[i]!;
    if (spacingViolation(k, log, i, z.start, z.end, z.hours) !== 0) return true;
    log.set([z.start, z.end, z.hours], 3 * i);
  }
  return false;
}

/** Calendar-day ledger of T0-T3 fasted hours; true when some 7-day window exceeds 108 h. */
function over108(spans: readonly ZeroSpan[]): boolean {
  const day = new Map<number, number>();
  for (const z of spans) {
    if (z.hours > 72 + 1e-6) continue;
    for (let d = Math.floor(z.start / 24); d <= Math.floor((z.end - 1e-9) / 24); d++) day.set(d, (day.get(d) ?? 0) + Math.min(z.end, d * 24 + 24) - Math.max(z.start, d * 24));
  }
  const days = [...day.keys()];
  for (const e of days) for (let end = e; end <= e + 6; end++) {
    let h = 0;
    for (let d = end - 6; d <= end; d++) h += day.get(d) ?? 0;
    if (h > 108 + 1e-6) return true;
  }
  return false;
}

describe('fast spacing (R-T4CAP, HC-F2)', () => {
  it('a single 120-h expert-tier fast is not held to the 108 h / 7 d cap', () => {
    expect(firstSpacingViolation([span(20, 120)])).toBeNull();
    expect(firstSpacingViolation([span(20, 168)])).toBeNull();
  });

  it('an expert-tier fast is alone in its 28-day window (28 d of eating on both sides)', () => {
    expect(firstSpacingViolation([span(20, 120), span(20 + 120 + 20 * 24, 24)])?.rule).toBe('HC-F2');
    expect(firstSpacingViolation([span(20, 24), span(20 + 24 + 27 * 24, 120)])?.rule).toBe('HC-F2');
    expect(firstSpacingViolation([span(20, 120), span(20 + 120 + 28 * 24, 24)])).toBeNull();
    expect(eatingGapNeedH(120, 24)).toBe(28 * 24);
    expect(eatingGapNeedH(72, 24)).toBe(7 * 24);
    expect(eatingGapNeedH(40, 24)).toBe(24);
  });

  it('a 72-h fast needs 7 days of eating before the next fast (not 7 days start to start)', () => {
    expect(firstSpacingViolation([span(20, 72), span(20 + 72 + 4 * 24, 24)])?.rule).toBe('HC-F2');
    expect(firstSpacingViolation([span(20, 72), span(20 + 72 + 7 * 24, 24)])).toBeNull();
  });

  it('T0-T3 fasts keep the 108 h / 7 d cumulative cap', () => {
    // 40 h + 40 h + 40 h with 24 h of eating between: 120 fasted hours inside 7 calendar days
    expect(firstSpacingViolation([span(20, 40), span(84, 40), span(148, 40)])).not.toBeNull();
  });

  it('agrees with the engine on random fast sequences (spacing and counts)', () => {
    const rng = new Rng('fast-spacing');
    const lengths = [22, 26, 30, 36, 40, 47, 60, 72, 100, 150];
    let compared = 0;
    let violations = 0;
    for (let n = 0; n < 4000; n++) {
      const spans: ZeroSpan[] = [];
      let t = 20;
      let long = 0;
      const k = 2 + rng.int(4);
      for (let i = 0; i < k; i++) {
        const h = lengths[rng.int(lengths.length)]!;
        if (h >= 48) long++;
        spans.push(span(t, h));
        t += h + 24 * (1 + rng.int(35)) + (rng.float() < 0.5 ? 0 : rng.int(24));
      }
      if (long > 1 || over108(spans)) continue; // planner-only 13 B14/B15 spacing and the weekly ledger are tested above
      compared++;
      const engine = engineViolates(spans);
      if (engine) violations++;
      expect(firstSpacingViolation(spans) !== null, JSON.stringify(spans)).toBe(engine);
    }
    expect(compared).toBeGreaterThan(1000);
    expect(violations).toBeGreaterThan(100);
  });
});
