// @vitest-environment node
/**
 * QA item 8 (anytime results): the wall-clock throttle drops only pure progress ticks. The single event that carries
 * the alternatives A/B/C (end of S4, same stage as the S4 ticks just before it) is always delivered, and later ticks
 * that only know option A keep carrying B and C.
 */
import { describe, expect, it } from 'vitest';
import type { OptionSummary, PlannerProgress } from '../../optim/pipeline';
import { createProgressGate } from '../progress';

const opt = (structure: number, v: number): OptionSummary => ({
  structure,
  structureId: `s${structure}`,
  x: Float64Array.of(v, 1 - v),
  desirability: Float64Array.of(0.5),
  percentOfPossible: Float64Array.of(0.5),
  utility: v,
});

const tick = (stage: string, eu: number, provisional: OptionSummary | null, alternatives?: OptionSummary[]): PlannerProgress => ({
  stage,
  euUsed: eu,
  euBudget: 1000,
  archiveSize: 10,
  provisional,
  ...(alternatives ? { alternatives } : {}),
});

describe('progress gate (anytime options)', () => {
  it('always delivers the event that carries new options, even inside the throttle interval of the same stage', () => {
    const gate = createProgressGate(() => 0, 250); // frozen clock: every same-stage tick falls inside the interval
    const A = opt(3, 0.4);
    const B = opt(5, 0.3);
    const C = opt(7, 0.2);
    expect(gate(tick('S4', 600, A))).not.toBeNull(); // new stage and new option set
    expect(gate(tick('S4', 620, A))).toBeNull(); // pure tick: throttled
    expect(gate(tick('S4', 640, A))).toBeNull();
    const alts = gate(tick('S4', 650, A, [A, B, C])); // the single A/B/C event
    expect(alts).not.toBeNull();
    expect(alts!.changed).toBe(true);
    expect(alts!.list.map((o) => o.structure)).toEqual([3, 5, 7]);
    // S5 ticks only know A: they still carry B and C (sticky alternatives)
    const s5 = gate(tick('S5', 700, A));
    expect(s5).not.toBeNull();
    expect(s5!.changed).toBe(false);
    expect(s5!.list.length).toBe(3);
    expect(gate(tick('S5', 710, A))).toBeNull();
    // a changed genome of A is a changed option set: delivered
    const s5b = gate(tick('S5', 720, opt(3, 0.41), [opt(3, 0.41), B, C]));
    expect(s5b?.changed).toBe(true);
  });

  it('delivers every event without a clock (Node / tests)', () => {
    const gate = createProgressGate(undefined);
    const A = opt(1, 0.5);
    for (let i = 0; i < 5; i++) expect(gate(tick('S3.1', i, A))).not.toBeNull();
  });
});
