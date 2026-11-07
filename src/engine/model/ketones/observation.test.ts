// @vitest-environment node
/**
 * D2-08 observation semantics and D2-03 tag conservation of the ketone module, driven directly with hand-built bus values:
 * the hour mean is transformed before averaging, the hour end is the instantaneous prediction a fingerstick is compared
 * with, untimed/other-specimen readings never become exact blood endpoints, the personal correction is one concentration
 * scale per pooling key, and tagged sub-pools conserve their share under the shared fractional clearance.
 */
import { describe, expect, it } from 'vitest';
import { createSignalBus, type SignalBus } from '../../types/signals';
import type { EventSink } from '../../types/module';
import { MODULES } from '../../core/moduleRegistry';
import { bhbFromTkb, initKetones, KETONES_OUTPUT_CONTRACT, prepareKetones, stepKetones, type KetonesConst, type KetonesState } from './index';
import { fitKetoneCorrection, ketonePoolKey, predictKetoneReading, readingMmolL, type KetoneObservation } from './observation';
import { makeContext } from './testing/harness';

const SINK: EventSink = { emit: () => {} };

function rig(): { k: KetonesConst; s: KetonesState; bus: SignalBus } {
  const ctx = makeContext({ habitualProteinG: 90, habitualCarbG: 300 }, 75, 60, SINK);
  const k = prepareKetones(ctx);
  const bus = createSignalBus();
  bus.tissueMassKg = 75;
  bus.ffmActKg = 60;
  bus.tdeeEstKcalD = 2500;
  bus.kcalEaten24 = 2500;
  bus.carbAbs24G = 300;
  bus.liverGlycogenG = 80;
  bus.insulinRefRel = 1;
  const s = initKetones(k, ctx, bus);
  return { k, s, bus };
}

describe('hour mean vs hour end (D2-08)', () => {
  it('the hour mean is the mean of BHB(TKB) over the sub-steps, not BHB of the mean TKB (convex transform)', () => {
    const { k, s, bus } = rig();
    bus.exoKetoneMmolH = 240; // 25-g ester class dose, fasted
    stepKetones(s, k, bus, 0, 0, 25, 0, SINK);
    const gOfMean = bhbFromTkb(k, s.tkbMean);
    expect(s.bhb).toBeGreaterThan(gOfMean); // BHB(T) is convex: mean of the transform exceeds the transform of the mean
    expect(s.bhb - gOfMean).toBeGreaterThan(1e-4);
    expect(bus.bhbMmolL).toBe(s.bhb);
    // the hour end is the instantaneous value at the end of the hour: it differs from the hour mean during a rise
    expect(s.bhbEnd).toBe(bhbFromTkb(k, s.tkb));
    expect(Math.abs(s.bhbEnd - s.bhb)).toBeGreaterThan(0.05);
  });
  it('at a steady state mean and endpoint agree (no artificial offset between the two operators)', () => {
    const { k, s, bus } = rig();
    for (let h = 0; h < 72; h++) stepKetones(s, k, bus, 0, 0, 0, h, SINK);
    expect(Math.abs(s.bhb - s.bhbEnd)).toBeLessThan(1e-3);
  });
  it('the output contract keeps the legacy hour-mean id and names the endpoint operator; no adaptation certificate', () => {
    expect(KETONES_OUTPUT_CONTRACT.bhb.operator).toBe('bhbHourlyMean');
    expect(KETONES_OUTPUT_CONTRACT.bhbEndpoint.operator).toBe('bhbEndpoint');
    expect(KETONES_OUTPUT_CONTRACT.adaptation.certificate).toBe(false);
    expect(KETONES_OUTPUT_CONTRACT.retiredEvents).toContain('ketoAdapted');
  });
  it('no "keto-adapted" certificate event is emitted however long the adaptation state stays high', () => {
    const { k, s, bus } = rig();
    const ev: string[] = [];
    const sink: EventSink = { emit: (type) => void ev.push(type) };
    bus.carbAbs24G = 0;
    bus.kcalEaten24 = 0;
    bus.liverGlycogenG = 10;
    bus.insulinRefRel = 0.4;
    for (let h = 0; h < 24 * 10; h++) stepKetones(s, k, bus, 0, 0, 0, h, sink);
    expect(s.aF).toBeGreaterThan(0.95);
    expect(ev).not.toContain('ketoAdapted');
  });
});

