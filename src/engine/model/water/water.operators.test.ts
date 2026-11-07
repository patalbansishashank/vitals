/**
 * D5-02 (water contribution, C4): the water-adjusted wake observable is the same-path difference of the wake-sampled
 * scale weight and labile water, evaluated per member before quantiles.
 *  - A pure glycogen/creatine water transition with unchanged tissue moves the scale but not the water-adjusted mass.
 *  - Wake alignment: the observable equals the path's tissue at its wake hour, not the end-of-day (midnight) tissue, and
 *    the wake path refuses end-of-day quantities so an operator cannot mix the two samples.
 *  - Correlated members: per-member operator quantiles differ from subtracting percentile endpoints.
 *  - A run continued from a cloned state gives the same operator values as the uninterrupted run.
 */
import { describe, expect, it } from 'vitest';
import {
  MODEL_TISSUE_MASS_OPERATOR,
  SCALE_WAKE_OPERATOR,
  WATER_ADJUSTED_WAKE_OPERATOR,
  empiricalQuantiles,
} from '@/lib/measurementOperators';
import { SERIES } from '../../types/metrics';
import { WAKE_OPERATOR_SERIES, wakeOperatorQuantiles, wakeSamplePath, waterAdjustedWakeKg, type WakeSeries } from './operators';
import { makeRig, type Rig } from './testKit';

interface HourTrace {
  scale: number[][];
  water: number[][];
  tissue: number[][];
}

/** Step `days` whole days hour by hour; `drive(day, hour, rig)` sets the other modules' signals before each hour. */
function run(rig: Rig, days: number, drive: (day: number, hour: number, rig: Rig) => void): HourTrace {
  const t: HourTrace = { scale: [], water: [], tissue: [] };
  for (let d = 0; d < days; d++) {
    const sc: number[] = [];
    const wa: number[] = [];
    const ti: number[] = [];
    for (let h = 0; h < 24; h++) {
      rig.step(1, (_hi, r) => drive(rig.dayIdx, h, r));
      sc.push(rig.s.scaleKg);
      wa.push(rig.s.labileKg);
      ti.push(rig.bus.tissueMassKg);
    }
    t.scale.push(sc);
    t.water.push(wa);
    t.tissue.push(ti);
  }
  return t;
}

/** The recorder's 'wake' aggregation: each day's value at that day's wake hour. */
function wakeSeries(t: HourTrace, wakeHour: number): { scaleWeight: number[]; waterWeight: number[]; tissueWake: number[] } {
  return {
    scaleWeight: t.scale.map((d) => d[wakeHour]!),
    waterWeight: t.water.map((d) => d[wakeHour]!),
    tissueWake: t.tissue.map((d) => d[wakeHour]!),
  };
}

/** Creatine loading from day 2 and a glycogen refill of `glyG` from day 3; tissue fixed unless `tissueKgPerH` is set. */
function waterTransition(glyG: number, creatine = 1, tissueKgPerH = 0) {
  return (day: number, hour: number, r: Rig): void => {
    r.bus.creatineSatFrac = day >= 2 ? creatine : 0;
    r.bus.muscleGlycogenG = r.profile.body.glycogen.muscleG + (day >= 3 ? glyG : 0);
    if (tissueKgPerH !== 0) r.bus.tissueMassKg = r.profile.weightKg + tissueKgPerH * (24 * day + hour + 1);
  };
}

