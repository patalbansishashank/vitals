import './setupDom';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatEnergy, KJ_PER_KCAL } from '@/components';
import { ChartController, type ViewState } from '../core/controller';
import type { DrawArgs } from '../core/draw';
import { energyModel, inputsModel } from '../core/inputModels';
import { stackedAreaModel } from '../core/models';
import { readChartTheme } from '../core/theme';
import { makeChartData } from '../fixtures';
import { energyBalance, energyUnitOf, intakeEnergy, intakeKcal } from '../lib/intake';
import { buildTable, tableToCSV } from '../lib/table';
import { unitWords } from '../lib/summary';
import { DayView } from '../components/DayView';
import { energyReadoutRow, intakeReadoutRow, LaneStack } from '../components/LaneStack';
import { TdeeStack } from '../components/TdeeStack';
import type { ChartSeries } from '../types';

const data = makeChartData({ days: 84 });
const intake = data.intake!;
const view = (x0: number, x1: number): ViewState => ({ x0, x1, res: 'daily', animating: false });
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
};

afterEach(() => cleanup());

/** The fixture's TDEE lane as the results adapter hands it over in kJ (values, stack and counterfactual × 4.184). */
function tdeeInKJ(): ChartSeries {
  const s = data.series.find((x) => x.id === 'tdee')!;
  const f = (a: Float32Array) => a.map((v) => v * KJ_PER_KCAL);
  return {
    ...s,
    unit: 'kJ/d',
    daily: { values: f(s.daily.values) },
    stack: {
      components: s.stack!.components.map((c) => ({ ...c, daily: f(c.daily) })),
      counterfactual: s.stack!.counterfactual && { ...s.stack!.counterfactual, daily: f(s.stack!.counterfactual.daily) },
    },
  };
}

describe('intake energy in the display unit', () => {
  it('kJ = kcal × 4.184 for macros, totals, maintenance and balance; kcal is the identity', () => {
    const kc = intakeKcal(intake);
    const kj = intakeEnergy(intake, 'kJ');
    const bal = energyBalance(intake);
    for (const d of [0, 20, 83]) {
      expect(kj.total[d]).toBeCloseTo(kc.total[d]! * KJ_PER_KCAL, 2);
      expect(kj.totalWithFibre[d]).toBeCloseTo(kc.totalWithFibre[d]! * KJ_PER_KCAL, 2);
      expect(kj.byMacro.fat[d]).toBeCloseTo(kc.byMacro.fat[d]! * KJ_PER_KCAL, 2);
      expect(kj.maintenance[d]).toBeCloseTo(intake.maintenance[d]! * KJ_PER_KCAL, 2);
      expect(kj.balance[d]).toBeCloseTo(bal[d]! * KJ_PER_KCAL, 2);
    }
    const kcal = intakeEnergy(intake, 'kcal');
    expect(kcal.total).toBe(kc.total);
    expect(kcal.maintenance).toBe(intake.maintenance);
    expect(intakeEnergy(intake, 'kJ')).toBe(kj); // cached per unit
    expect(energyUnitOf('kJ/d')).toBe('kJ');
    expect(energyUnitOf('kcal/d')).toBe('kcal');
    expect(energyUnitOf('kg')).toBe('kcal');
  });

  it('the intake lane scales its energy axis (kcal mode) but not grams or % energy', () => {
    const v = view(0, 84);
    const o = { detail: false, tickColCss: 44 };
    const [, kcalMax] = inputsModel(intake, { ...o, mode: 'kcal' }).domain!(v);
    const [, kjMax] = inputsModel(intake, { ...o, mode: 'kcal', energyUnit: 'kJ' }).domain!(v);
    expect(kjMax).toBeCloseTo(kcalMax * KJ_PER_KCAL, 1);
    expect(inputsModel(intake, { ...o, mode: 'grams', energyUnit: 'kJ' }).domain!(v)).toEqual(inputsModel(intake, { ...o, mode: 'grams' }).domain!(v));
    expect(inputsModel(intake, { ...o, mode: 'pct', energyUnit: 'kJ' }).domain!(v)).toEqual([0, 100]);
  });

  it('the energy-balance lane scales its axis', () => {
    const v = view(0, 84);
    const [lo, hi] = energyModel(intake, { tickColCss: 44 }).domain!(v);
    const [loJ, hiJ] = energyModel(intake, { tickColCss: 44, energyUnit: 'kJ' }).domain!(v);
    expect(loJ).toBeCloseTo(lo * KJ_PER_KCAL, 1);
    expect(hiJ).toBeCloseTo(hi * KJ_PER_KCAL, 1);
  });

  it('crosshair readout rows print kJ values, labels and spoken units', () => {
    const t = 30.5;
    const kc = intakeKcal(intake);
    const bal = energyBalance(intake);
    const ir = intakeReadoutRow(data, 'kJ')!.value(t, 'daily');
    expect(ir.unit).toBe('kJ');
    expect(ir.value).toBe(formatEnergy(kc.total[30]!, 'kJ', { withUnit: false }));
    expect(ir.spoken).toContain('kilojoules');
    expect(ir.spoken).not.toContain('kilocalories');
    const er = energyReadoutRow(data, 'kJ')!.value(t, 'daily');
    expect(er.unit).toBe('kJ');
    expect(er.value).toBe(formatEnergy(bal[30]!, 'kJ', { withUnit: false, signed: true }));
    expect(er.detail).toBe(`vs maintenance ${formatEnergy(intake.maintenance[30]!, 'kJ', { withUnit: false })}`);
    // default stays kcal
    expect(intakeReadoutRow(data)!.value(t, 'daily').unit).toBe('kcal');
  });
});

