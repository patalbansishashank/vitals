// @vitest-environment node
/**
 * D3-07 in the activity intake: commute cycling and recreation use the shared bout ledger (standard-MET gross, net of the
 * person's RMR) like catalogue items and engine sessions; the steps scope and the unresolved session overlap travel with
 * the terms; recreation keeps its identity so a planned session repeating it is not booked twice.
 */
import { resolveDose } from '@/catalogues';
import { SEED_CATALOGUE } from '@/content/catalogues';
import { boutCost, KCAL_PER_KG_H_PER_MET } from '../../../core/exerciseCost';
import type { ActivityBase } from '../../../types/profile';
import { ACTIVITY_INTAKE_K, activityTerms } from '../index';
import { intakeBoutNetKcal, recreationOverlap } from '../resolveActivity';

const BASE: ActivityBase = { weightKg: 90, rmr0Kcal: 1930, eat0Kcal: 0, tefFraction: 0.1, rmrRoute: 'equation' };

describe('D3-07 activity intake on the shared bout ledger', () => {
  it('recreation and cycling commute: standard-MET gross (1.05 kcal/kg/h per MET) net of own RMR, per day', () => {
    const t = activityTerms({ work: 'desk', commute: { mode: 'cycle', activeMinPerWorkday: 40 }, recreation: [{ label: 'Football', intensity: 'vigorous', minPerWeek: 90 }] }, BASE);
    const net = (met: number, min: number): number =>
      boutCost({ grossKcal: (met * KCAL_PER_KG_H_PER_MET * 90 * min) / 60, durationMin: min, rmrKcalPerDay: 1930, displacedFracOfRmr: null, method: 'compendiumMet', source: 'reported' }).netAboveRestKcal;
    expect(t.recreationKcal).toBeCloseTo(net(ACTIVITY_INTAKE_K.metSport.vigorous, 90) / 7, 9);
    expect(t.cycleKcal).toBeCloseTo(net(ACTIVITY_INTAKE_K.metCycle, 40 * 5) / 7, 9);
    expect(t.recreationEntries).toEqual([{ label: 'Football', minPerWeek: 90, kcalPerDay: t.recreationKcal }]);
  });

  it('the same activity costs the same in the intake and the catalogue (same body, RMR and gross MET)', () => {
    const ex = SEED_CATALOGUE.exercise('football')!;
    const d = resolveDose(ex, { exerciseId: 'football', minutes: 60 }, { bodyMassKg: 90, vo2max: 40, heightM: 1.8, rmrKcalPerDay: 1930 });
    expect(intakeBoutNetKcal(ex.energy.metGross, 60, 90, 1930)).toBeCloseTo(d.energy.netKcal, 9);
  });

  it('a planned session repeating a recreation entry (same identity) is reported for reconciliation, never double booked', () => {
    const t = activityTerms({ recreation: [{ label: 'Football', intensity: 'vigorous', minPerWeek: 90 }, { label: 'walks', intensity: 'light', minPerWeek: 120 }] }, BASE);
    const o = recreationOverlap(t, [' football ']);
    expect(o.labels).toEqual(['Football']);
    expect(o.minPerWeek).toBe(90);
    expect(o.kcalPerDay).toBeCloseTo(t.recreationEntries[0]!.kcalPerDay, 12);
    expect(recreationOverlap(t, ['cycling']).minPerWeek).toBe(0);
  });

  it('steps scope travels with the terms; habitual sessions inside a total-day count are an unresolved overlap scenario', () => {
    expect(activityTerms(undefined, BASE).stepsScope).toBe('unknown');
    expect(activityTerms(undefined, { ...BASE, eat0Kcal: 200 }, ACTIVITY_INTAKE_K, { stepsScope: 'totalDay' }).stepsSessionOverlap).toBe('unknown');
    expect(activityTerms(undefined, { ...BASE, eat0Kcal: 200 }, ACTIVITY_INTAKE_K, { stepsScope: 'excludesTraining' }).stepsSessionOverlap).toBe('none');
    expect(activityTerms(undefined, BASE, ACTIVITY_INTAKE_K, { stepsScope: 'totalDay' }).stepsSessionOverlap).toBe('none');
    // the step count itself is never changed by the scope
    expect(activityTerms(undefined, { ...BASE, typicalSteps: 9000 }, ACTIVITY_INTAKE_K, { stepsScope: 'totalDay' }).steps).toBe(9000);
  });
});
