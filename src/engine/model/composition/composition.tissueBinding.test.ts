// @vitest-environment node
/**
 * D4-05 (composition provider, C4/C6): the tissue-mass binding FM + FFM_act and the tissue fat fraction 100·FM/(FM + FFM_act),
 * read at one sampled time the same way in a fresh run, a replay with a tissue anchor and a day-stamped continuation
 * (ForwardModel/replan). FFM_act keeps the baseline glycogen and its water (referenceFfm = FFM0 − LT0), so the
 * denominator is never FM + leanTissue; labile water and glycogen swings never enter; a missing or non-finite output makes
 * the trace unavailable (no NaN, no 0, no start value) and the lean-partition status propagates to it.
 */
import { describe, expect, it } from 'vitest';
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import { TISSUE_FAT_FRACTION_OPERATOR, MODEL_TISSUE_MASS_OPERATOR, type ModelPath } from '@/lib/measurementOperators';
import { runEngine } from '../../core/loop';
import { compileSchedule } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import { MODULES } from '../../core/moduleRegistry';
import { GOAL_CAPABILITY, SERIES_OBSERVABLE, type SeriesId } from '../../types/metrics';
import type { SimulationResult } from '../../types/result';
import {
  COMPOSITION_TISSUE_BINDING,
  compositionTissue,
  compositionTissueTrace,
  ffmActOf,
  initialLeanTissueKg,
  profileCompositionTissue,
  readCompositionTissue,
  snapshotCompositionTissue,
  tissueFatFractionPct,
  tissueReferenceFfmKg,
  type CompositionState,
  type CompositionTissueTrace,
  type CompositionTissueTraceSource,
} from './index';

const START = '2026-10-05';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 38, heightCm: 178, weightKg: 92, waistCm: 100 }, startDate: START };
const day = (id: string, carbsG: number): DayTemplate => ({
  id,
  label: id,
  energy: { kind: 'kcal', kcal: 1900 },
  macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: carbsG }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 8, lengthH: 11 } },
  steps: 8000,
  sleep: { bedH: 23, wakeH: 7 },
});
const HORIZON = 21;
/** One low-carbohydrate week (glycogen and its water fall), then two high-carbohydrate weeks at the same energy (refill). */
const SCHEDULE: Schedule = {
  schemaVersion: 1,
  startDate: START,
  horizonDays: HORIZON,
  programs: [day('lowCarb', 40), day('highCarb', 330)],
  days: Array.from({ length: HORIZON }, (_, i) => ({ program: i < 7 ? 0 : 1 })),
};
const SNAP_DAY = 9;
const COMP_IDX = MODULES.findIndex((m) => m.id === 'composition');

const rp = resolveProfile(MAN);
const cs = compileSchedule(SCHEDULE, rp);
const SERIES: SeriesId[] = ['fatMass', 'leanTissue', 'scaleWeight', 'bodyFatPct'];
const full = runEngine(rp, cs, { record: 'daily', series: SERIES, captureSnapshotAt: [0, SNAP_DAY], constraints: true });

function ok(t: CompositionTissueTrace): Extract<CompositionTissueTrace, { available: true }> {
  if (!t.available) throw new Error(`trace unavailable: ${t.reasonCode}`);
  return t;
}

/** A ModelPath over the end-of-day binding of one trace index (for the C4 operators of the lib). */
function pathAt(fatMassKg: number, ffmActKg: number): ModelPath {
  return { value: (name) => (name === 'fatMassKg' ? fatMassKg : name === 'ffmActKg' ? ffmActKg : null) };
}

