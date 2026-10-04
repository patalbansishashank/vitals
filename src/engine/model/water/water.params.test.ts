// @vitest-environment node
import { validateParamDefs, buildModelParams, param } from '../../core/paramsRegistry';
import { SERIES } from '../../types/metrics';
import { SIGNAL_DEFS } from '../../types/signals';
import type { AnyEngineModule } from '../../types/module';
import { waterModule } from './index';
import { WATER_PARAMS } from './params';
import { makeRig } from './testKit';

const mod = waterModule as unknown as AnyEngineModule;

describe('water registry and wiring', () => {
  it('declares valid ParamDefs (unique, prefixed, low ≤ value ≤ high, source and dossier present)', () => {
    expect(validateParamDefs([mod])).toEqual([]);
    for (const p of WATER_PARAMS) {
      expect(p.id.startsWith('water.')).toBe(true);
      expect(p.unit.length).toBeGreaterThan(0);
      expect(p.status).toBeDefined();
    }
  });

  it('does not duplicate fuel-owned parameters (glycogen water h)', () => {
    expect(WATER_PARAMS.some((p) => /hGly|hWater/i.test(p.id))).toBe(false);
  });

  it('copies the spec §1.10 nominal values and ranges', () => {
    const mp = buildModelParams([mod]);
    const v = (id: string): number => param(mp, `water.${id}`);
    const rng = (id: string): [number, number] => {
      const d = WATER_PARAMS.find((p) => p.id === `water.${id}`)!;
      return [d.low, d.high];
    };
    expect([v('eMax'), ...rng('eMax')]).toEqual([0.6, 0.3, 1.0]);
    expect([v('cRefCna'), ...rng('cRefCna')]).toEqual([100, 50, 150]);
    expect([v('eFastL'), ...rng('eFastL')]).toEqual([1.3, 1.1, 1.5]);
    expect([v('ecfRefL'), v('ecfPerKgBw')]).toEqual([17, 0.2]);
    expect([v('tauDown'), ...rng('tauDown')]).toEqual([1.5, 1, 3]);
    expect([v('tauUp'), ...rng('tauUp')]).toEqual([0.7, 0.3, 1.5]);
    expect([v('tauNa'), ...rng('tauNa')]).toEqual([1.5, 0.5, 2]);
    expect([v('tauHab'), ...rng('tauHab')]).toEqual([5, 3, 10]);
    expect([v('hNa'), ...rng('hNa')]).toEqual([0.5, 0, 1]);
    expect([v('gutS0Male'), v('gutS0Female'), v('gutSlope')]).toEqual([162, 83, 5]);
    expect([v('gutTtrMale'), v('gutTtrFemale'), v('gutTauEmpty')]).toEqual([2.0, 3.0, 1.5]);
    expect([v('pvMlPerKg'), v('pvTau')]).toEqual([4.5, 2]);
    expect([v('cycleAmpKg'), ...rng('cycleAmpKg')]).toEqual([0.2, 0, 0.5]);
    expect([v('creatineWaterKg'), ...rng('creatineWaterKg')]).toEqual([0.9, 0.5, 1.5]);
    expect([v('hDefTau'), v('hDefFKidney'), v('hDefCapKg')]).toEqual([0.5, 0.6, 2.5]);
  });

  it('reads and writes exactly the signals the §4 table assigns to water', () => {
    const readers = SIGNAL_DEFS.filter((d) => (d.readers as readonly string[]).includes('water')).map((d) => d.name).sort();
    expect([...waterModule.reads].sort()).toEqual(readers);
    const writes = SIGNAL_DEFS.filter((d) => d.writer === 'water').map((d) => d.name).sort();
    expect([...waterModule.writes].sort()).toEqual(writes);
  });

  it('records only series owned by water', () => {
    for (const id of waterModule.records) {
      const def = SERIES.find((s) => s.id === id);
      expect(def, id).toBeDefined();
      expect(def!.owner).toBe('water');
    }
    const owned = SERIES.filter((s) => s.owner === 'water').map((s) => s.id).sort();
    expect([...waterModule.records].sort()).toEqual(owned);
  });

  it('takes h from fuel.hWater when fuel registers it and falls back to the spec value 3.0 otherwise', () => {
    const alone = makeRig();
    expect(alone.k.onePlusH).toBe(4);
    const withFuel = makeRig({
      extraParams: [{ id: 'fuel.hWater', value: 2.7, unit: 'g/g', low: 2, high: 4, grade: 'B', source: 'Fernández-Elías 2015 PMID 25911631', dossier: '04 §4.1' }],
    });
    expect(withFuel.k.onePlusH).toBeCloseTo(3.7, 12);
  });
});
