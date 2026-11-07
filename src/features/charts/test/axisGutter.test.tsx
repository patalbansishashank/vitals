/* The y tick column fits the widest tick label (measured in the canvas tick font), shared by every lane on the time
   axis, so labels such as "−500", "59.8" or "600" never run past the card's edge on a phone. The docked readout carries
   no instruction: at rest it reads the last day in view. setupDom's 2D context measures 6 px per character. */
import './setupDom';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LaneStack } from '../components/LaneStack';
import { ChartController } from '../core/controller';
import { type DrawArgs, yAxisLabels, yAxisWidth } from '../core/draw';
import { energyModel, inputsModel } from '../core/inputModels';
import { AXIS_INSET, stackLayout } from '../core/layout';
import { lineLaneModel, stackedAreaModel } from '../core/models';
import type { PlotModel } from '../core/plotEngine';
import { getThemeSnapshot } from '../core/theme';
import { makeChartData } from '../fixtures';

const data = makeChartData({ days: 84 });
const series = (id: string) => data.series.find((s) => s.id === id)!;
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
};
afterEach(() => cleanup());

/** Runs a model's `under` layer on a recording context and returns the tick labels it printed. */
function drawnLabels(model: PlotModel, view: ReturnType<ChartController['view']['get']>): string[] {
  const texts: string[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'fillText') return (t: string) => texts.push(t);
      if (prop === 'measureText') return (t: string) => ({ width: t.length * 6 });
      if (prop === 'createPattern') return () => null;
      if (prop === 'canvas') return { width: 400, height: 80 };
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const [yMin, yMax] = model.domain(view);
  const box = { left: 40, top: 8, width: 300, height: 56 };
  const a: DrawArgs = {
    ctx,
    theme: getThemeSnapshot(),
    dpr: 1,
    box,
    canvasW: 348,
    canvasH: 72,
    x0: view.x0,
    x1: view.x1,
    yMin,
    yMax,
    x: (t) => box.left + ((t - view.x0) / (view.x1 - view.x0)) * box.width,
    y: (v) => box.top + (1 - (v - yMin) / (yMax - yMin || 1)) * box.height,
  };
  model.under?.(a, view);
  return texts;
}

describe('y tick column', () => {
  it('measures the widest label plus the gap, tick and spine', () => {
    expect(yAxisWidth([])).toBe(0);
    // "−500" is 4 characters: 24 px, then 3 px gap, 4 px tick, 1 px spine
    expect(yAxisWidth(['0', '−250', '−500'])).toBe(32);
    expect(yAxisLabels([0, -250, -500], { colCss: 26, step: 250 })).toEqual(['0', '−250', '−500']);
    // thousands still compact in the narrow width class, whatever the measured column
    expect(yAxisLabels([2000], { colCss: 26, step: 1000 })).toEqual(['2k']);
  });

  it('widens the stack column to fit (with the phone inset), never below the base column', () => {
    const base = stackLayout(390);
    expect(base.tickCol).toBe(26);
    expect(base.tickBase).toBe(26);
    const fitted = stackLayout(390, 32);
    expect(fitted.tickCol).toBe(32 + AXIS_INSET.s);
    expect(fitted.tickBase).toBe(26);
    expect(fitted.plotW).toBe(fitted.cellW - fitted.tickCol - fitted.rightPad);
    expect(stackLayout(1200, 10).tickCol).toBe(32);
  });

  it('every lane model reports the labels it prints', () => {
    const view = new ChartController(84).view.get();
    const models: PlotModel[] = [
      lineLaneModel(series('lean_mass'), { mode: 'lane', tickColCss: 26 }),
      lineLaneModel(series('glycogen'), { mode: 'focus', tickColCss: 26 }),
      lineLaneModel(series('met_adaptation'), { mode: 'lane', tickColCss: 26 }),
      lineLaneModel(series('hunger'), { mode: 'lane', tickColCss: 26 }),
      stackedAreaModel(series('tdee'), { mode: 'lane', tickColCss: 26 }),
      inputsModel(data.intake!, { mode: 'kcal', detail: false, tickColCss: 26 }),
      energyModel(data.intake!, { tickColCss: 26 }),
    ];
    for (const m of models) {
      const labels = m.yLabels!(view);
      expect(labels.length).toBeGreaterThan(0);
      expect(drawnLabels(m, view)).toEqual(labels);
    }
    expect(lineLaneModel(series('lean_mass'), { mode: 'strip', tickColCss: 26 }).yLabels!(view)).toEqual([]);
  });

  it('LaneStack sizes one column for all lanes from their widest label', async () => {
    const ctl = new ChartController(84);
    const ids = ['fat_mass', 'lean_mass', 'glycogen', 'met_adaptation', 'hunger'];
    const { container } = render(<LaneStack data={data} controller={ctl} laneIds={ids} readout="dock" />);
    await flush();
    const view = ctl.view.get();
    const tickBase = 32; // setupDom reports 1200 px wide: the desktop width class
    const models: PlotModel[] = [
      ...ids.map((id) => lineLaneModel(series(id), { mode: 'lane', tickColCss: tickBase })),
      inputsModel(data.intake!, { mode: 'kcal', detail: false, tickColCss: tickBase }),
      energyModel(data.intake!, { tickColCss: tickBase }),
    ];
    const need = Math.max(...models.map((m) => yAxisWidth(m.yLabels!(view))));
    const stack = container.querySelector<HTMLElement>('.lmc-stack')!;
    expect(stack.style.getPropertyValue('--lmc-tickcol')).toBe(`${Math.max(tickBase, Math.ceil(Math.ceil(need) + AXIS_INSET.l))}px`);
  });

  it('the docked readout has no instruction: at rest it reads the last day in view', async () => {
    const ctl = new ChartController(84);
    render(<LaneStack data={data} controller={ctl} laneIds={['fat_mass']} readout="dock" />);
    await flush();
    expect(screen.queryByText(/Drag across|every channel|Tap and drag/)).toBeNull();
    const dock = document.querySelector('.lmc-dock__inner')!;
    expect(dock.getAttribute('data-on')).toBe('false');
    expect(dock.textContent).toMatch(/day 84/);
    expect(dock.textContent).toMatch(/fat \d/);
    act(() => ctl.setCursor(10.5, 'touch', { force: true }));
    expect(dock.getAttribute('data-on')).toBe('true');
    expect(dock.textContent).toMatch(/day 11/);
  });
});