describe('D4-05 — tissue-mass binding contract', () => {
  it('declares the consumer operator and outputs of the tissue body-fat goal and stays distinct from the wake scale reading', () => {
    expect(COMPOSITION_TISSUE_BINDING.tissueFatFraction.operator).toBe(GOAL_CAPABILITY.bodyFatPct.operator);
    expect([...COMPOSITION_TISSUE_BINDING.requiredSeries]).toEqual([...GOAL_CAPABILITY.bodyFatPct.requiredOutputs]);
    expect(SERIES_OBSERVABLE.bodyFatPct).toBe('scaleBodyFatWake');
    expect(COMPOSITION_TISSUE_BINDING.distinctOperators).toContain(SERIES_OBSERVABLE.bodyFatPct);
    expect(COMPOSITION_TISSUE_BINDING.tissueMass.operator).toBe(MODEL_TISSUE_MASS_OPERATOR.tag.id);
    expect(COMPOSITION_TISSUE_BINDING.tissueFatFraction.operator).toBe(TISSUE_FAT_FRACTION_OPERATOR.tag.id);
  });

  it('FFM_act carries the baseline glycogen and its water: the denominator is FM + FFM_act, not FM + leanTissue', () => {
    const s = { fmKg: 25, ltKg: 60.2, lt0Kg: 61, ffm0Kg: 63.5 };
    const t = compositionTissue(s)!;
    expect(t.referenceFfmKg).toBeCloseTo(2.5, 12);
    expect(t.ffmActKg).toBeCloseTo(62.7, 12);
    expect(ffmActOf(s)).toBe(t.ffmActKg);
    expect(t.tissueMassKg).toBeCloseTo(87.7, 12);
    expect(t.tissueFatPct!).toBeCloseTo((100 * 25) / 87.7, 12);
    expect(t.tissueFatPct!).not.toBeCloseTo((100 * 25) / (25 + 60.2), 3);
    expect(t.tissueFatPct!).toBeCloseTo(TISSUE_FAT_FRACTION_OPERATOR.apply(pathAt(t.fatMassKg, t.ffmActKg), 0)!, 12);
    expect(t.tissueMassKg).toBeCloseTo(MODEL_TISSUE_MASS_OPERATOR.apply(pathAt(t.fatMassKg, t.ffmActKg), 0)!, 12);
  });

  it('a degenerate tissue never becomes a number (no NaN, no 0 %)', () => {
    expect(tissueFatFractionPct(Number.NaN, 60)).toBeNull();
    expect(tissueFatFractionPct(0, 0)).toBeNull();
    expect(tissueFatFractionPct(-1, 60)).toBeNull();
    expect(compositionTissue({ fmKg: Number.NaN, ltKg: 60, lt0Kg: 60, ffm0Kg: 62 })).toBeNull();
  });

  it('C7 read adapter: a legacy stored state with only the four masses reads; a malformed one or a snapshot without composition is null', () => {
    const legacy = { fmKg: 20, ltKg: 55, lt0Kg: 55, ffm0Kg: 57.4, someRetiredField: 1 };
    expect(readCompositionTissue(legacy)!.referenceFfmKg).toBeCloseTo(2.4, 12);
    expect(readCompositionTissue({ fmKg: 20, ltKg: '55', lt0Kg: 55, ffm0Kg: 57 })).toBeNull();
    expect(readCompositionTissue(null)).toBeNull();
    expect(snapshotCompositionTissue({ moduleIds: ['energy'], states: [{}] })).toBeNull();
  });

  it('the profile reference is the module’s own LT0 rule (same arithmetic as initialization)', () => {
    const snap0 = full.snapshots![0]!;
    const s = snap0.states[COMP_IDX] as CompositionState;
    const p = profileCompositionTissue(rp)!;
    expect(p.referenceFfmKg).toBe(s.ffm0Kg - s.lt0Kg);
    expect(p.referenceFfmKg).toBe(s.otherFfmKg);
    expect(p.referenceFfmKg).toBeGreaterThan(0);
    expect(initialLeanTissueKg(rp.ffm0Kg, rp.body.glycogen.totalG, 3)).toBe(s.lt0Kg);
    expect(p.tissueMassKg).toBeCloseTo(rp.fm0Kg + rp.ffm0Kg, 12);
    expect(tissueReferenceFfmKg(rp)).toBe(p.referenceFfmKg);
  });
});

