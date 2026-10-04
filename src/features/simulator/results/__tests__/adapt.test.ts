import '@/features/charts/test/setupDom';
import { describe, expect, it } from 'vitest';
import { buildResultsData, engineBaseline, fallbackBand, ketosisStateTrack, presentValue, scaleBreakdown, compositionTracks } from '../lib/adapt';
import { eventsForChart } from '../lib/events';
import { CORE_METRIC_IDS, convertUnit, displayCatalogue, resolveMetricId, toDisplayMetric } from '../lib/metrics';
import { phaseTone, schedulePhases } from '../lib/schedule';
import { seriesDef } from '@/engine/types/metrics';
import { DAYS, SCHEDULE, engineResult, resolved } from './fixture';

const result = engineResult();
const { compiled } = resolved();
const adapted = buildResultsData({ result, schedule: SCHEDULE, compiled });
const byId = new Map(adapted.data.series.map((s) => [s.id, s]));

describe('display catalogue', () => {
  it('lists the chartable outcome metrics and resolves the core set', () => {
    const cat = displayCatalogue();
    expect(cat.length).toBeGreaterThan(40);
    expect(cat.every((m) => m.presentation !== 'state')).toBe(true);
    for (const id of CORE_METRIC_IDS) expect(cat.some((m) => m.id === id)).toBe(true);
  });

  it('maps presentation modes to units and overlay rules', () => {
    const ldl = toDisplayMetric(seriesDef('ldl'));
    expect(ldl.presentation).toBe('deltaFromBaseline');
    expect(ldl.unit).toBe('mmol/L vs start');
    expect(ldl.relativeNote).toBe('relative to your baseline');
    expect(ldl.overlay).toBe('none');
    const leptin = toDisplayMetric(seriesDef('leptin'));
    expect(leptin.unit).toBe('% vs start');
    expect(leptin.overlay).toBe('pts');
    const hunger = toDisplayMetric(seriesDef('hunger'));
    expect(hunger.presentation).toBe('index');
    expect(hunger.lane).toBe('index');
    const bhb = toDisplayMetric(seriesDef('bhb'));
    expect(bhb.overlay).toBe('none');
    expect(bhb.overlayNote).toMatch(/ten-fold/);
    expect(bhb.thresholds?.map((t) => t.label)).toEqual(['nutritional ketosis', 'deep ketosis']);
    expect(toDisplayMetric(seriesDef('ketoInduction')).scale100).toBe(true);
  });

  it('converts units for the user', () => {
    const prefs = { units: 'imperial', energyUnit: 'kJ', glucoseUnit: 'mgdl' } as const;
    expect(convertUnit('fatMass', 'kg', prefs).unit).toBe('lb');
    expect(convertUnit('waist', 'cm', prefs).unit).toBe('in');
    expect(convertUnit('tdee', 'kcal/d', prefs).unit).toBe('kJ/d');
    expect(convertUnit('glucose', 'mmol/L', prefs).unit).toBe('mg/dL');
    expect(convertUnit('ldl', 'mmol/L', prefs).unit).toBe('mmol/L');
    expect(toDisplayMetric(seriesDef('fastingGlucose'), prefs).unit).toBe('mg/dL vs start');
  });

  it('resolves loose metric ids', () => {
    expect(resolveMetricId('fat_mass')).toBe('fatMass');
    expect(resolveMetricId('FAT-MASS')).toBe('fatMass');
    expect(resolveMetricId('bogus')).toBeNull();
    expect(resolveMetricId(null)).toBeNull();
  });
});

