// @vitest-environment node
/**
 * D2-02: the Autophagy Signal Index is a retained legacy research index, not a health objective. These checks pin the
 * provider side of that contract (the cellular module, its labels and parameter metadata, and the shared C6 registry it
 * relies on): no goal or benefit route can read the index, mTORC1/AMPK stay non-optimizable, nothing is labelled as
 * measured flux, percent autophagy, longevity gain or predictive coverage, and the 0-100 anchors are definitions.
 */
import { bandMetaFor, capabilityAllowsOptimization, STATUS_LABEL } from '@/lib/bodyContracts';
import { GOAL_CAPABILITY, isProductionGoalEligible, SERIES, SERIES_INDEX } from '../../types/metrics';
import { SIGNAL_DEFS, SIGNAL_META } from '../../types/signals';
import { ASI_BANDS, ASI_DISPLAY_STATUS, ASI_RESEARCH_INDEX, asiLabel, CELLULAR_CAUSAL_RESOLUTION, CELLULAR_PARAMS, cellularModule } from './index';
import { makeRig, stepOnce } from './testkit';

const OVERCLAIM = /\bflux\b|longevity|life ?span|% ?autophagy|autophagy ?%|percent autophagy|probability|healthspan/i;

describe('D2-02 — no objective, benefit or adoption route for the ASI', () => {
  it('autophagyIdx is not a production goal and its capability forbids optimization', () => {
    const c = GOAL_CAPABILITY.autophagyIdx;
    expect(c.availability).toBe('unavailable');
    expect(capabilityAllowsOptimization(c)).toBe(false);
    expect(c.objectives).toEqual([]);
    expect(c.estimand).toMatch(/research index/);
    expect(c.estimand).toMatch(/no flux/);
    expect(isProductionGoalEligible('autophagyIdx')).toBe(false);
  });

  it('mTORC1 and AMPK stay non-optimizable display views (goal none)', () => {
    for (const id of ['mtorIdx', 'ampkIdx'] as const) {
      expect(SERIES[SERIES_INDEX[id]]!.goal).toBe('none');
      expect(capabilityAllowsOptimization(GOAL_CAPABILITY[id])).toBe(false);
      expect(isProductionGoalEligible(id)).toBe(false);
    }
  });

  it('the index feeds nothing: cellular writes only asiIdx, and asiIdx has no reader (no physiology, safety or benefit edge)', () => {
    expect(cellularModule.writes).toEqual(['asiIdx']);
    const def = SIGNAL_DEFS.find((d) => d.name === 'asiIdx')!;
    expect(def.readers).toEqual([]);
    expect(SIGNAL_META.asiIdx?.status).toBe('exploratory');
  });

  it('protein reduction moves the legacy index by definition but earns no cellular benefit anywhere', () => {
    const run = (raAaQGH: number, insulin: number): number => {
      const rig = makeRig();
      rig.bus.insulinBasalUuMl = 7;
      rig.bus.hoursSinceMealH = 3;
      rig.bus.raAaQGH = raAaQGH;
      rig.bus.insulinUuMl = insulin;
      stepOnce(rig, 12);
      return rig.s.asi;
    };
    // less protein appearance → higher index value (the 08 §4.3 definition) …
    expect(run(1, 9)).toBeGreaterThan(run(8, 20));
    // … which no goal, objective or reader can turn into credit
    expect(isProductionGoalEligible('autophagyIdx')).toBe(false);
    expect(SIGNAL_DEFS.find((d) => d.name === 'asiIdx')!.readers).toEqual([]);
  });
});

describe('D2-02 — research index distinct from flux; no probability-looking band', () => {
  it('declares the retained index as an exploratory, unit-index research display without flux or coverage', () => {
    expect(ASI_RESEARCH_INDEX).toMatchObject({
      unit: 'index',
      range: [0, 100],
      status: 'exploratory',
      healthObjective: false,
      fluxEstimate: false,
      uncertaintyKind: 'parameterSensitivity',
      predictiveCoverage: false,
      anchors: 'definitional',
    });
    expect(ASI_DISPLAY_STATUS).toBe('exploratory');
    expect(STATUS_LABEL[ASI_DISPLAY_STATUS]).toBe('Exploratory');
  });

  it('the series is an index with an unvalidated parameter-sensitivity band, never a calibrated prediction', () => {
    const d = SERIES[SERIES_INDEX.autophagyIdx]!;
    expect(d.unit).toBe('index');
    const band = bandMetaFor('draws', 16);
    expect(band.uncertaintyKind).toBe('parameterSensitivity');
    expect(band.coverage).toBe('unvalidated');
  });

  it('parameter draws are index sensitivity: no calibrated prediction, no %-autophagy unit, no flux/longevity label', () => {
    for (const p of CELLULAR_PARAMS) {
      expect(p.distribution, p.id).toBeDefined();
      expect(p.distribution!.uncertaintyKind, p.id).not.toBe('calibratedPrediction');
      expect(['parameterSensitivity', 'heuristic'], p.id).toContain(p.distribution!.uncertaintyKind);
      expect(p.distribution!.nominal, p.id).toBe('designPoint');
      expect(p.unit, p.id).not.toMatch(/%/);
      expect(p.label ?? '', p.id).not.toMatch(OVERCLAIM);
      expect(p.distribution!.basis, p.id).toMatch(/not (an autophagic-flux|a tissue measurement)/);
    }
  });

  it('the 12-h anchor is a scale definition, not a source-checked measurement (code regression, not validation)', () => {
    const a = CELLULAR_PARAMS.find((p) => p.id === 'cellular.asiRef12')!;
    expect(a.value).toBe(25);
    expect(a.status).not.toBe('verified');
    expect(a.distribution!.label).toBe('designPrior');
    expect(a.note).toMatch(/code regressions, not validation/);
  });

  it('the indices declare daily resolution in an observed replay (upstream daily-native reads, C2)', () => {
    const d = CELLULAR_CAUSAL_RESOLUTION;
    expect(d.nativeResolution).toBe('daily');
    expect([...d.series].sort()).toEqual([...cellularModule.records].sort());
    expect(d.signals).toEqual(cellularModule.writes);
    for (const n of d.upstreamDailySignals) expect(cellularModule.reads as readonly string[]).toContain(n);
    expect(d.planMetadataReads).toEqual([]);
  });

  it('legacy band names remain only as a versioned research display (historical reproduction)', () => {
    expect(ASI_RESEARCH_INDEX.version).toBe(1);
    expect(ASI_BANDS.map((b) => b.from)).toEqual([0, 15, 30, 50, 75]);
    expect(asiLabel(60)).toBe('prolonged fast');
  });
});
