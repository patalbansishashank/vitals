/** (0.6.5, owner: "make sure we are not double counting activities") every minute of the day is counted once. */
import { describe, expect, it } from 'vitest';
import type { ExerciseSession } from '@/engine';
import { withoutOverlaps } from '../loggedDay';

const h = (hh: number, mm: number) => hh + mm / 60;
const cardio = (id: string, startH: number, durationMin: number, extra: Partial<ExerciseSession> = {}) =>
  ({
    kind: 'cardio',
    modality: 'cycling',
    intensity: 'moderate',
    startH,
    durationMin,
    sessionId: id,
    ...extra,
  }) as unknown as ExerciseSession;
const resist = (id: string, startH: number, durationMin: number, extra: Partial<ExerciseSession> = {}) =>
  ({
    kind: 'resistance',
    volume: 'moderate',
    startH,
    durationMin,
    sessionId: id,
    ...extra,
  }) as unknown as ExerciseSession;
const minutes = (xs: readonly ExerciseSession[]) => xs.reduce((a, s) => a + (s.durationMin ?? 0), 0);

describe('withoutOverlaps', () => {
  it("the owner's day: strength 10:26–10:51 and cycling 10:50–11:05 count 39 minutes, not 40", () => {
    const out = withoutOverlaps([
      cardio('cyc', h(10, 50), 15, { realisedGrossKcal: 150, stepsIncluded: 0 } as never),
      resist('str', h(10, 26), 25),
    ]);
    expect(minutes(out)).toBeCloseTo(39, 6);
    const cyc = out.find((s) => s.sessionId?.startsWith('cyc'))!;
    expect(cyc.startH).toBeCloseTo(h(10, 51), 6);
    expect(cyc.durationMin).toBeCloseTo(14, 6);
    expect((cyc as { realisedGrossKcal?: number }).realisedGrossKcal).toBeCloseTo(140, 6);
    // the earlier one is untouched
    expect(out.find((s) => s.sessionId === 'str')!.durationMin).toBe(25);
  });

  it('a session inside an earlier one keeps nothing; a chain of overlaps counts each minute once', () => {
    expect(
      withoutOverlaps([cardio('a', 10, 60), cardio('b', h(10, 10), 20)]).map((s) => s.sessionId),
    ).toEqual(['a']);
    // 10:00–10:10, 10:05–10:50, 10:20–10:25 → the 10:00–10:50 they cover, once
    const out = withoutOverlaps([cardio('c', h(10, 20), 5), cardio('b', h(10, 5), 45), cardio('a', 10, 10)]);
    expect(minutes(out)).toBeCloseTo(50, 6);
    expect(out.some((s) => s.sessionId?.startsWith('c'))).toBe(false);
  });

  it('parts of one bout never clip each other; disjoint sessions are unchanged', () => {
    const circuit = [
      cardio('c', 9, 30, { boutId: 'b1' } as never),
      resist('r', 9, 30, { boutId: 'b1' } as never),
    ];
    expect(withoutOverlaps(circuit)).toHaveLength(2);
    const apart = [cardio('x', 7, 30), cardio('y', 8, 30)];
    expect(withoutOverlaps(apart)).toEqual(apart);
  });

  it('a session without minutes is kept as it is', () => {
    const dose = resist('d', 10, undefined as unknown as number);
    expect(withoutOverlaps([cardio('a', 10, 30), dose])).toContain(dose);
  });
});