describe('result → chart data', () => {
  it('keeps the time base and every recorded channel, in catalogue order', () => {
    expect(adapted.data.time).toEqual({ days: DAYS, startDate: '2026-10-05' });
    for (const id of ['fatMass', 'leanTissue', 'scaleWeight', 'waist', 'bhb', 'hunger', 'tdee', 'ldl', 'autophagyIdx']) expect(byId.has(id)).toBe(true);
    // sex-gated metric for a man: NaN everywhere → left out
    expect(byId.has('menstrualRisk')).toBe(false);
    for (const s of adapted.data.series) {
      expect(s.daily.values).toHaveLength(DAYS);
      if (s.hourly) expect(s.hourly.values).toHaveLength(DAYS * 24);
    }
  });

  it('absolute metrics carry engine values and the value before day 1', () => {
    const fat = byId.get('fatMass')!;
    expect(fat.unit).toBe('kg');
    expect(fat.daily.values[5]).toBeCloseTo(result.daily.fatMass![5]!, 5);
    expect(fat.baseline).toBeCloseTo(result.initial.fatMass!, 5);
    // hourly-mean metrics use the first day, not the instantaneous t = 0 value
    expect(engineBaseline(result, 'tdee', 'sum')).toBe(result.daily.tdee![0]);
  });

  it('change-from-baseline metrics start at zero in their unit or in % for relative markers', () => {
    const ldl = byId.get('ldl')!;
    const b = engineBaseline(result, 'ldl', 'end');
    expect(ldl.unit).toBe('mmol/L vs start');
    expect(ldl.baseline).toBe(0);
    expect(ldl.daily.values[DAYS - 1]).toBeCloseTo(result.daily.ldl![DAYS - 1]! - b, 5);
    const leptin = byId.get('leptin')!;
    const lb = engineBaseline(result, 'leptin', 'end');
    expect(leptin.unit).toBe('% vs start');
    expect(leptin.daily.values[3]).toBeCloseTo(100 * (result.daily.leptin![3]! / lb - 1), 3);
    expect(presentValue({ presentation: 'deltaFromBaseline', engineUnit: 'rel', factor: 100 }, 1.1, 1)).toBeCloseTo(10, 6);
  });

  it('index metrics use the 0–100 lane unless values exceed it', () => {
    expect(byId.get('hunger')!.kind).toBe('index');
    expect(byId.get('autophagyIdx')!.kind).toBe('index');
    const mps = byId.get('mps');
    if (mps && Math.max(...mps.daily.values) > 100.5) expect(mps.kind).toBe('line');
  });

  it('falls back to the catalogue band before the ensemble arrives, then uses the draws', () => {
    const fat = byId.get('fatMass')!;
    expect(adapted.bandSource.get('fatMass')).toBe('fallback');
    const v = result.daily.fatMass!;
    const base = result.initial.fatMass!;
    const half = Math.abs(v[DAYS - 1]! - base) * 0.35;
    expect(fat.daily.band!.hi[DAYS - 1]! - fat.daily.band!.lo[DAYS - 1]!).toBeCloseTo(2 * half, 4);
    const fb = fallbackBand(new Float32Array([10, 12]), 10, { kind: 'value', pct: 10 });
    expect(Array.from(fb.lo)).toEqual([9, expect.closeTo(10.8, 5)]);

    const p10 = { fatMass: v.map((x) => x - 0.5), ldl: result.daily.ldl!.map((x) => x - 0.1) };
    const p90 = { fatMass: v.map((x) => x + 0.5), ldl: result.daily.ldl!.map((x) => x + 0.1) };
    const withDraws = buildResultsData({ result, bands: { p10, p90, draws: 8, total: 32 }, schedule: SCHEDULE, compiled });
    expect(withDraws.bandSource.get('fatMass')).toBe('draws');
    const f2 = withDraws.data.series.find((s) => s.id === 'fatMass')!;
    expect(f2.daily.band!.lo[4]).toBeCloseTo(v[4]! - 0.5, 4);
    // delta-from-baseline bands are shifted like the line
    const l2 = withDraws.data.series.find((s) => s.id === 'ldl')!;
    for (let i = 0; i < DAYS; i++) {
      expect(l2.daily.band!.lo[i]!).toBeLessThanOrEqual(l2.daily.values[i]! + 1e-6);
      expect(l2.daily.band!.hi[i]!).toBeGreaterThanOrEqual(l2.daily.values[i]! - 1e-6);
    }
    // catalogue says "no band": draws are ignored
    expect(withDraws.bandSource.get('micronutrientScore') ?? 'none').toBe('none');
  });

  it('hourly tracks borrow the day band half-widths', () => {
    const bhb = byId.get('bhb')!;
    expect(bhb.hourly?.band).toBeDefined();
    const h = 5 * 24 + 7;
    const d = 5;
    expect(bhb.hourly!.values[h]! - bhb.hourly!.band!.lo[h]!).toBeCloseTo(bhb.daily.values[d]! - bhb.daily.band!.lo[d]!, 4);
  });

  it('converts to imperial units without touching the engine arrays', () => {
    const imp = buildResultsData({ result, schedule: SCHEDULE, compiled }, { units: 'imperial', energyUnit: 'kJ', glucoseUnit: 'mmol' });
    const fat = imp.data.series.find((s) => s.id === 'fatMass')!;
    expect(fat.unit).toBe('lb');
    expect(fat.daily.values[0]).toBeCloseTo(result.daily.fatMass![0]! * 2.2046226218, 3);
    expect(imp.data.series.find((s) => s.id === 'rmr')!.unit).toBe('kJ/d');
    expect(result.daily.fatMass![0]).toBeLessThan(40);
  });

  it('adds the TDEE stack (components sum to the total) and the decomposition tracks', () => {
    const tdee = byId.get('tdee')!;
    expect(tdee.kind).toBe('stacked-area');
    const comps = tdee.stack!.components;
    expect(comps.map((c) => c.id)).toEqual(['resting', 'tef', 'neat', 'exercise']);
    for (const d of [0, 7, DAYS - 1]) {
      const sum = comps.reduce((a, c) => a + c.daily[d]!, 0);
      expect(sum).toBeCloseTo(tdee.daily.values[d]!, 0);
    }
    expect(tdee.stack!.counterfactual?.label).toBe('without adaptation');
    const c = adapted.data.composition!;
    expect(c.fat).toHaveLength(DAYS);
    expect(c.water).toHaveLength(DAYS);
    const comp = compositionTracks(result)!;
    expect(comp.water[9]).toBeCloseTo((result.daily.ecfShift![9] ?? 0) + (result.daily.gutContent![9] ?? 0), 5);
    const sb = scaleBreakdown(result)!;
    expect(Object.keys(sb).sort()).toEqual(['fat', 'fluid', 'glycogen', 'gut', 'lean', 'scale', 'unit']);
    expect(Number.isFinite(sb.scale)).toBe(true);
  });

  it('builds the ketosis band, events and safety flags', () => {
    const ks = ketosisStateTrack(result)!;
    expect(ks.levels).toEqual(['none', 'forming', 'nutritional', 'deep']);
    expect(ks.daily).toHaveLength(DAYS);
    expect(Math.max(...ks.daily)).toBeLessThanOrEqual(3);
    expect(ks.hourly).toHaveLength(DAYS * 24);
    expect(adapted.data.states?.[0]?.id).toBe('ketosis');
    const ev = adapted.data.events ?? [];
    expect(ev.every((e) => e.day >= 0 && e.day < DAYS)).toBe(true);
    const mapped = eventsForChart(
      [
        { type: 'ketosisEntered', hour: 30, day: 1, value: 0.6 },
        { type: 'ketosisEntered', hour: 33, day: 1, value: 0.6 },
        { type: 'liverGlycogenLow', hour: 40, day: 1, value: 18 },
        { type: 'fastStart', hour: 72, day: 3, value: 4 },
      ],
      [
        { id: 'W-E03', severity: 'caution', startDay: 3, endDay: 9, peakValue: 31, message: 'Your deficit is 31% of maintenance.', src: '' },
        { id: 'W-U01', severity: 'info', startDay: 0, endDay: 20, peakValue: 0, message: 'Projection for an average person.', src: '' },
      ],
      DAYS,
    );
    expect(mapped.map((e) => e.type)).toEqual(['ketosis-entered', 'fast-start', 'safety']);
    expect(mapped[2]).toMatchObject({ severity: 'caution', label: 'Your deficit reaches 31 % of maintenance' });
  });

  it('builds phases from the schedule blocks and the intake lane from the realised inputs', () => {
    const ph = adapted.data.phases!;
    expect(ph.map((p) => [p.startDay, p.endDay, p.label])).toEqual([
      [0, 14, 'fat-loss base'],
      [14, DAYS, 'fasting block'],
    ]);
    expect(ph[1]!.shortLabel).toBe('fasting');
    expect(schedulePhases(null, result)).toEqual([]);
    const auto = schedulePhases({ ...SCHEDULE, blocks: undefined }, result);
    expect(auto.length).toBeGreaterThan(0);
    expect(auto[0]!.startDay).toBe(0);
    expect(auto[auto.length - 1]!.endDay).toBe(DAYS);
    expect(phaseTone(0)).toBe('fast');
    expect(phaseTone(0.8)).toBe('deficit-2');
    expect(phaseTone(1.0)).toBe('neutral');
    const intake = adapted.data.intake!;
    expect(intake.grams.protein[3]).toBe(0); // the water-only fast day
    expect(intake.grams.protein[0]).toBeGreaterThan(0);
    expect(intake.maintenance).toBe(result.daily.maintenance);
    expect(intake.meals!.filter((m) => m.day === 0)).toHaveLength(2);
    expect(intake.meals!.some((m) => m.day === 3)).toBe(false);
    // the eating window matches the program (12:00 + 8 h → 12:00–20:00), not "last meal + 30 min" (QA: day view said 12:13)
    const w0 = intake.eatingWindows!.find((w) => w.day === 0)!;
    expect(w0.startHour).toBe(12);
    expect(w0.endHour).toBe(20);
    expect(intake.exercise!.some((s) => s.type === 'resistance')).toBe(true);
    expect(intake.sleep!.length).toBeGreaterThan(0);
  });
});
