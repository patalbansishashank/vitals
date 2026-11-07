// @vitest-environment node
/** activityDetect identity, revisions and dedupe (energy SPEC §V2.5, notes C11). */
import { describe, expect, it } from 'vitest';
import { cadenceWindows, detectActivities, hrOnlyWindows, type DetectInput } from '../activityDetect';
import { freezeZoneBoundaries, hrProfile } from '../hrProfile';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 20, 1, 30, 0); // 07:00 local (+05:30)
const minter = () => {
  let n = 0;
  return () => `01KEY${String(++n).padStart(4, '0')}`;
};
const steps = (len: number, f: (k: number) => number | null) => Array.from({ length: len }, (_, k) => f(k));

describe('detectors', () => {
  it('cadence: ≥ 10 min, ≥ 80 % at ≥ 60/min, gaps ≤ 2 min; run at median ≥ 130', () => {
    const walk = cadenceWindows({
      first: T0,
      steps: steps(40, (k) => (k >= 5 && k < 30 ? (k === 12 || k === 13 ? 0 : 105) : 0)),
    });
    expect(walk).toHaveLength(1);
    expect(walk[0]!.kind).toBe('walk');
    expect(walk[0]!.start).toBe(T0 + 5 * MIN);
    expect(walk[0]!.end).toBe(T0 + 30 * MIN);
    expect(cadenceWindows({ first: T0, steps: steps(30, (k) => (k < 9 ? 110 : 0)) })).toHaveLength(0);
    expect(cadenceWindows({ first: T0, steps: steps(30, (k) => (k < 20 ? 150 : null)) })[0]!.kind).toBe(
      'run',
    );
    // a 3-min gap splits the bout
    expect(
      cadenceWindows({ first: T0, steps: steps(40, (k) => (k >= 12 && k < 15 ? 0 : 100)) }),
    ).toHaveLength(2);
  });

  it('HR-only: raised supported HR with few steps → cardio, type unknown; only where HR exists', () => {
    const zb = freezeZoneBoundaries(hrProfile({ ageY: 35 }))!; // 60 % = 110.1
    const m = {
      first: T0,
      steps: steps(30, () => 2),
      hr: { bpm: steps(30, (k) => (k < 20 ? 140 : 80)), supportedS: steps(30, () => 60) },
    };
    const w = hrOnlyWindows(m, zb);
    expect(w).toHaveLength(1);
    expect(w[0]!.end - w[0]!.start).toBe(20 * MIN);
    expect(hrOnlyWindows({ first: T0, steps: m.steps }, zb)).toEqual([]);
  });
});