describe('D4-05 — the same tissue trajectory in fresh, continuation and anchored replay runs', () => {
  const ref = tissueReferenceFfmKg(rp)!;
  const trace = ok(compositionTissueTrace(full, ref));

  it('fresh run: index 0 is the post-burn-in state and every later index the end-of-day state, matching the safety trace', () => {
    expect(trace.startDay).toBe(0);
    expect(trace.tissueMassKg.length).toBe(HORIZON + 1);
    const s0 = snapshotCompositionTissue(full.snapshots![0]!)!;
    expect(trace.tissueMassKg[0]!).toBeCloseTo(s0.tissueMassKg, 4);
    expect(trace.tissueFatPct[0]!).toBeCloseTo(s0.tissueFatPct!, 4);
    for (let d = 0; d < HORIZON; d++) {
      expect(trace.tissueMassKg[d + 1]!, `day ${d}`).toBeCloseTo(full.safety.tissueMassKg[d]!, 3);
      expect(trace.tissueFatPct[d + 1]!, `day ${d}`).toBeCloseTo(full.safety.bodyFatPct[d]!, 3);
    }
    expect(trace.status).toBe('estimated');
    expect(trace.uncertaintyKind).toBe('none');
  });

  it('after glycogen changes the objective still matches 100·FM/tissueMass with the baseline reference kept', () => {
    const snap = full.snapshots![SNAP_DAY]!;
    const s = snap.states[COMP_IDX] as CompositionState;
    const t = snapshotCompositionTissue(snap)!;
    expect(t.referenceFfmKg).toBe(ref);
    expect(s.ffm0Kg - s.lt0Kg).toBe(ref);
    // the tissue fraction at the start of SNAP_DAY = end of SNAP_DAY − 1
    expect(trace.tissueFatPct[SNAP_DAY]!).toBeCloseTo((100 * t.fatMassKg) / t.tissueMassKg, 4);
  });

  it('water-only scale movement does not move the tissue objective: the refeed raises scale weight far more than tissue', () => {
    const scale = full.daily.scaleWeight!;
    const wakeBf = full.daily.bodyFatPct!;
    // the first high-carbohydrate day (day 7) refills glycogen and its water: the next morning's scale rises and the wake
    // reading of body fat falls, while tissue (end of day 7 vs end of day 6) keeps falling with the energy deficit
    const dScale = scale[8]! - scale[7]!;
    const dTissue = trace.tissueMassKg[8]! - trace.tissueMassKg[7]!;
    expect(dScale).toBeGreaterThan(0.3);
    expect(dTissue).toBeLessThan(0);
    const dWakeBf = wakeBf[8]! - wakeBf[7]!;
    const dTissueBf = trace.tissueFatPct[8]! - trace.tissueFatPct[7]!;
    expect(dWakeBf).toBeLessThan(0);
    expect(Math.abs(dTissueBf)).toBeLessThan(Math.abs(dWakeBf) / 2);
    // same fat and lean tissue with any water/scale series → the same trace (the binding reads FM and LT only)
    const wetter: CompositionTissueTraceSource = {
      initial: { ...full.initial, scaleWeight: (full.initial.scaleWeight ?? 0) + 2 },
      daily: { ...full.daily, scaleWeight: scale.map((x) => x + 2), bodyFatPct: wakeBf.map((x) => x - 1) },
      meta: full.meta,
    };
    expect(Array.from(ok(compositionTissueTrace(wetter, ref)).tissueFatPct)).toEqual(Array.from(trace.tissueFatPct));
  });

  it('day-stamped continuation (ForwardModel snapshot mode): first frame = the snapshot tissue, then identical to the full run', () => {
    const snap = full.snapshots![SNAP_DAY]!;
    const cont = runEngine(rp, cs, { record: 'daily', series: SERIES, initialSnapshot: snap, constraints: true });
    const refSnap = tissueReferenceFfmKg(rp, snap)!;
    expect(refSnap).toBe(ref);
    const tc = ok(compositionTissueTrace(cont, refSnap));
    expect(tc.startDay).toBe(SNAP_DAY);
    expect(tc.tissueMassKg.length).toBe(HORIZON - SNAP_DAY + 1);
    const st = snapshotCompositionTissue(snap)!;
    expect(tc.tissueMassKg[0]!).toBeCloseTo(st.tissueMassKg, 4);
    expect(tc.tissueFatPct[0]!).toBeCloseTo(st.tissueFatPct!, 4);
    // index 0 is the continuation's float64 first frame, the full run's index SNAP_DAY its float32 daily record
    for (let j = 0; j < tc.tissueMassKg.length; j++) {
      expect(tc.tissueMassKg[j]!, `index ${j}`).toBeCloseTo(trace.tissueMassKg[SNAP_DAY + j]!, 5);
      expect(tc.tissueFatPct[j]!, `index ${j}`).toBeCloseTo(trace.tissueFatPct[SNAP_DAY + j]!, 5);
    }
    for (let d = SNAP_DAY; d < HORIZON; d++) expect(tc.tissueFatPct[d - SNAP_DAY + 1]!).toBeCloseTo(cont.safety.bodyFatPct[d]!, 3);
  });

  it('replay with a tissue anchor (ForwardModel replay mode): the anchor moves FM and LT, never the reference', () => {
    const target = trace.tissueMassKg[SNAP_DAY]! - 1.5;
    const anchored = runEngine(rp, cs, {
      record: 'daily',
      series: ['fatMass', 'leanTissue'],
      anchors: [{ day: SNAP_DAY, tissueMassKg: target }],
      captureSnapshotAt: [SNAP_DAY + 1],
      constraints: true,
    });
    const after = snapshotCompositionTissue(anchored.snapshots![SNAP_DAY + 1]!)!;
    expect(after.referenceFfmKg).toBe(ref);
    const ta = ok(compositionTissueTrace(anchored, ref));
    for (let d = SNAP_DAY; d < HORIZON; d++) {
      expect(ta.tissueMassKg[d + 1]!).toBeCloseTo(anchored.safety.tissueMassKg[d]!, 3);
      expect(ta.tissueFatPct[d + 1]!).toBeCloseTo(anchored.safety.bodyFatPct[d]!, 3);
    }
    expect(ta.tissueMassKg[SNAP_DAY + 1]!).toBeLessThan(trace.tissueMassKg[SNAP_DAY + 1]! - 1);
  });
});

