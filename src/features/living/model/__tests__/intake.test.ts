/**
 * intakeModel (r071 0B): one model of what was eaten against the day's targets, behind Today's "Eaten so far" and Food's
 * Targets. It must agree with the figures Today already shows (`intakeFigures`), with TargetsFace's own lag and status
 * rules, never turn "unknown" into 0, and say a lower bound is a lower bound.
 */
import { describe, expect, it } from 'vitest';
import type { ChannelCoverage, ChannelCoverageMap, ExposureChannel } from '@/lib/bodyContracts';
import { dayFoodStatus, macroLags } from '../../food/components/TargetsFace';
import { likely } from '../../format';
import { INTAKE_UNKNOWN_TEXT, intakeFigures } from '../../today/model';
import { INTAKE_WHY_TEXT, coverageLags, intakeModel, intakeStatus, type IntakeRx, type IntakeView } from '../intake';

const est = (value: number, sd = 0) => ({ value, sd });
interface Day {
  kcal?: [number, number?];
  protein?: [number, number?];
  carbs?: [number, number?];
  fat?: [number, number?];
  fibre?: [number, number?];
  meal?: boolean;
  coverage?: ChannelCoverageMap;
  intake?: 'complete' | 'partial' | 'none';
}
const view = (d: Day = {}): IntakeView =>
  ({
    logged: {
      entries: d.meal === false ? [] : [{ kind: 'meal' }],
      totals: {
        energyKcal: est(...(d.kcal ?? [0])),
        proteinG: est(...(d.protein ?? [0])),
        carbG: est(...(d.carbs ?? [0])),
        fatG: est(...(d.fat ?? [0])),
        fibreG: est(...(d.fibre ?? [0])),
      },
    },
    coverage: d.coverage,
    intake: d.intake,
  }) as unknown as IntakeView;
const RX: IntakeRx = { energyKcal: 2050, macros: { proteinG: 150, carbG: 200, fatG: 70, fibreG: 30 } };

describe('the figures agree with what Today already shows', () => {
  const cases: Array<[string, Day]> = [
    ['nothing logged', { meal: false }],
    ['a meal with energy and protein, no coverage map', { kcal: [750], protein: [32] }],
    ['energy complete, protein partial and known', { kcal: [750], protein: [32], coverage: { energy: 'complete', protein: 'partial' } }],
    ['energy complete, protein partial and zero', { kcal: [750], protein: [0], coverage: { energy: 'complete', protein: 'partial' } }],
    ['protein confirmed zero', { kcal: [750], protein: [0], coverage: { energy: 'complete', protein: 'confirmedZero' } }],
    ['energy confirmed zero (a reported no-intake day)', { kcal: [0], protein: [0], meal: false, coverage: { energy: 'confirmedZero', protein: 'confirmedZero' } }],
    ['a meal logged as energy only', { kcal: [500], protein: [0] }],
  ];
  for (const [name, d] of cases) {
    it(name, () => {
      const fig = intakeFigures(view(d));
      const m = intakeModel(view(d), RX);
      const eq = (f: ReturnType<typeof intakeFigures>['eaten'], c: typeof m.energy) => {
        if (f.kind === 'unknown') {
          expect(c.value).toBeNull();
          expect(c.state).toBe('unknown');
          expect(c.why).toBe(f.why);
        } else {
          expect(c.value).toBe(f.value);
          expect(c.state).toBe(f.kind === 'atLeast' ? 'atLeast' : c.state);
        }
      };
      eq(fig.eaten, m.energy);
      eq(fig.protein, m.protein);
    });
  }

  it('its unknown words are Today’s', () => {
    expect(INTAKE_WHY_TEXT).toEqual(INTAKE_UNKNOWN_TEXT);
  });
});

describe('the lag and the status are TargetsFace’s own rules', () => {
  const levels: Array<ChannelCoverage | undefined> = [undefined, 'unknown', 'partial', 'asPlannedEstimate', 'complete', 'confirmedZero'];
  it('coverageLags equals macroLags for every pair of coverages', () => {
    for (const energy of levels)
      for (const ch of ['protein', 'carbohydrate', 'fat', 'fibre'] as ExposureChannel[])
        for (const c of levels) {
          const cov = { ...(energy ? { energy } : {}), ...(c ? { [ch]: c } : {}) } as ChannelCoverageMap;
          expect(coverageLags(cov, ch), `${energy}/${c}`).toBe(macroLags(cov, ch));
        }
    expect(coverageLags(undefined, 'protein')).toBe(false);
    expect(coverageLags(null, 'protein')).toBe(false);
  });
  it('intakeStatus equals dayFoodStatus', () => {
    for (const logged of [false, true]) for (const a of [undefined, null, 'complete', 'partial', 'none'] as const) expect(intakeStatus(logged, a), `${logged}/${a}`).toBe(dayFoodStatus(logged, a));
  });
});