describe('detectActivities', () => {
  const walkMinutes = { first: T0, steps: steps(60, (k) => (k >= 2 && k < 42 ? 108 : 0)) };
  const input = (over: Partial<DetectInput> = {}): DetectInput => ({
    gaugeSessions: [{ id: 'g1', revision: 'r1', start: T0, end: T0 + 45 * MIN, type: 'walk' }],
    hcSessions: [
      {
        id: 'hc9',
        revision: 'm1',
        start: T0 + 1 * MIN,
        end: T0 + 44 * MIN,
        exerciseType: 79,
        originPackage: 'com.google.android.apps.fitness',
      },
    ],
    telemetry: [{ id: 'tel1', revision: 't1', start: T0 + 2 * MIN, end: T0 + 43 * MIN, mode: 'walk' }],
    minutes: walkMinutes,
    mintKey: minter(),
    ...over,
  });

  it('4-source dedupe: the detector and the near-identical Health Connect copy are absorbed; the rest keep merge suggestions (never unions)', () => {
    const r = detectActivities(input());
    // (0.6.7) the HC session 07:01–07:44 is the same bout as the Gauge recording 07:00–07:45: evidence, not a second row
    expect(r.drafts.map((d) => d.sources[0]!.source)).toEqual(['gaugeSession', 'ringTelemetry']);
    expect(r.absorbed).toEqual([
      { ref: 'hc:hc9', into: 'gauge:g1' },
      { ref: `detect:cadence:${T0 + 2 * MIN}`, into: 'gauge:g1' },
    ]);
    const g = r.drafts[0]!;
    expect(g.corroboratedBy).toEqual(['hc:hc9', `detect:cadence:${T0 + 2 * MIN}`]);
    expect(g.window).toEqual({ start: T0, end: T0 + 45 * MIN });
    expect(g.mergeSuggestions.map((m) => m.withRef).sort()).toEqual(['ring:tel1']);
    expect(g.suggested.exerciseId).toBe('walk');
    expect(g.suggested.confidence).toBe('high');
    expect(g.measures.steps).toBe(40 * 108);
  });

  it('(0.6.7) a Health Connect copy of an activity already counted attaches to it and retires its own pending row', () => {
    const counted = {
      key: 'K-STRENGTH',
      window: { start: T0 + 1 * MIN, end: T0 + 26 * MIN },
      counted: true,
      hostRef: 'gauge:gym',
    };
    const hc = {
      id: 'hiit',
      revision: 'h1',
      start: T0,
      end: T0 + 25 * MIN,
      exerciseType: 36,
      originPackage: 'com.oneplus.health',
    };
    const r = detectActivities({
      hcSessions: [hc],
      existing: [counted],
      aliasIndex: new Map([['hc:hiit', 'K-HC']]),
      mintKey: minter(),
    });
    expect(r.drafts).toEqual([]);
    expect(r.absorbed).toEqual([{ ref: 'hc:hiit', into: 'K-STRENGTH' }]);
    expect(r.detectorHosts).toEqual([{ detectorKey: 'K-HC', detectorRef: 'hc:hiit', hostRef: 'gauge:gym' }]);
    // a partial overlap is not the same bout: it stays its own row (the review's duplicate hold asks)
    const part = detectActivities({
      hcSessions: [{ ...hc, end: T0 + 60 * MIN }],
      existing: [counted],
      mintKey: minter(),
    });
    expect(part.drafts).toHaveLength(1);
    // a counted activity that is not counted (pending) never hosts a copy
    const pending = detectActivities({
      hcSessions: [hc],
      existing: [{ ...counted, counted: false }],
      mintKey: minter(),
    });
    expect(pending.drafts).toHaveLength(1);
  });

  it('stable keys and revisions across re-imports; a changed source revision shows as updated', () => {
    const first = detectActivities(input());
    // V3 persists each new draft's proposed key and records its refs in the alias index
    const alias = new Map<string, string>();
    for (const d of first.drafts)
      for (const ref of [...d.refs, ...d.corroboratedBy]) alias.set(ref, d.matchedKey ?? d.proposedKey);
    const existing = first.drafts.map((d) => ({ key: d.proposedKey, window: d.window }));
    const again = detectActivities(input({ aliasIndex: alias, existing, mintKey: () => 'NEVER' }));
    expect(again.drafts.map((d) => d.matchedKey)).toEqual(first.drafts.map((d) => d.proposedKey));
    expect(again.drafts.map((d) => d.sourceRevision)).toEqual(first.drafts.map((d) => d.sourceRevision));
    expect(again.drafts.every((d) => d.proposedKey !== 'NEVER')).toBe(true);
    // re-ordered input: same result
    const shuffled = detectActivities(
      input({
        aliasIndex: alias,
        existing,
        hcSessions: input().hcSessions,
        telemetry: input().telemetry,
        gaugeSessions: [...input().gaugeSessions!].reverse(),
      }),
    );
    expect(shuffled.drafts.map((d) => d.matchedKey)).toEqual(first.drafts.map((d) => d.proposedKey));
    // the Gauge session is re-uploaded with a new revision: same key, new source revision
    const rev = detectActivities(
      input({
        aliasIndex: alias,
        existing,
        gaugeSessions: [{ id: 'g1', revision: 'r2', start: T0, end: T0 + 46 * MIN, type: 'walk' }],
      }),
    );
    expect(rev.drafts[0]!.matchedKey).toBe(first.drafts[0]!.proposedKey);
    expect(rev.drafts[0]!.sourceRevision).not.toBe(first.drafts[0]!.sourceRevision);
  });

  it('estimate revisions follow the estimator output; non-activity types never become bouts', () => {
    const a = detectActivities(input({ estimate: () => ({ G: 200 }) }));
    const b = detectActivities(input({ estimate: () => ({ G: 210 }) }));
    expect(a.drafts[0]!.estimateRevision).not.toBe(b.drafts[0]!.estimateRevision);
    expect(a.drafts[0]!.sourceRevision).toBe(b.drafts[0]!.sourceRevision);
    const other = detectActivities({
      hcSessions: [
        { id: 'x', revision: '1', start: T0, end: T0 + 30 * MIN, exerciseType: 0, originPackage: 'p' },
      ],
      mintKey: minter(),
    });
    expect(other.drafts).toHaveLength(1); // OTHER_WORKOUT is an activity, generic: needs review
    expect(other.drafts[0]!.suggested.needsReview).toBe(true);
    const breath = detectActivities({
      hcSessions: [
        { id: 'y', revision: '1', start: T0, end: T0 + 10 * MIN, exerciseType: 33, originPackage: 'p' },
      ],
      mintKey: minter(),
    });
    expect(breath.drafts).toHaveLength(0);
    expect(breath.skipped).toEqual([{ ref: 'hc:y', reason: 'nonActivity' }]);
  });

  it('a lone detector window is its own low-confidence draft; a plan match hint is given', () => {
    const r = detectActivities({
      minutes: walkMinutes,
      mintKey: minter(),
      planned: [{ id: 'plan-walk', window: { start: T0, end: T0 + 40 * MIN }, exerciseId: 'walk' }],
    });
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]!.sources[0]!.source).toBe('cadenceDetector');
    expect(r.drafts[0]!.suggested.confidence).toBe('medium');
    expect(r.drafts[0]!.planMatchHint).toEqual({
      plannedId: 'plan-walk',
      overlapPct: (100 * 38) / 40,
      sameType: true,
    });
  });
});

describe('a detector-only candidate keeps its key on re-import', () => {
  it('re-emits the draft with its matched key, and is not absorbed into itself', () => {
    const m = { first: T0, steps: steps(60, (k) => (k >= 2 && k < 42 ? 108 : 0)) };
    const a = detectActivities({ minutes: m, mintKey: minter() });
    const key = a.drafts[0]!.proposedKey;
    const alias = new Map([[a.drafts[0]!.refs[0]!, key]]);
    const b = detectActivities({
      minutes: m,
      mintKey: minter(),
      aliasIndex: alias,
      existing: [{ key, window: a.drafts[0]!.window }],
    });
    expect(b.drafts).toHaveLength(1);
    expect(b.drafts[0]!.matchedKey).toBe(key);
    expect(b.absorbed).toEqual([]);
  });
});