describe('D4-05 — missing outputs abstain; unsupported partition propagates', () => {
  const ref = tissueReferenceFfmKg(rp)!;
  const base = (over: Partial<SimulationResult['daily']> = {}, meta: CompositionTissueTraceSource['meta'] = {}): CompositionTissueTraceSource => ({
    initial: full.initial,
    daily: { ...full.daily, ...over },
    meta,
  });

  it('a missing fat or lean series is unavailable, with no arrays (never 0, never the start value)', () => {
    const noLean = compositionTissueTrace({ initial: full.initial, daily: { fatMass: full.daily.fatMass! } }, ref);
    expect(noLean).toMatchObject({ available: false, status: 'unavailable', reasonCode: 'missingLeanTissue' });
    expect('tissueFatPct' in noLean).toBe(false);
    expect(compositionTissueTrace({ initial: full.initial, daily: { leanTissue: full.daily.leanTissue! } }, ref)).toMatchObject({ available: false, reasonCode: 'missingFatMass' });
    expect(compositionTissueTrace(full, null)).toMatchObject({ available: false, reasonCode: 'invalidReference' });
    expect(compositionTissueTrace(full, Number.NaN)).toMatchObject({ available: false, reasonCode: 'invalidReference' });
  });

  it('one non-finite day anywhere in the functional makes the whole trace unavailable', () => {
    const fm = Float32Array.from(full.daily.fatMass!);
    fm[12] = Number.NaN;
    expect(compositionTissueTrace(base({ fatMass: fm }), ref)).toMatchObject({ available: false, status: 'unavailable', reasonCode: 'nonFiniteTissue', firstMissingIndex: 13 });
    const noInitial = compositionTissueTrace({ initial: {}, daily: full.daily }, ref);
    expect(noInitial).toMatchObject({ available: false, reasonCode: 'nonFiniteTissue', firstMissingIndex: 0 });
  });

  it('a model-limit termination (days left unrecorded) is reported as a model limit, not a value', () => {
    const fm = Float32Array.from(full.daily.fatMass!);
    fm.fill(Number.NaN, 15);
    const t = compositionTissueTrace(base({ fatMass: fm }, { outputStatus: { fatMass: { status: 'modelLimit', reasonCode: 'tissueFloorModelLimit', fromDay: 15 } } }), ref);
    expect(t).toMatchObject({ available: false, status: 'modelLimit', reasonCode: 'modelLimit', firstMissingIndex: 16 });
  });

  it('a scenario lean partition makes the tissue fat fraction a conditional scenario from the same day', () => {
    const t = ok(
      compositionTissueTrace(
        base({}, { outputStatus: { leanTissue: { status: 'scenario', reasonCode: 'lowProteinSurplusPartition', uncertaintyKind: 'scenario', fromDay: 4 } } }),
        ref,
      ),
    );
    expect(t.status).toBe('scenario');
    expect(t.reasonCode).toBe('lowProteinSurplusPartition');
    expect(t.uncertaintyKind).toBe('scenario');
    expect(t.fromDay).toBe(4);
    // the numbers themselves are unchanged (status travels beside them)
    expect(Array.from(t.tissueFatPct)).toEqual(Array.from(ok(compositionTissueTrace(full, ref)).tissueFatPct));
  });

  it('a limited very-low-intake branch on fat and lean propagates as a scenario; a whole-run status has no fromDay', () => {
    const t = ok(
      compositionTissueTrace(
        base({}, {
          outputStatus: {
            fatMass: { status: 'limited', reasonCode: 'veryLowIntakeOutsideSupport', uncertaintyKind: 'scenario', fromDay: 6 },
            leanTissue: { status: 'limited', reasonCode: 'veryLowIntakeOutsideSupport', uncertaintyKind: 'scenario' },
          },
        }),
        ref,
      ),
    );
    expect(t.status).toBe('scenario');
    expect(t.fromDay).toBeUndefined();
  });
});