describe('unknown is never zero', () => {
  it('nothing logged: every channel is unknown with its reason, no ratio, not over', () => {
    const m = intakeModel(view({ meal: false }), RX);
    expect(m.logged).toBe(false);
    expect(m.status).toBe('Not logged');
    for (const c of m.channels) {
      expect(c.value, c.id).toBeNull();
      expect(c.state, c.id).toBe('unknown');
      expect(c.why, c.id).toBe('nothingLogged');
      expect(c.ratio, c.id).toBe(0);
      expect(c.over, c.id).toBe(false);
      expect(c.lo, c.id).toBeUndefined();
    }
    expect(m.left).toBeNull();
  });

  it('a meal with no fibre value leaves fibre unknown (not in the food), not 0', () => {
    const m = intakeModel(view({ kcal: [750], protein: [32], carbs: [80], fat: [20] }), RX);
    expect(m.fibre.value).toBeNull();
    expect(m.fibre.why).toBe('notInFood');
    expect(m.carbs.value).toBe(80);
  });

  it('fibre counts once a food gives it', () => {
    const m = intakeModel(view({ kcal: [750], fibre: [9, 2] }), RX);
    expect(m.fibre.value).toBe(9);
    expect(m.fibre.lo).toBeCloseTo(9 - 1.2816 * 2, 5);
  });
});

describe('what a channel carries', () => {
  it('protein is a floor, the rest are targets', () => {
    const m = intakeModel(view({ kcal: [750], protein: [32] }), RX);
    expect(m.channels.map((c) => [c.id, c.kind])).toEqual([['energy', 'target'], ['protein', 'floor'], ['carbs', 'target'], ['fat', 'target'], ['fibre', 'target']]);
    expect(m.channels.map((c) => c.label)).toEqual(['Energy', 'Protein', 'Carbs', 'Fat', 'Fibre']);
    expect(m.energy.target).toBe(2050);
    expect(m.protein.target).toBe(150);
    expect(m.carbs.target).toBe(200);
    expect(m.fat.target).toBe(70);
    expect(m.fibre.target).toBe(30);
  });

  it('the ratio is not capped, and over means past the target (a floor: past its minimum)', () => {
    const m = intakeModel(view({ kcal: [2450], protein: [180], carbs: [100] }), RX);
    expect(m.energy.ratio).toBeCloseTo(2450 / 2050, 6);
    expect(m.energy.over).toBe(true);
    expect(m.protein.ratio).toBeCloseTo(1.2, 6);
    expect(m.protein.over).toBe(true);
    expect(m.carbs.over).toBe(false);
    expect(m.carbs.ratio).toBeCloseTo(0.5, 6);
  });

  it('an estimate carries its likely range (80 %), an exact entry does not', () => {
    const m = intakeModel(view({ kcal: [750, 90], protein: [32, 0] }), RX);
    const l = likely(750, 90);
    expect(m.energy.lo).toBeCloseTo(l.lo, 6);
    expect(m.energy.hi).toBeCloseTo(l.hi, 6);
    expect(m.protein.lo).toBeUndefined();
    expect(m.protein.hi).toBeUndefined();
  });

  it('a lower bound is atLeast; a macro lagging energy is partial, never both', () => {
    const lower = intakeModel(view({ kcal: [750], protein: [32], coverage: { energy: 'complete', protein: 'partial' } }), RX);
    expect(lower.protein.state).toBe('atLeast');
    const lag = intakeModel(view({ kcal: [750], carbs: [60], fat: [18], coverage: { energy: 'asPlannedEstimate', carbohydrate: 'partial', fat: 'unknown' } }), RX);
    expect(lag.carbs.state).toBe('partial');
    expect(lag.fat.state).toBe('partial');
    expect(lag.energy.state).toBe('value');
    const plain = intakeModel(view({ kcal: [750], carbs: [60] }), RX);
    expect(plain.carbs.state).toBe('value');
  });

  it('what is left, or how far over; the day status follows the person’s report', () => {
    expect(intakeModel(view({ kcal: [750] }), RX).left).toEqual({ amount: 1300, over: false, unit: 'kcal' });
    expect(intakeModel(view({ kcal: [2250] }), RX).left).toEqual({ amount: 200, over: true, unit: 'kcal' });
    expect(intakeModel(view({ kcal: [750] }), RX).status).toBe('Partial');
    expect(intakeModel(view({ kcal: [750], intake: 'complete' }), RX).status).toBe('Complete');
    expect(intakeModel(view({ meal: false, intake: 'none' }), RX).status).toBe('No intake');
  });

  it('without a plan there are no targets, no ratio and no left', () => {
    const m = intakeModel(view({ kcal: [750] }), null);
    expect(m.hasTargets).toBe(false);
    expect(m.energy.target).toBe(0);
    expect(m.energy.ratio).toBe(0);
    expect(m.energy.over).toBe(false);
    expect(m.left).toBeNull();
    expect(intakeModel(view({ kcal: [0] }), { ...RX, energyKcal: 0 }).hasTargets).toBe(false);
  });
});

describe('energy in the person’s unit', () => {
  it('kJ scales the figures, the range and the target; the ratio does not change', () => {
    const kcal = intakeModel(view({ kcal: [750, 90] }), RX);
    const kj = intakeModel(view({ kcal: [750, 90] }), RX, { energyUnit: 'kJ' });
    expect(kj.energy.unit).toBe('kJ');
    expect(kj.energy.value).toBeCloseTo(750 * 4.184, 3);
    expect(kj.energy.target).toBeCloseTo(2050 * 4.184, 3);
    expect(kj.energy.lo).toBeCloseTo(kcal.energy.lo! * 4.184, 3);
    expect(kj.energy.ratio).toBeCloseTo(kcal.energy.ratio, 9);
    expect(kj.protein.unit).toBe('g');
    expect(kj.left?.unit).toBe('kJ');
  });
});
