// @vitest-environment node
/** D3-07/C7: one exercise energy ledger — the shared bout-cost resolver and the step-ledger overlap rules. */
import { exerciseIncrementalKcal, exerciseNetAboveRestKcal } from '@/lib/bodyContracts';
import { boutCost, reconcileBoutMinutes, standardMetGrossKcal, stepLedgerSteps, stepsAboveHabitual, stepsOverlapStatus, sumBoutCosts } from '../exerciseCost';

describe('shared bout-cost resolver (D3-07)', () => {
  it('names gross, own rest, net above rest, displaced lifestyle and incremental separately; net matches the contract helper', () => {
    for (const [rmr, kg, min, met] of [[1400, 55, 30, 6], [1800, 80, 45, 8], [2200, 110, 60, 3.5]] as const) {
      const gross = standardMetGrossKcal(met, kg, min);
      const c = boutCost({ grossKcal: gross, durationMin: min, rmrKcalPerDay: rmr, displacedFracOfRmr: 0.2, method: 'compendiumMet', source: 'derived' });
      expect(c.ownRestKcal).toBeCloseTo((rmr * min) / 1440, 9);
      expect(c.netAboveRestKcal).toBeCloseTo(exerciseNetAboveRestKcal(gross, rmr, min)!, 9);
      expect(c.incrementalKcal).toBeCloseTo(exerciseIncrementalKcal(c.netAboveRestKcal, c.displacedLifestyleKcal)!, 9);
      expect(c.grossKcal).toBeGreaterThan(c.netAboveRestKcal);
    }
  });

  it('incremental may be negative (a bout replacing costlier activity) and unknown displacement stays unknown', () => {
    const light = boutCost({ grossKcal: 40, durationMin: 30, rmrKcalPerDay: 1600, displacedFracOfRmr: 1.5, method: 'compendiumMet', source: 'derived' });
    expect(light.incrementalKcal!).toBeLessThan(0);
    const unk = boutCost({ grossKcal: 300, durationMin: 30, rmrKcalPerDay: 1600, displacedFracOfRmr: null, method: 'device', source: 'measured' });
    expect(unk.displacedLifestyleKcal).toBeNull();
    expect(unk.incrementalKcal).toBeNull();
    expect(sumBoutCosts([light, unk]).incrementalKcal).toBeNull();
  });

  it('non-finite inputs give zero terms, never NaN; recovery is carried, never folded into net', () => {
    const c = boutCost({ grossKcal: Number.NaN, durationMin: -5, rmrKcalPerDay: null, bodyMassKg: 70, displacedFracOfRmr: 0.2, method: 'unknown', source: 'legacyUnknown', recoveryKcal: 12 });
    expect([c.grossKcal, c.ownRestKcal, c.netAboveRestKcal].every((x) => x === 0)).toBe(true);
    expect(c.recoveryKcal).toBe(12);
  });
});

describe('step ledger overlap (D3-07)', () => {
  it('total-day steps + session steps and excludes-training steps give the same ledger when the overlap is known', () => {
    expect(stepLedgerSteps(11000, 'totalDay', 4000)).toBe(stepLedgerSteps(7000, 'excludesTraining', 4000));
    expect(stepLedgerSteps(7000, 'excludesTraining', 4000)).toBe(7000); // an excluding count is never reduced
    expect(stepLedgerSteps(7000, undefined, 4000)).toBe(7000); // legacy unknown scope: a scenario, nothing subtracted
    expect(stepsOverlapStatus(undefined, undefined, true)).toBe('unknown');
    expect(stepsOverlapStatus('totalDay', 4000, true)).toBe('known');
  });

  it('the habitual reference uses the same rule, so already-habitual walking logged as a session is not counted twice', () => {
    expect(stepsAboveHabitual({ steps: 9000, scope: 'totalDay', includedSteps: 2000 }, { steps: 9000, scope: 'totalDay', includedSteps: 2000 })).toBe(0);
  });

  it('the same physical bout described by a session and a commute counts once', () => {
    const r = reconcileBoutMinutes([
      { id: 'walk:1', durationMin: 30, source: 'session', startMin: 480, endMin: 510 },
      { id: 'walk:1', durationMin: 30, source: 'commute' },
      { durationMin: 20, source: 'recreation', startMin: 500, endMin: 520 },
    ]);
    expect(r.physicalMin).toBe(40);
    expect(r.duplicateMin).toBe(40);
  });
});