describe('water D5-02 — water-adjusted wake observable', () => {
  it('both operator inputs are wake-sampled series owned by water', () => {
    for (const id of WAKE_OPERATOR_SERIES.waterAdjustedWake) {
      const def = SERIES.find((s) => s.id === id)!;
      expect(def.owner).toBe('water');
      expect(def.agg).toBe('wake');
    }
  });

  it('a pure glycogen/creatine water shift moves the scale but not the water-adjusted mass', () => {
    const rig = makeRig();
    const t = run(rig, 6, waterTransition(250));
    const w = wakeSeries(t, rig.s.wakeHour);
    const adj = waterAdjustedWakeKg(w, 6);
    expect(Math.max(...w.scaleWeight) - Math.min(...w.scaleWeight)).toBeGreaterThan(0.8);
    for (let d = 0; d < 6; d++) expect(adj[d]).toBeCloseTo(rig.profile.weightKg, 9);
  });

  it('aligns with the wake hour: equals tissue at the wake hour, not the end-of-day tissue', () => {
    const rig = makeRig();
    const t = run(rig, 4, waterTransition(150, 1, -0.004));
    const w = wakeSeries(t, rig.s.wakeHour);
    const adj = waterAdjustedWakeKg(w, 4);
    for (let d = 0; d < 4; d++) {
      expect(adj[d]).toBeCloseTo(w.tissueWake[d]!, 9);
      expect(Math.abs(adj[d]! - t.tissue[d]![23]!)).toBeGreaterThan(0.05);
    }
    // the wake path holds wake samples only: an end-of-day operator cannot be evaluated on it
    const path = wakeSamplePath(w);
    expect(MODEL_TISSUE_MASS_OPERATOR.apply(path, 24)).toBeNull();
    expect(path.value('fatMassKg', 24)).toBeNull();
    expect(path.value('scaleWeightKg', 24 * 99)).toBeNull();
    expect(wakeSamplePath({ scaleWeight: [Number.NaN] }).value('scaleWeightKg', 0)).toBeNull();
  });

  it('per-member operator quantiles differ from percentile-endpoint subtraction for correlated members', () => {
    const members: WakeSeries[] = [];
    for (const [gly, cr] of [[0, 0], [100, 0.4], [200, 0.7], [300, 1], [400, 1]] as const) {
      const rig = makeRig();
      const t = run(rig, 5, waterTransition(gly, cr));
      members.push(wakeSeries(t, rig.s.wakeHour));
    }
    const day = 4;
    const joint = wakeOperatorQuantiles(WATER_ADJUSTED_WAKE_OPERATOR, members, 5)[day]!;
    // every member has the same tissue: the joint band of the water-adjusted mass collapses onto it
    expect(joint[0]).toBeCloseTo(joint[2]!, 9);
    const scaleQ = empiricalQuantiles(members.map((m) => m.scaleWeight![day]!))!;
    const waterQ = empiricalQuantiles(members.map((m) => m.waterWeight![day]!))!;
    const endpointLow = scaleQ[0]! - waterQ[2]!;
    const endpointHigh = scaleQ[2]! - waterQ[0]!;
    expect(endpointHigh - endpointLow).toBeGreaterThan(0.5);
    expect(joint[2]! - joint[0]!).toBeLessThan(1e-9);
    // the scale operator itself keeps its member spread
    const scaleBand = wakeOperatorQuantiles(SCALE_WAKE_OPERATOR, members, 5)[day]!;
    expect(scaleBand).toEqual(scaleQ);
    expect(wakeOperatorQuantiles(WATER_ADJUSTED_WAKE_OPERATOR, [], 5)[day]).toBeNull();
  });

  it('a run continued from a cloned state gives the same operator values as the uninterrupted run', () => {
    const drive = waterTransition(220, 1);
    const full = makeRig();
    const tFull = run(full, 5, drive);
    const head = makeRig();
    run(head, 2, drive);
    const cont = makeRig();
    Object.assign(cont.s, structuredClone(head.s));
    Object.assign(cont.bus, { ...head.bus });
    cont.dayIdx = head.dayIdx;
    cont.hourOfDay = head.hourOfDay;
    const tCont = run(cont, 3, drive);
    const wFull = wakeSeries(tFull, full.s.wakeHour);
    const wCont = wakeSeries(tCont, cont.s.wakeHour);
    const aFull = waterAdjustedWakeKg(wFull, 5).slice(2);
    const aCont = waterAdjustedWakeKg(wCont, 3);
    expect(aCont).toEqual(aFull);
    expect(wCont.scaleWeight).toEqual(wFull.scaleWeight.slice(2));
  });
});