describe('table and CSV follow the energy unit', () => {
  it('labels the intake columns kJ and converts their values', () => {
    const s = data.series.filter((x) => x.id === 'fat_mass');
    const kcal = buildTable(data.time, s, 0, 3, 'daily', intake);
    const kj = buildTable(data.time, s, 0, 3, 'daily', intake, { energyUnit: 'kJ' });
    expect(kj.columns.slice(0, 2).map((c) => c.unit)).toEqual(['kJ', 'kJ']);
    for (let r = 0; r < 3; r++) {
      expect(kj.rows[r]!.cells[0]!.v).toBeCloseTo(kcal.rows[r]!.cells[0]!.v * KJ_PER_KCAL, 1);
      expect(kj.rows[r]!.cells[1]!.v).toBeCloseTo(kcal.rows[r]!.cells[1]!.v * KJ_PER_KCAL, 1);
      expect(kj.rows[r]!.cells[2]!.v).toBe(kcal.rows[r]!.cells[2]!.v); // metric series untouched
    }
    expect(tableToCSV(kj).split('\n')[0]).toMatch(/^time,Intake \(kJ\),Maintenance \(kJ\),Fat mass \(kg\),/);
  });
});

describe('TDEE stack and adaptation label in kJ', () => {
  it('labels the adaptation gap in the series unit', () => {
    const s = tdeeInKJ();
    const texts: string[] = [];
    const store: Record<string | symbol, unknown> = {};
    const ctx = new Proxy(store, {
      get(t, p) {
        if (p in t) return t[p];
        if (p === 'fillText') return (txt: string) => texts.push(txt);
        if (p === 'measureText') return (txt: string) => ({ width: txt.length * 6 });
        return () => {};
      },
      set(t, p, v) {
        t[p] = v;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const a: DrawArgs = { ctx, theme: readChartTheme(), dpr: 1, box: { left: 44, top: 0, width: 840, height: 240 }, canvasW: 900, canvasH: 240, x0: 0, x1: 84, yMin: 0, yMax: 16000, x: (t) => 44 + t * 10, y: (v) => 240 - v / 70 };
    stackedAreaModel(s, { mode: 'focus', tickColCss: 44, labels: true }).over!(a, view(0, 84));
    const label = texts.find((t) => t.startsWith('adaptation '));
    expect(label).toMatch(/^adaptation [−+]\d[\d\u2009\u00a0]*0 kJ$/);
    expect(texts.some((t) => /kcal/.test(t))).toBe(false);
  });

  it('TdeeStack speaks and reads out kJ when its series is in kJ', async () => {
    render(<TdeeStack series={tdeeInKJ()} time={data.time} />);
    await flush();
    const imgs = screen.getAllByRole('img', { name: /^Energy expenditure, stacked:/ });
    expect(imgs[0]!.getAttribute('aria-label')).toContain(unitWords('kJ/d'));
    expect(imgs[0]!.getAttribute('aria-label')).not.toContain('kilocalories');
  });
});

describe('components with energyUnit="kJ"', () => {
  it('LaneStack: intake and energy lanes, gutter values and the mode switch say kJ', async () => {
    const ctl = new ChartController(84);
    const { container } = render(<LaneStack data={data} controller={ctl} laneIds={['fat_mass']} energyUnit="kJ" />);
    await flush();
    const inputs = container.querySelector<HTMLElement>('[data-lane="intake"]')!;
    const energy = container.querySelector<HTMLElement>('[data-lane="energy"]')!;
    expect(within(inputs).getByText('kJ/d')).toBeInTheDocument();
    expect(within(inputs).getByRole('img', { name: /^Intake per day in kJ\/d/ })).toBeInTheDocument();
    expect(within(energy).getByText('kJ/d vs maintenance')).toBeInTheDocument();
    expect(inputs.querySelector('.lmc-gut__val .lmc-unit')!.textContent).toBe('kJ');
    expect(energy.querySelector('.lmc-gut__val .lmc-unit')!.textContent).toBe('kJ');
    expect(container.textContent).not.toMatch(/kcal/);
    // the gutter value is the last day's intake in kJ
    const kc = intakeKcal(intake);
    expect(inputs.querySelector('.lmc-gut__val b > span')!.textContent).toBe(formatEnergy(kc.total[83]!, 'kJ', { withUnit: false }));
    // the kcal/grams/% switch names the energy mode "kJ"
    fireEvent.click(within(inputs).getByRole('button', { name: 'Intake lane options' }));
    await flush();
    expect(screen.getByRole('menuitem', { name: 'kJ ✓' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /kcal/ })).toBeNull();
  });

  it('LaneStack defaults to kcal', async () => {
    const { container } = render(<LaneStack data={data} controller={new ChartController(84)} laneIds={['fat_mass']} />);
    await flush();
    expect(within(container.querySelector<HTMLElement>('[data-lane="intake"]')!).getByText('kcal/d')).toBeInTheDocument();
    expect(within(container.querySelector<HTMLElement>('[data-lane="energy"]')!).getByText('kcal/d vs maintenance')).toBeInTheDocument();
  });

  it('DayView: meal ribbon and dial summary print meal energy in kJ', async () => {
    render(<DayView data={data} day={37} energyUnit="kJ" />);
    await flush();
    const ribbon = screen.getByRole('img', { name: /^\d+ meals: / });
    expect(ribbon.getAttribute('aria-label')).toMatch(/\d0\u2009kJ/);
    expect(ribbon.getAttribute('aria-label')).not.toMatch(/kcal/);
    const dial = screen.getByRole('img', { name: /^Eat / });
    expect(dial.getAttribute('aria-label')).toMatch(/\(\d[\d\u2009\u00a0]*0\u2009kJ\)/);
    expect(dial.getAttribute('aria-label')).not.toMatch(/kcal/);
  });
});