describe('tagged pools conserve their share under the shared fractional clearance (D2-03)', () => {
  it('with constant inputs each tag converges to its share of production (removal is proportional to the tag)', () => {
    const { k, s, bus } = rig();
    bus.raMctGH = 4;
    bus.exoKetoneMmolH = 30;
    bus.kcalEaten24 = 1200;
    bus.carbAbs24G = 40;
    bus.liverGlycogenG = 40;
    bus.insulinRefRel = 0.6;
    for (let h = 0; h < 1200; h++) stepKetones(s, k, bus, 0, 0, 0, h, SINK);
    const yMol = k.yC8 * k.mmolFaPerGC8 * k.mctC8Share + k.yC10 * k.mmolFaPerGC10 * (1 - k.mctC8Share);
    const pMct = (yMol * bus.raMctGH) / 60;
    const pExo = bus.exoKetoneMmolH / 60;
    const total = s.prodMmolMin;
    expect(s.tkbMct / s.tkb).toBeCloseTo(pMct / total, 3);
    expect(s.tkbExo / s.tkb).toBeCloseTo(pExo / total, 3);
    expect(s.tkbExo + s.tkbMct).toBeLessThan(s.tkb);
  });
  it('after the inputs stop, every tag decays with the pool and never exceeds it', () => {
    const { k, s, bus } = rig();
    bus.raMctGH = 6;
    bus.exoKetoneMmolH = 120;
    stepKetones(s, k, bus, 0, 0, 10, 0, SINK);
    bus.raMctGH = 0;
    bus.exoKetoneMmolH = 0;
    let prevE = s.tkbExo;
    let prevM = s.tkbMct;
    for (let h = 1; h < 12; h++) {
      stepKetones(s, k, bus, 0, 0, 0, h, SINK);
      expect(s.tkbExo).toBeLessThanOrEqual(prevE);
      expect(s.tkbMct).toBeLessThanOrEqual(prevM);
      expect(s.tkbExo + s.tkbMct).toBeLessThanOrEqual(s.tkb + 1e-12);
      prevE = s.tkbExo;
      prevM = s.tkbMct;
    }
    expect(s.tkbExo).toBeLessThan(0.01);
  });
});

describe('blood D-BHB observation operator (D2-08)', () => {
  // path: steady 0.3 mM, an ester spike in hour 10 (mean 1.6, end 2.4), decay after
  const mean = Float64Array.from({ length: 24 }, (_, h) => (h === 10 ? 1.6 : h === 11 ? 1.9 : h === 12 ? 1.2 : 0.3));
  const end = Float64Array.from({ length: 24 }, (_, h) => (h === 10 ? 2.4 : h === 11 ? 1.5 : h === 12 ? 0.9 : 0.3));
  const path = { hourlyMean: mean, endpoint: end, initial: 0.3 };
  const blood = (time: KetoneObservation['time'], value = 2, extra: Partial<KetoneObservation> = {}): KetoneObservation => ({ id: 'o', value, unit: 'mmol/L', specimen: 'capillaryBlood', analyte: 'dBhb', time, meter: 'm1', context: 'ester', ...extra });

  it('a timed fingerstick is compared with the instantaneous path at its sampling time, not the hour mean', () => {
    const p = predictKetoneReading(blood({ kind: 'instant', hour: 11 }), path);
    expect(p.status).toBe('comparable');
    expect(p.operator).toBe('bhbEndpoint');
    expect(p.predicted).toBeCloseTo(2.4, 12); // end of hour 10 = time 11
    expect(p.predicted).not.toBeCloseTo(mean[10]!, 1);
    const mid = predictKetoneReading(blood({ kind: 'instant', hour: 10.5 }), path);
    expect(mid.predicted).toBeCloseTo(0.5 * (0.3 + 2.4), 12);
    expect(mid.approximation).toBe('hourEndLinear');
  });
  it('without recorded endpoints the point is reconstructed between hour midpoints and flagged as an approximation', () => {
    const p = predictKetoneReading(blood({ kind: 'instant', hour: 10.5 }), { hourlyMean: mean });
    expect(p.status).toBe('comparable');
    expect(p.approximation).toBe('hourMeanMidpoint');
    expect(p.predicted).toBeCloseTo(1.6, 12);
  });
  it('an untimed legacy reading never pretends to be an exact endpoint: it gets the model range of its day', () => {
    const p = predictKetoneReading(blood({ kind: 'unknown', day: 0 }), path);
    expect(p.status).toBe('untimed');
    expect(p.predicted).toBeUndefined();
    expect(p.range).toEqual([0.3, 2.4]);
    expect(predictKetoneReading(blood({ kind: 'unknown' }), path).status).toBe('outsidePath');
  });
  it('urine/breath, acetoacetate and racemic readings have no operator onto blood D-BHB; units are never assumed', () => {
    expect(predictKetoneReading(blood({ kind: 'instant', hour: 3 }, 1.5, { specimen: 'urine' }), path).status).toBe('noOperator');
    expect(predictKetoneReading(blood({ kind: 'instant', hour: 3 }, 1.5, { specimen: 'breath' }), path).status).toBe('noOperator');
    expect(predictKetoneReading(blood({ kind: 'instant', hour: 3 }, 1.5, { analyte: 'racemicBhb' }), path).status).toBe('unsupportedAnalyte');
    expect(predictKetoneReading(blood({ kind: 'instant', hour: 3 }, 1.5, { analyte: 'acetoacetate' }), path).status).toBe('unsupportedAnalyte');
    expect(predictKetoneReading(blood({ kind: 'instant', hour: 3 }, 1.5, { unit: 'unknown' }), path).status).toBe('unsupportedUnit');
    expect(readingMmolL({ value: 10.41, unit: 'mg/dL' })).toBeCloseTo(1, 3);
    // the reading itself stays an observed value with its unit
    const r = predictKetoneReading(blood({ kind: 'instant', hour: 3 }, 1.5, { specimen: 'urine' }), path).reading;
    expect(r.status).toBe('observed');
    expect(r.value).toBe(1.5);
  });
  it('meters, specimens and analytes are separate pooling keys', () => {
    expect(ketonePoolKey({ specimen: 'capillaryBlood', analyte: 'dBhb', meter: 'a' })).not.toBe(ketonePoolKey({ specimen: 'capillaryBlood', analyte: 'dBhb', meter: 'b' }));
    expect(ketonePoolKey({ specimen: 'capillaryBlood', analyte: 'dBhb', meter: 'a' })).not.toBe(ketonePoolKey({ specimen: 'venousBlood', analyte: 'dBhb', meter: 'a' }));
    expect(ketonePoolKey({ specimen: 'capillaryBlood', analyte: 'dBhb', meter: 'a' })).not.toBe(ketonePoolKey({ specimen: 'capillaryBlood', analyte: 'racemicBhb', meter: 'a' }));
  });
});

describe('personal correction: at most one identifiable concentration scale (D2-08)', () => {
  const flat = { hourlyMean: new Float64Array(48).fill(1), endpoint: new Float64Array(48).fill(1), initial: 1 };
  const obs = (id: string, hour: number, value: number, extra: Partial<KetoneObservation> = {}): KetoneObservation => ({ id, value, unit: 'mmol/L', specimen: 'capillaryBlood', analyte: 'dBhb', time: { kind: 'instant', hour }, meter: 'm1', context: 'fasting', ...extra });
  const pairs = (os: KetoneObservation[]) => os.map((o) => ({ observation: o, prediction: predictKetoneReading(o, flat) }));

  it('a single measured point fits nothing (an offset cannot be separated from noise, let alone three kinetic mechanisms)', () => {
    const [c] = fitKetoneCorrection(pairs([obs('a', 5, 1.3)]));
    expect(c!.status).toBe('insufficient');
    expect(c!.logScale).toBeUndefined();
  });
  it('repeated context-matched readings give one log scale with its standard error and no kinetic parameter', () => {
    const [c] = fitKetoneCorrection(pairs([obs('a', 5, 1.2), obs('b', 9, 1.25), obs('c', 30, 1.15)]));
    expect(c!.status).toBe('estimated');
    expect(c!.logScale).toBeCloseTo((Math.log(1.2) + Math.log(1.25) + Math.log(1.15)) / 3, 12);
    expect(c!.se).toBeGreaterThan(0);
    expect(c!.coverage).toBe('unvalidated');
    const keys = Object.keys(c!).sort();
    expect(keys).toEqual(['coverage', 'key', 'logScale', 'n', 'se', 'status']);
  });
  it('conflicting context groups are shown as a structural discrepancy, not forced into one correction (no sex/age multiplier)', () => {
    const [c] = fitKetoneCorrection(pairs([obs('a', 5, 2.0, { context: 'ketogenicDiet' }), obs('b', 9, 2.05, { context: 'ketogenicDiet' }), obs('c', 30, 0.5), obs('d', 31, 0.52)]));
    expect(c!.status).toBe('discrepant');
    expect(c!.logScale).toBeUndefined();
    expect(c!.groups!.map((g) => g.context).sort()).toEqual(['fasting', 'ketogenicDiet']);
    // consistent groups pool into the one scale
    const [ok] = fitKetoneCorrection(pairs([obs('a', 5, 1.2, { context: 'ketogenicDiet' }), obs('b', 9, 1.22, { context: 'ketogenicDiet' }), obs('c', 30, 1.19), obs('d', 31, 1.21)]));
    expect(ok!.status).toBe('estimated');
  });
  it('different meters are corrected separately; untimed and urine readings never enter', () => {
    const cs = fitKetoneCorrection(
      pairs([obs('a', 5, 1.2), obs('b', 9, 1.25), obs('c', 5, 0.8, { meter: 'm2' }), obs('d', 9, 0.82, { meter: 'm2' }), obs('e', 0, 3, { time: { kind: 'unknown', day: 0 } }), obs('f', 6, 3, { specimen: 'urine' })]),
    );
    expect(cs.length).toBe(2);
    const m1 = cs.find((c) => c.key.endsWith('|m1'))!;
    const m2 = cs.find((c) => c.key.endsWith('|m2'))!;
    expect(m1.logScale!).toBeGreaterThan(0);
    expect(m2.logScale!).toBeLessThan(0);
    expect(m1.n + m2.n).toBe(4);
  });
});

describe('ketone model states never clear safety restrictions (D2-08)', () => {
  it('no safety or wellbeing rule reads the latent adaptation states as a clearance, and ketone alerts read total BHB', () => {
    const safety = MODULES.find((m) => m.id === 'safety')!;
    expect(safety.reads).not.toContain('ketoAdaptFast');
    expect(safety.reads).not.toContain('ketoAdaptSlow');
    expect(safety.reads).toContain('bhbMmolL');
    expect(safety.reads).not.toContain('bhbEndoMmolL'); // exogenous ketones are never subtracted out of a safety reading
  });
});
